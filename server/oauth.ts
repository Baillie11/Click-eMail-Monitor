import type { Express } from "express";
import {
  mcpAuthRouter,
  createOAuthMetadata,
} from "@modelcontextprotocol/sdk/server/auth/router.js";
import type { OAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import {
  InvalidGrantError,
  InvalidTokenError,
  InvalidRequestError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { one, type DB } from "./db.js";
import { token, digest, id, HttpError } from "./security.js";
import { config } from "./config.js";
import { requireUser, requireCsrf, issueToken } from "./auth.js";
async function revokeFamily(db: DB, family: string) {
  await db.query("DELETE FROM oauth_tokens WHERE hash IN (SELECT access_hash FROM oauth_refresh_tokens WHERE family_id=$1)", [family]);
  await db.query("DELETE FROM oauth_refresh_tokens WHERE family_id=$1", [family]);
}
export function oauthProvider(db: DB): OAuthServerProvider {
  const resource = config.origin + "/mcp";
  return {
    clientsStore: {
      getClient: async (cid) =>
        (await one(db, "SELECT metadata FROM oauth_clients WHERE id=$1", [cid]))
          ?.metadata,
      registerClient: async (client) => {
        if (client.token_endpoint_auth_method !== "none")
          throw new InvalidRequestError(
            "Only public clients with PKCE are supported.",
          );
        for (const uri of client.redirect_uris) {
          const u = new URL(uri);
          if (
            u.hash ||
            u.username ||
            u.password ||
            !(
              u.protocol === "https:" ||
              (!config.production &&
                u.protocol === "http:" &&
                ["localhost", "127.0.0.1"].includes(u.hostname))
            )
          )
            throw new InvalidRequestError(
              "Redirect URI must use HTTPS without a fragment.",
            );
        }
        const value = {
          ...client,
          client_id: id(),
          client_id_issued_at: Math.floor(Date.now() / 1000),
        };
        await db.query("INSERT INTO oauth_clients(id,metadata) VALUES($1,$2)", [
          value.client_id,
          JSON.stringify(value),
        ]);
        return value;
      },
    },
    authorize: async (client, params, res) => {
      if (params.resource?.toString() !== resource)
        throw new InvalidRequestError(
          "The resource must match the MCP endpoint.",
        );
      if (params.scopes?.some((s) => s !== "mail"))
        throw new InvalidRequestError("Unsupported scope.");
      const pending = await issueToken(
        db,
        null,
        "oauth_pending",
        {
          clientId: client.client_id,
          clientName: client.client_name || "ChatGPT integration",
          ...params,
          resource,
        },
        10,
      );
      res.redirect(config.origin + "/?oauth=" + encodeURIComponent(pending));
    },
    challengeForAuthorizationCode: async (client, raw) => {
      const c = await one(
        db,
        "SELECT * FROM oauth_codes WHERE hash=$1 AND client_id=$2 AND expires_at>now()",
        [digest(raw), client.client_id],
      );
      if (!c) throw new InvalidGrantError("Code is invalid or expired.");
      return c.challenge;
    },
    exchangeAuthorizationCode: async (
      client,
      raw,
      _verifier,
      redirect,
      requestedResource,
    ) =>
      db.transaction(async (tx) => {
        const c = await one(
          tx,
          "SELECT * FROM oauth_codes WHERE hash=$1 AND client_id=$2 AND expires_at>now() FOR UPDATE",
          [digest(raw), client.client_id],
        );
        if (
          !c ||
          c.redirect_uri !== redirect ||
          c.resource !== requestedResource?.toString()
        )
          throw new InvalidGrantError("Code binding mismatch.");
        await tx.query("DELETE FROM oauth_codes WHERE hash=$1", [digest(raw)]);
        const access = token(), refresh = token();
        await tx.query(
          "INSERT INTO oauth_tokens(hash,client_id,user_id,resource,expires_at) VALUES($1,$2,$3,$4,now()+interval '1 hour')",
          [digest(access), client.client_id, c.user_id, c.resource],
        );
        await tx.query(
          "INSERT INTO oauth_refresh_tokens(hash,client_id,user_id,resource,family_id,access_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '90 days')",
          [digest(refresh), client.client_id, c.user_id, c.resource, id(), digest(access)],
        );
        return {
          refresh_token: refresh,
          access_token: access,
          token_type: "Bearer",
          expires_in: 3600,
          scope: "mail",
        };
      }),
    exchangeRefreshToken: async (client, raw, scopes, requestedResource) => {
      // Return the failure from the transaction so replay revocation commits.
      const result = await db.transaction(async (tx) => {
        const r = await one(tx,
          "SELECT * FROM oauth_refresh_tokens WHERE hash=$1 AND client_id=$2 AND expires_at>now() FOR UPDATE",
          [digest(raw), client.client_id]);
        if (!r || (requestedResource && requestedResource.toString() !== r.resource) ||
            r.resource !== resource || scopes?.some((s) => s !== "mail")) return null;
        if (r.used_at) {
          await revokeFamily(tx, r.family_id);
          return null;
        }
        const access = token(), refresh = token();
        await tx.query("UPDATE oauth_refresh_tokens SET used_at=now() WHERE hash=$1", [digest(raw)]);
        await tx.query(
          "INSERT INTO oauth_tokens(hash,client_id,user_id,resource,expires_at) VALUES($1,$2,$3,$4,now()+interval '1 hour')",
          [digest(access), client.client_id, r.user_id, r.resource]);
        await tx.query(
          "INSERT INTO oauth_refresh_tokens(hash,client_id,user_id,resource,family_id,access_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [digest(refresh), client.client_id, r.user_id, r.resource, r.family_id, digest(access), r.expires_at]);
        return { access_token: access, refresh_token: refresh, token_type: "Bearer", expires_in: 3600, scope: "mail" };
      });
      if (!result) throw new InvalidGrantError("Refresh token is invalid, expired or reused. Reconnect this account.");
      return result;
    },
    verifyAccessToken: async (raw) => {
      const t = await one(
        db,
        "SELECT * FROM oauth_tokens WHERE hash=$1 AND expires_at>now()",
        [digest(raw)],
      );
      if (!t || t.resource !== resource)
        throw new InvalidTokenError("Access token is invalid or expired.");
      return {
        token: raw,
        clientId: t.client_id,
        scopes: ["mail"],
        expiresAt: Math.floor(new Date(t.expires_at).getTime() / 1000),
        resource: new URL(resource),
        extra: { userId: t.user_id },
      };
    },
    revokeToken: async (client, request) => {
      await db.transaction(async (tx) => {
        const r = await one(tx,
          "SELECT family_id FROM oauth_refresh_tokens WHERE (hash=$1 OR access_hash=$1) AND client_id=$2 FOR UPDATE",
          [digest(request.token), client.client_id]);
        if (r) await revokeFamily(tx, r.family_id);
        await tx.query("DELETE FROM oauth_tokens WHERE hash=$1 AND client_id=$2", [digest(request.token), client.client_id]);
      });
    },
  };
}
export function mountOAuth(app: Express, db: DB) {
  const provider = oauthProvider(db);
  const metadata = createOAuthMetadata({
    provider,
    issuerUrl: new URL(config.origin),
    scopesSupported: ["mail"],
  });
  metadata.grant_types_supported = ["authorization_code", "refresh_token"];
  metadata.token_endpoint_auth_methods_supported = ["none"];
  metadata.revocation_endpoint_auth_methods_supported = ["none"];
  app.get("/.well-known/oauth-authorization-server", (_req, res) =>
    res.set("Access-Control-Allow-Origin", "*").json(metadata),
  );
  app.use(
    mcpAuthRouter({
      provider,
      issuerUrl: new URL(config.origin),
      resourceServerUrl: new URL(config.origin + "/mcp"),
      scopesSupported: ["mail"],
      resourceName: "ClickeMailMonitor",
    }),
  );
  app.get("/api/oauth/pending", requireUser, async (req, res) => {
    const p = await one(
      db,
      "SELECT payload FROM tokens WHERE hash=$1 AND kind='oauth_pending' AND expires_at>now()",
      [digest(String(req.query.token))],
    );
    if (!p) throw new HttpError(400, "Connection request expired.");
    res.json({
      clientName: p.payload.clientName,
      redirectUri: p.payload.redirectUri,
    });
  });
  app.post("/api/oauth/consent", requireUser, requireCsrf, async (req, res) => {
    const result = await db.transaction(async (tx) => {
      const p = await one(
        tx,
        "DELETE FROM tokens WHERE hash=$1 AND kind='oauth_pending' AND expires_at>now() RETURNING payload",
        [digest(String(req.body.token))],
      );
      if (!p) throw new HttpError(400, "Connection request expired.");
      const data = p.payload,
        url = new URL(data.redirectUri);
      if (data.state) url.searchParams.set("state", data.state);
      if (req.body.allow !== true) {
        url.searchParams.set("error", "access_denied");
        return url.toString();
      }
      const raw = token();
      await tx.query(
        "INSERT INTO oauth_codes(hash,client_id,user_id,redirect_uri,challenge,resource,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '5 minutes')",
        [
          digest(raw),
          data.clientId,
          req.userId,
          data.redirectUri,
          data.codeChallenge,
          data.resource,
        ],
      );
      url.searchParams.set("code", raw);
      return url.toString();
    });
    res.json({ redirect: result });
  });
  return provider;
}

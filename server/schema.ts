import { mysqlSchema } from "./mysql-schema.js";
import type { DB } from "./db.js";
// Additive, idempotent initial migration. Future changes belong in numbered migrations.
export const schema = `
CREATE TABLE IF NOT EXISTS users(id text PRIMARY KEY,email text UNIQUE NOT NULL,password text NOT NULL,name text NOT NULL,verified boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS workspaces(id text PRIMARY KEY,name text NOT NULL,settings jsonb NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS members(workspace_id text REFERENCES workspaces ON DELETE CASCADE,user_id text REFERENCES users ON DELETE CASCADE,role text NOT NULL CHECK(role IN ('owner','administrator','member')),PRIMARY KEY(workspace_id,user_id));
CREATE TABLE IF NOT EXISTS sessions(hash text PRIMARY KEY,user_id text REFERENCES users ON DELETE CASCADE,csrf text NOT NULL,expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS tokens(hash text PRIMARY KEY,user_id text REFERENCES users ON DELETE CASCADE,kind text NOT NULL,payload jsonb NOT NULL DEFAULT '{}',expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS mailboxes(id text PRIMARY KEY,workspace_id text NOT NULL REFERENCES workspaces ON DELETE CASCADE,email text NOT NULL,provider text NOT NULL,settings jsonb NOT NULL,secret text NOT NULL,paused boolean NOT NULL DEFAULT false,demo boolean NOT NULL DEFAULT false,status text NOT NULL DEFAULT 'Not checked',last_check timestamptz,next_check timestamptz NOT NULL DEFAULT now(),failures int NOT NULL DEFAULT 0,lease_until timestamptz,lease_owner text,UNIQUE(workspace_id,email));
CREATE TABLE IF NOT EXISTS mailbox_permissions(mailbox_id text REFERENCES mailboxes ON DELETE CASCADE,user_id text REFERENCES users ON DELETE CASCADE,can_send boolean NOT NULL DEFAULT false,PRIMARY KEY(mailbox_id,user_id));
CREATE TABLE IF NOT EXISTS folders(mailbox_id text REFERENCES mailboxes ON DELETE CASCADE,path text NOT NULL,special_use text,uidvalidity text NOT NULL,last_uid bigint NOT NULL DEFAULT 0,PRIMARY KEY(mailbox_id,path));
CREATE TABLE IF NOT EXISTS messages(id text PRIMARY KEY,mailbox_id text NOT NULL REFERENCES mailboxes ON DELETE CASCADE,folder text NOT NULL,uidvalidity text NOT NULL,uid bigint NOT NULL,message_id text,thread_key text NOT NULL,subject text NOT NULL,sender text NOT NULL,recipients jsonb NOT NULL,received_at timestamptz NOT NULL,unread boolean NOT NULL,body text NOT NULL,html text NOT NULL,attachments jsonb NOT NULL DEFAULT '[]',headers jsonb NOT NULL DEFAULT '{}',UNIQUE(mailbox_id,folder,uidvalidity,uid));
CREATE INDEX IF NOT EXISTS messages_listing ON messages(mailbox_id,received_at DESC);
CREATE TABLE IF NOT EXISTS rules(id text PRIMARY KEY,mailbox_id text NOT NULL REFERENCES mailboxes ON DELETE CASCADE,name text NOT NULL,criteria jsonb NOT NULL,enabled boolean NOT NULL DEFAULT true);
CREATE TABLE IF NOT EXISTS alerts(id text PRIMARY KEY,mailbox_id text NOT NULL REFERENCES mailboxes ON DELETE CASCADE,rule_id text REFERENCES rules ON DELETE CASCADE,message_id text REFERENCES messages ON DELETE CASCADE,created_at timestamptz NOT NULL DEFAULT now(),seen boolean NOT NULL DEFAULT false,UNIQUE(rule_id,message_id));
CREATE TABLE IF NOT EXISTS drafts(id text PRIMARY KEY,mailbox_id text NOT NULL REFERENCES mailboxes ON DELETE CASCADE,message_id text REFERENCES messages ON DELETE SET NULL,author_id text REFERENCES users,version int NOT NULL DEFAULT 1,content jsonb NOT NULL,status text NOT NULL DEFAULT 'Needs review',approved_hash text,approved_by text REFERENCES users,approved_at timestamptz,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS outbox(id text PRIMARY KEY,draft_id text UNIQUE REFERENCES drafts ON DELETE CASCADE,version int NOT NULL,content_hash text NOT NULL,status text NOT NULL DEFAULT 'Approved',started_at timestamptz,completed_at timestamptz,result text);
CREATE TABLE IF NOT EXISTS audit(id text PRIMARY KEY,workspace_id text REFERENCES workspaces ON DELETE CASCADE,user_id text,action text NOT NULL,entity_id text,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS oauth_clients(id text PRIMARY KEY,metadata jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS oauth_codes(hash text PRIMARY KEY,client_id text NOT NULL,user_id text REFERENCES users ON DELETE CASCADE,redirect_uri text NOT NULL,challenge text NOT NULL,resource text NOT NULL,expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS oauth_tokens(hash text PRIMARY KEY,client_id text NOT NULL,user_id text REFERENCES users ON DELETE CASCADE,resource text NOT NULL,expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS ai_usage(workspace_id text REFERENCES workspaces ON DELETE CASCADE,day date NOT NULL DEFAULT CURRENT_DATE,count int NOT NULL,PRIMARY KEY(workspace_id,day));
CREATE TABLE IF NOT EXISTS migration_versions(version int PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now());
INSERT INTO migration_versions(version) VALUES(1) ON CONFLICT DO NOTHING;
`;
export async function migrate(db: DB) {
  for (const statement of (db.dialect === "mysql" ? mysqlSchema : schema)
    .split(";")
    .filter((x) => x.trim()))
    await db.query(statement);
  if (db.dialect === "mysql") {
    const indexes = await db.query(
      "SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='messages' AND INDEX_NAME='messages_listing'",
    );
    if (!indexes.rows.length)
      await db.query(
        "CREATE INDEX messages_listing ON messages(mailbox_id,received_at DESC)",
      );
  }
}

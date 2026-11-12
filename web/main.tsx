import React, { useState, useEffect, useCallback } from "react";
import { createRoot } from "react-dom/client";
import {
  Mail,
  Inbox,
  Radio,
  FileCheck,
  Plug,
  Settings,
  Users,
  Activity,
  Search,
  Plus,
  ArrowUpRight,
  ArrowLeft,
  ChevronRight,
  Check,
  CheckCheck,
  Clock,
  ShieldCheck,
  LogOut,
  X,
  Paperclip,
  Send,
  RefreshCw,
  Pause,
  Play,
  Trash2,
  Menu,
  Sparkles,
  AlertCircle,
  Info,
} from "lucide-react";
import "./style.css";
let csrf = "";
async function api(path: string, method = "GET", body?: any) {
  const r = await fetch("/api" + path, {
    method,
    headers: { "Content-Type": "application/json", "x-csrf-token": csrf },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || "Request failed.");
  return d;
}
const stamp = (v: string) =>
  new Date(v).toLocaleString("en-AU", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
const shortTime = (v: string) =>
  new Date(v).toLocaleTimeString("en-AU", {
    hour: "numeric",
    minute: "2-digit",
  });
const split = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
const initials = (s: string) => s.slice(0, 2).toUpperCase();
function App() {
  const [cfg, setCfg] = useState<any>(null),
    [me, setMe] = useState<any>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [view, setView] = useState("inbox"),
    [boxes, setBoxes] = useState<any[]>([]),
    [drafts, setDrafts] = useState<any[]>([]),
    [alerts, setAlerts] = useState<any[]>([]),
    [wid, setWid] = useState(""),
    [connect, setConnect] = useState(false),
    [draft, setDraft] = useState<any>(null),
    [mobile, setMobile] = useState(false);
  const params = new URLSearchParams(location.search);
  const refresh = useCallback(async () => {
    const [b, d, a] = await Promise.all([
      api("/mailboxes"),
      api("/drafts"),
      api("/alerts"),
    ]);
    setBoxes(b);
    setDrafts(d);
    setAlerts(a);
  }, []);
  const login = useCallback(async () => {
    const user = await api("/me");
    csrf = user.csrf;
    setMe(user);
    setWid(user.workspaces[0]?.id || "");
    await refresh();
  }, [refresh]);
  useEffect(() => {
    api("/config")
      .then(setCfg)
      .catch((e) => setError(e.message));
    login()
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [login]);
  const run = async (fn: () => Promise<void>) => {
    setError("");
    try {
      await fn();
    } catch (e: any) {
      setError(e.message);
    }
  };
  useEffect(() => {
    if (!me) return;
    const did = new URLSearchParams(location.search).get("draft");
    if (did) void run(async () => setDraft(await api("/drafts/" + did)));
  }, [me]);
  useEffect(() => {
    if (!me) return;
    const timer = setInterval(() => {
      void refresh().catch(() => {});
    }, 10000);
    return () => clearInterval(timer);
  }, [me, refresh]);
  const work = me?.workspaces.find((w: any) => w.id === wid),
    workspaceBoxes = boxes.filter((b) => b.workspace_id === wid);
  const allowed = new Set(workspaceBoxes.map((b) => b.id));
  const workspaceDrafts = drafts.filter((d) => allowed.has(d.mailbox_id)),
    workspaceAlerts = alerts.filter((a) => allowed.has(a.mailbox_id));
  const openDraft = async (d: any) => setDraft(await api("/drafts/" + d.id));
  if (loading)
    return (
      <div className="splash">
        <Mail size={36} />
        <p>Opening your workspace…</p>
      </div>
    );
  if (!me) return <Auth cfg={cfg} onLogin={login} error={error} run={run} />;
  return (
    <div className="shell">
      <aside className={"sidebar " + (mobile ? "open" : "")}>
        <a className="brand" href="/">
          <span className="brand-mark">
            <Mail size={23} />
          </span>
          <span>
            Click<span className="brand-light">eMailMonitor</span>
          </span>
        </a>
        <div className="workspace-switch">
          <span className="workspace-icon">{initials(work?.name || "WS")}</span>
          <select
            aria-label="Workspace"
            value={wid}
            onChange={(e) => setWid(e.target.value)}
          >
            {me.workspaces.map((w: any) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>
        <p className="nav-label">YOUR WORKSPACE</p>
        <nav>
          {[
            ["inbox", "Inbox", Inbox],
            ["drafts", "Review queue", FileCheck],
            ["monitoring", "Monitoring", Radio],
            ["mailboxes", "Mailboxes", Plug],
            ["members", "Team", Users],
            ["activity", "Activity", Activity],
            ["settings", "Settings", Settings],
            ["about", "About", Info],
          ].map(([key, label, Icon]: any) => (
            <button
              className={view === key ? "active" : ""}
              key={key}
              onClick={() => {
                setView(key);
                setMobile(false);
              }}
            >
              <Icon size={19} />
              <span>{label}</span>
              {key === "drafts" &&
                workspaceDrafts.filter((d) => d.status === "Needs review")
                  .length > 0 && (
                  <b>
                    {
                      workspaceDrafts.filter((d) => d.status === "Needs review")
                        .length
                    }
                  </b>
                )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="approval-note">
            <ShieldCheck size={22} />
            <strong>You have the final say.</strong>
            <p>Every reply is reviewed and approved by you.</p>
          </div>
          <button
            className="profile"
            onClick={() =>
              void run(async () => {
                await api("/auth/logout", "POST", {});
                setMe(null);
                csrf = "";
              })
            }
          >
            <span className="avatar">{initials(me.user.name)}</span>
            <span>
              <strong>{me.user.name}</strong>
              <small>Sign out</small>
            </span>
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <button
            className="mobile-menu icon-btn"
            aria-label="Open navigation"
            onClick={() => setMobile(!mobile)}
          >
            <Menu />
          </button>
          <div className="breadcrumb">
            Workspace <ChevronRight size={14} />{" "}
            <strong>
              {
                (
                  {
                    inbox: "Inbox",
                    drafts: "Review queue",
                    monitoring: "Monitoring",
                    mailboxes: "Mailboxes",
                    members: "Team",
                    activity: "Activity",
                    settings: "Settings",
                    about: "About",
                  } as any
                )[view]
              }
            </strong>
          </div>
          <div className="top-status">
            <span className="status-dot" />
            {cfg?.demo ? "Demo workspace" : "Your connected workspace"}
          </div>
        </header>
        {cfg?.demo && (
          <div className="demo-banner">
            <Sparkles size={15} />
            <span>
              <strong>A little room to explore.</strong> This workspace uses
              synthetic messages. No real emails are connected or sent.
            </span>
            <span className="pill">DEMO</span>
          </div>
        )}
        <div className="content">
          {error && (
            <div role="alert" className="alert error">
              <AlertCircle size={18} />
              {error}
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div role="status" className="alert success">
              <Check size={18} />
              {notice}
              <button aria-label="Dismiss notice" onClick={() => setNotice("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {params.get("oauth") && (
            <OAuthConsent token={params.get("oauth")!} run={run} />
          )}{" "}
          {params.get("action") === "invite" && (
            <div className="panel">
              <h3>Join your team</h3>
              <p>
                Accept this invitation using the email address it was sent to.
              </p>
              <button
                className="primary"
                onClick={() =>
                  void run(async () => {
                    await api("/invitations/accept", "POST", {
                      token: params.get("token"),
                    });
                    history.replaceState({}, "", "/");
                    await login();
                    setNotice("Workspace invitation accepted.");
                  })
                }
              >
                Accept invitation
              </button>
            </div>
          )}
          {view === "inbox" && (
            <InboxView
              key={wid}
              onRefresh={refresh}
              wid={wid}
              boxes={workspaceBoxes}
              cfg={cfg}
              run={run}
              onDraft={setDraft}
              onConnect={() => setConnect(true)}
              queueCount={
                workspaceDrafts.filter((d) => d.status === "Needs review")
                  .length
              }
              onQueue={() => setView("drafts")}
              alertCount={
                work?.settings.notifications === false
                  ? 0
                  : workspaceAlerts.filter((a) => !a.seen).length
              }
            />
          )}
          {view === "drafts" && (
            <>
              <PageTitle
                eyebrow="YOU’RE IN CONTROL"
                title="A thoughtful second look."
                text="Review the details. Make it yours. Send when you’re ready."
              />
              <div className="panel">
                <div className="panel-heading">
                  <h3>
                    Replies to review{" "}
                    <span className="count">{workspaceDrafts.length}</span>
                  </h3>
                  <span className="muted">
                    Approval is required for every send
                  </span>
                </div>
                {workspaceDrafts.length ? (
                  workspaceDrafts.map((d) => (
                    <button
                      className="draft-row"
                      key={d.id}
                      onClick={() => void run(() => openDraft(d))}
                    >
                      <span className="round-icon">
                        <FileCheck size={21} />
                      </span>
                      <span className="grow">
                        <strong>{d.content.subject || "(No subject)"}</strong>
                        <small>
                          {d.email} → {d.content.to.join(", ")}
                        </small>
                        <p>{d.content.body.slice(0, 120)}</p>
                        {d.result && <small>{d.result}</small>}
                      </span>
                      <Badge text={d.status} />
                      <ChevronRight size={18} />
                    </button>
                  ))
                ) : (
                  <Empty
                    title="All caught up"
                    text="Reply to a message to create your first draft."
                  />
                )}
              </div>
            </>
          )}
          {view === "monitoring" && (
            <Monitoring
              boxes={workspaceBoxes}
              alerts={workspaceAlerts}
              run={run}
              refresh={refresh}
            />
          )}
          {view === "mailboxes" && (
            <>
              <PageTitle
                eyebrow="KEEP YOUR EMAIL WHERE IT IS"
                title="All your mail. One place."
                text="Connect your existing mailboxes securely, without moving your email."
                action={
                  <button className="primary" onClick={() => setConnect(true)}>
                    <Plus size={17} />
                    Connect mailbox
                  </button>
                }
              />
              <div className="mailbox-grid">
                {workspaceBoxes.map((b) => (
                  <MailboxCard
                    key={b.id}
                    b={b}
                    run={run}
                    refresh={refresh}
                    canManage={work?.role !== "member"}
                  />
                ))}
                {!workspaceBoxes.length && (
                  <Empty
                    title="Your first connection starts here"
                    text="Use the secure mail settings supplied by your hosting provider."
                  />
                )}
              </div>
              <div className="quiet-info">
                <ShieldCheck size={20} />
                <p>
                  Mailbox credentials are encrypted at rest. Connection tests
                  check authentication without sending a message.
                </p>
              </div>
            </>
          )}
          {view === "members" && (
            <Team
              wid={wid}
              role={work?.role}
              boxes={workspaceBoxes}
              run={run}
              setNotice={setNotice}
            />
          )}
          {view === "settings" && (
            <SettingsView
              work={work}
              boxes={workspaceBoxes}
              run={run}
              onSaved={async () => {
                await login();
                setNotice("Settings saved.");
              }}
              cfg={cfg}
            />
          )}
          {view === "activity" && (
            <ActivityView wid={wid} role={work?.role} run={run} />
          )}
          {view === "about" && (
            <>
              <PageTitle
                eyebrow="ABOUT CLICK EMAIL MONITORING"
                title="Your email, connected to ChatGPT."
                text="ClickeMailMonitor brings your existing mailboxes into one workspace so you can find messages, monitor new mail and prepare replies."
              />
              <div className="about-grid">
                <section className="panel">
                  <Mail size={24} />
                  <h2>Keep your existing email account</h2>
                  <p>Connect compatible IMAP mailboxes, including accounts from your web host or business domain. Your email stays with your provider; ClickeMailMonitor imports messages for reading and searching.</p>
                </section>
                <section className="panel">
                  <Search size={24} />
                  <h2>Read and search with ChatGPT</h2>
                  <p>Once you connect the ClickeMailMonitor app in ChatGPT, you can ask it to find imported emails, read a message, summarise a conversation or help draft a reply.</p>
                  <p className="muted">Try: “Find emails about my booking” or “Summarise my latest emails.”</p>
                </section>
                <section className="panel">
                  <Radio size={24} />
                  <h2>Monitor incoming messages</h2>
                  <p>Scheduled checks import new messages from enabled mailboxes. Monitoring rules can flag matching messages for your attention. See Mailboxes for the last and next scheduled check, or pause a mailbox when needed.</p>
                  <p className="muted">Use Check Now on a mailbox to check for new email immediately. Scheduled checks continue automatically.</p>
                </section>
                <section className="panel">
                  <ShieldCheck size={24} />
                  <h2>You approve replies</h2>
                  <p>Draft replies go to the Review queue, where you can check and edit them before approving a send. Connecting a mailbox or testing its connection does not send an email.</p>
                  <p className="muted">Mailbox credentials are encrypted at rest. Team access is controlled through workspace roles.</p>
                </section>
              </div>
              <section className="panel about-help">
                <h2>Getting started</h2>
                <ol>
                  <li>Open Mailboxes and connect your account using the secure settings from your email provider.</li>
                  <li>Use Test connection to check incoming mail (IMAP) and outgoing mail (SMTP) authentication. The results appear beneath the button.</li>
                  <li>Wait for the scheduled import, then open Inbox or ask ChatGPT to search your messages.</li>
                </ol>
                <p className="muted">Test connection checks your login only; it does not import messages. Older messages outside your mailbox’s initial import window will not appear in search.</p>
              </section>
            </>
          )}
        </div>
        <footer>
          ClickeMailMonitor <span>Considered replies. Connected inboxes.</span>
        </footer>
      </main>
      {connect && (
        <ConnectModal
          wid={wid}
          cfg={cfg}
          onClose={() => setConnect(false)}
          onSave={async () => {
            setConnect(false);
            await refresh();
            setView("mailboxes");
            setNotice(
              "Mailbox saved. Test the connection to verify your settings.",
            );
          }}
          run={run}
        />
      )}{" "}
      {draft && (
        <DraftModal
          draft={draft}
          boxes={boxes}
          run={run}
          onClose={() => setDraft(null)}
          onRefresh={refresh}
          onChange={setDraft}
          cfg={cfg}
        />
      )}
    </div>
  );
}
function PageTitle({ eyebrow, title, text, action }: any) {
  return (
    <div className="page-title">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{text}</p>
      </div>
      {action}
    </div>
  );
}
function Empty({ title, text }: any) {
  return (
    <div className="empty">
      <Mail size={32} />
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
function Badge({ text }: any) {
  return (
    <span
      className={
        "badge " +
        (/Connected|Accepted|Approved/.test(text)
          ? "good"
          : /Failed|uncertain/.test(text)
            ? "bad"
            : "")
      }
    >
      {text}
    </span>
  );
}
function Field({ label, children }: any) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function Auth({ cfg, onLogin, error, run }: any) {
  const params = new URLSearchParams(location.search);
  const [mode, setMode] = useState(
      params.get("action") === "reset"
        ? "reset"
        : params.get("action") === "verify"
          ? "verify"
          : "login",
    ),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget));
    setBusy(true);
    await run(async () => {
      if (mode === "login") {
        await api("/auth/login", "POST", data);
        await onLogin();
      } else {
        const r = await api("/auth/" + mode, "POST", {
          ...data,
          token: params.get("token"),
        });
        setMessage(r.message);
      }
    });
    setBusy(false);
  };
  return (
    <div className="auth-layout">
      <section className="auth-story">
        <div className="brand">
          <span className="brand-mark">
            <Mail />
          </span>
          ClickeMailMonitor
        </div>
        <div>
          <p className="eyebrow">YOUR INBOX, IN HAND</p>
          <h1>
            More connected.
            <br />
            Less complicated.
          </h1>
          <p>
            A calm place to read, monitor and respond to your email. Your
            hosting stays the same. You stay in control.
          </p>
          <div className="auth-feature">
            <ShieldCheck />
            Your approval. Every reply.
          </div>
          <div className="auth-feature">
            <Radio />
            Monitoring that keeps working.
          </div>
          <div className="auth-feature">
            <Plug />
            Your existing mailboxes, connected.
          </div>
        </div>
        <small>Built for thoughtful work.</small>
      </section>
      <section className="auth-form">
        <div>
          <p className="eyebrow">WELCOME TO YOUR WORKSPACE</p>
          <h2>
            {
              (
                {
                  login: "Good to see you.",
                  register: "Make room for better email.",
                  forgot: "Let’s get you back in.",
                  reset: "A fresh start.",
                  verify: "Verify your email.",
                  resend: "Request a new link.",
                } as any
              )[mode]
            }
          </h2>
          <p className="muted">
            {mode === "login"
              ? "Sign in to bring your inboxes together."
              : "Follow the steps below to continue."}
          </p>
          {error && (
            <div className="alert error" role="alert">
              {error}
            </div>
          )}
          {message && (
            <div className="alert success" role="status">
              {message}
            </div>
          )}
          <form onSubmit={submit}>
            {mode === "register" && (
              <>
                <Field label="Your name">
                  <input name="name" required autoComplete="name" />
                </Field>
                <Field label="Workspace name">
                  <input name="workspace" required />
                </Field>
              </>
            )}
            {!["reset", "verify"].includes(mode) && (
              <Field label="Email address">
                <input
                  type="email"
                  name="email"
                  required
                  autoComplete="email"
                />
              </Field>
            )}
            {["login", "register", "reset"].includes(mode) && (
              <Field label="Password">
                <input
                  type="password"
                  name="password"
                  required
                  minLength={mode === "login" ? 1 : 12}
                  autoComplete={
                    mode === "login" ? "current-password" : "new-password"
                  }
                />
                {mode !== "login" && <small>At least 12 characters.</small>}
              </Field>
            )}
            <button className="primary wide" disabled={busy}>
              {busy
                ? "Please wait…"
                : mode === "login"
                  ? "Sign in"
                  : mode === "verify"
                    ? "Verify email"
                    : "Continue"}
              <ArrowUpRight size={18} />
            </button>
          </form>
          <div className="auth-links">
            <button
              onClick={() => {
                setMode(mode === "login" ? "register" : "login");
                setMessage("");
              }}
            >
              {mode === "login" ? "Create an account" : "Back to sign in"}
            </button>
            <button onClick={() => setMode("forgot")}>Forgot password?</button>
            <button onClick={() => setMode("resend")}>
              Resend verification
            </button>
          </div>
          {cfg?.demo && (
            <div className="demo-login">
              <strong>Take a look around</strong>
              <p>
                Explore a working demo with synthetic emails. No real mail is
                sent.
              </p>
              <button
                className="secondary wide"
                onClick={() =>
                  void run(async () => {
                    await api("/auth/login", "POST", {
                      email: "demo@example.invalid",
                      password: "Demo-mail-only-2026",
                    });
                    await onLogin();
                  })
                }
              >
                Open demo workspace <ArrowUpRight size={17} />
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
function InboxView({
  onRefresh,
  wid,
  boxes,
  cfg,
  run,
  onDraft,
  onConnect,
  queueCount,
  onQueue,
  alertCount,
}: any) {
  const [messages, setMessages] = useState<any[]>([]),
    [selected, setSelected] = useState<any>(null),
    [q, setQ] = useState(""),
    [filter, setFilter] = useState(""),
    [folder, setFolder] = useState(""),
    [folders, setFolders] = useState<any[]>([]),
    [page, setPage] = useState(0),
    [busy, setBusy] = useState(false),
    [conversation, setConversation] = useState<any[]>([]);
  const [checkingAll, setCheckingAll] = useState(false);
  const [checkProgress, setCheckProgress] = useState("");
  const [checkResults, setCheckResults] = useState<{ email: string; message: string; failed: boolean }[]>([]);
  const checkAll = async () => {
    if (checkingAll) return;
    const liveBoxes = boxes.filter((b: any) => !b.demo);
    if (!liveBoxes.length) return;
    setCheckingAll(true);
    setCheckResults([]);
    try {
      for (const [index, b] of liveBoxes.entries()) {
        setCheckProgress(`Checking ${index + 1} of ${liveBoxes.length}: ${b.email}`);
        try {
          const result = await api("/mailboxes/" + b.id + "/check", "POST", {});
          setCheckResults(previous => [...previous, { email: b.email, message: result.imported ? `${result.imported} new message${result.imported === 1 ? "" : "s"} imported` : "No new messages", failed: false }]);
        } catch (error) {
          setCheckResults(previous => [...previous, { email: b.email, message: error instanceof Error ? error.message : "Check failed. Please try again.", failed: true }]);
        }
      }
      setCheckProgress("Mailbox checks finished. Results below.");
      await onRefresh();
    } catch {
      setCheckProgress("Checks finished, but the inbox could not refresh. Use Refresh messages to reload it.");
    } finally {
      setCheckingAll(false);
    }
  };
  const load = useCallback(async () => {
    setBusy(true);
    try {
      const data = await api(
        "/messages?" +
          new URLSearchParams({
            q,
            workspaceId: wid,
            mailboxId: filter,
            folder,
            page: String(page),
          }),
      );
      const allowed = new Set(boxes.map((b: any) => b.id));
      setMessages(data.filter((m: any) => allowed.has(m.mailbox_id)));
    } finally {
      setBusy(false);
    }
  }, [q, filter, folder, page, boxes, wid]);
  useEffect(() => {
    const t = setTimeout(() => void run(load), 250);
    return () => clearTimeout(t);
  }, [load]);
  useEffect(() => {
    setSelected(null);
  }, [boxes.map((b: any) => b.id).join(",")]);
  useEffect(() => {
    setFolder("");
    setFolders([]);
    if (filter)
      void run(async () =>
        setFolders(await api("/mailboxes/" + filter + "/folders")),
      );
  }, [filter]);
  async function select(id: string) {
    setSelected(await api("/messages/" + id));
    setConversation(await api("/messages/" + id + "/conversation"));
  }
  async function reply(all = false, ai = false) {
    const b = boxes.find((b: any) => b.id === selected.mailbox_id);
    const to = selected.headers.replyTo
      ?.map((x: any) => x.address)
      .filter(Boolean);
    const recipients = to?.length ? to : [selected.sender];
    const cc = all
      ? [
          ...new Set(
            [...selected.recipients.to, ...selected.recipients.cc]
              .map((x: any) => x.address)
              .filter((x: string) => x !== b.email && !recipients.includes(x)),
          ),
        ]
      : [];
    let body = "\n\n" + (b.settings.signature || "");
    if (ai)
      body = (await api("/messages/" + selected.id + "/suggest", "POST", {}))
        .body;
    onDraft(
      await api("/drafts", "POST", {
        mailboxId: b.id,
        messageId: selected.id,
        content: {
          to: recipients,
          cc,
          bcc: [],
          subject: /^re:/i.test(selected.subject)
            ? selected.subject
            : "Re: " + selected.subject,
          body,
          attachments: [],
        },
      }),
    );
  }
  return (
    <>
      <PageTitle
        eyebrow="A CLEARER VIEW OF YOUR DAY"
        title="Your inbox, in hand."
        text="A little less checking. A little more getting things done."
        action={
          <div className="inbox-page-actions">
            <button className="secondary" disabled={checkingAll || !boxes.some((b: any) => !b.demo)} aria-busy={checkingAll} onClick={() => void checkAll()}>
              <RefreshCw size={17} />{checkingAll ? "Checking all…" : "Check All Now"}
            </button>
            <button className="secondary" onClick={onConnect}>
              <Plus size={17} />Connect mailbox
            </button>
          </div>
        }
      />
      {checkProgress && <div className="connection-test-result check-all-results" role="status" aria-live="polite">
        <strong>{checkProgress}</strong>
        <p>Checks all live mailboxes in this workspace, including paused mailboxes. Scheduled pause settings stay unchanged.</p>
        {checkResults.map(result => <p key={result.email} className={result.failed ? "connection-test-error" : ""}><strong>{result.email}</strong>: {result.message}</p>)}
      </div>}
      <div className="stats">
        <div>
          <span className="stat-icon mint">
            <Inbox />
          </span>
          <span>
            <strong>{boxes.length}</strong>
            <small>Connected mailboxes{cfg?.demo ? " · demo" : ""}</small>
          </span>
          <span className="stat-foot">In one place</span>
        </div>
        <button onClick={onQueue}>
          <span className="stat-icon peach">
            <FileCheck />
          </span>
          <span>
            <strong>{queueCount}</strong>
            <small>Replies awaiting review</small>
          </span>
          <ArrowUpRight className="stat-arrow" size={20} />
        </button>
        <div>
          <span className="stat-icon lilac">
            <Radio />
          </span>
          <span>
            <strong>{alertCount}</strong>
            <small>New monitoring alerts</small>
          </span>
          <span className="stat-foot">Rule matches</span>
        </div>
      </div>
      <div className="inbox-panel">
        <div className="inbox-toolbar">
          <h3>
            All messages <span className="count">{messages.length}</span>
          </h3>
          <div className="search">
            <Search size={16} />
            <input
              aria-label="Search messages"
              placeholder="Search your inbox…"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(0);
              }}
            />
          </div>
          <select
            aria-label="Filter mailbox"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setPage(0);
            }}
          >
            <option value="">All mailboxes</option>
            {boxes.map((b: any) => (
              <option key={b.id} value={b.id}>
                {b.email}
              </option>
            ))}
          </select>
          {filter && (
            <select
              aria-label="Folder"
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
            >
              <option value="">All folders</option>
              {folders.map((f) => (
                <option key={f.path}>{f.path}</option>
              ))}
            </select>
          )}
          <button
            className="icon-btn"
            aria-label="Refresh messages"
            onClick={() => void run(load)}
          >
            <RefreshCw size={17} />
          </button>
        </div>
        <div className={"inbox-split " + (selected ? "has-selection" : "")}>
          <div className="message-list">
            {busy && <p className="loading">Updating your inbox…</p>}
            {messages.map((m) => (
              <button
                key={m.id}
                className={
                  "message-row " + (selected?.id === m.id ? "selected" : "")
                }
                onClick={() => void run(() => select(m.id))}
              >
                <span className={"sender-avatar tone-" + (m.sender.length % 4)}>
                  {initials(m.sender)}
                </span>
                <div className="message-summary">
                  <div>
                    <strong>{m.sender.split("@")[0]}</strong>
                    <time>{shortTime(m.received_at)}</time>
                  </div>
                  <h4>{m.subject}</h4>
                  <p>{m.preview}</p>
                  <small>
                    {boxes.find((b: any) => b.id === m.mailbox_id)?.email}
                  </small>
                </div>
                {m.unread && <span className="unread-dot" />}
              </button>
            ))}
            {!messages.length && !busy && (
              <Empty
                title="A quiet inbox"
                text="Messages will appear here after your first sync. Try a different search or filter."
              />
            )}
            <div className="pagination">
              <button
                className="text-btn"
                disabled={!page}
                onClick={() => setPage(page - 1)}
              >
                Previous
              </button>
              <span>Page {page + 1}</span>
              <button
                className="text-btn"
                disabled={messages.length < 40}
                onClick={() => setPage(page + 1)}
              >
                Next
              </button>
            </div>
          </div>
          <div className="message-reader">
            {selected ? (
              <>
                <div className="reader-top">
                  <button
                    className="text-btn"
                    onClick={() => setSelected(null)}
                  >
                    <ArrowLeft size={15} />
                    Back
                  </button>
                  <span className="muted">
                    {selected.folder} · {stamp(selected.received_at)}
                  </span>
                </div>
                <h2>{selected.subject}</h2>
                <div className="sender-line">
                  <span className="sender-avatar">
                    {initials(selected.sender)}
                  </span>
                  <div>
                    <strong>{selected.sender}</strong>
                    <small>
                      To{" "}
                      {selected.recipients.to
                        .map((x: any) => x.address)
                        .join(", ")}
                    </small>
                  </div>
                </div>
                <div className="message-body">
                  {selected.body || (
                    <div dangerouslySetInnerHTML={{ __html: selected.html }} />
                  )}
                </div>
                {selected.attachments.length > 0 && (
                  <div className="attachment-list">
                    {selected.attachments.map((a: any) => (
                      <a
                        key={a.index}
                        href={
                          "/api/messages/" +
                          selected.id +
                          "/attachments/" +
                          a.index
                        }
                      >
                        <Paperclip size={15} />
                        {a.filename} · {Math.ceil(a.size / 1024)} KB
                      </a>
                    ))}
                  </div>
                )}
                <div className="reply-actions">
                  <button
                    className="primary"
                    onClick={() => void run(() => reply())}
                  >
                    <Mail size={17} />
                    Write a reply
                  </button>
                  <button
                    className="secondary"
                    onClick={() => void run(() => reply(true))}
                  >
                    Reply all
                  </button>
                  {cfg?.aiEnabled && (
                    <button
                      className="secondary"
                      onClick={() => void run(() => reply(false, true))}
                    >
                      <Sparkles size={16} />
                      Suggest a reply
                    </button>
                  )}
                </div>
                <p className="reader-note">
                  <ShieldCheck size={14} />
                  Replies are saved as drafts. Sending always needs your
                  approval.
                </p>
                {conversation.length > 1 && (
                  <details>
                    <summary>
                      {conversation.length} messages in this conversation
                    </summary>
                    {conversation.map((m) => (
                      <div key={m.id} className="thread-message">
                        <strong>{m.sender}</strong>
                        <p>{m.body}</p>
                      </div>
                    ))}
                  </details>
                )}
              </>
            ) : (
              <div className="reader-empty">
                <div className="envelope-art">
                  <Mail size={55} strokeWidth={1} />
                  <span>
                    <CheckCheck size={22} />
                  </span>
                </div>
                <p className="eyebrow">A LITTLE SPACE TO FOCUS</p>
                <h2>
                  Good things start
                  <br />
                  with a conversation.
                </h2>
                <p>
                  Select a message to read it here.
                  <br />
                  We’ll keep everything else in view.
                </p>
                <div className="reader-note">
                  <ShieldCheck size={15} />
                  Your email stays with your provider
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="below-inbox">
        <span>
          <span className="status-dot" />{" "}
          {cfg?.demo
            ? "Demo data · no live connections"
            : "Monitoring runs independently of this page"}
        </span>
        <span>
          <Clock size={14} />
          Your time is better spent elsewhere.
        </span>
      </div>
    </>
  );
}
function Modal({ title, subtitle, onClose, children, wide = false }: any) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={"modal " + (wide ? "wide-modal" : "")}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>
          <button
            className="icon-btn"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <X />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
function ConnectModal({ wid, cfg, onClose, onSave }: any) {
  const provider = "generic";
  const [busy, setBusy] = useState(false),
    [localError, setLocalError] = useState("");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget));
    setBusy(true);
    setLocalError("");
    try {
      const connection = (kind: string) => ({
        host: f[kind + "Host"],
        port: Number(f[kind + "Port"]),
        tls: f[kind + "Tls"],
        username: f[kind + "Username"] || f.email,
      });
      await api("/mailboxes", "POST", {
        workspaceId: wid,
        email: f.email,
        provider,
        imap: connection("imap"),
        smtp: connection("smtp"),
        password: f.password,
        smtpPassword: f.smtpPassword || undefined,
        importDays: Number(f.importDays),
        pollSeconds: Number(f.pollSeconds),
        retentionDays: Number(f.retentionDays),
        signature: "",
        tone: "Friendly and professional",
        serverSavesSent: f.serverSavesSent === "on",
      });
      await onSave();
    } catch (error: any) {
      setLocalError(error.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Connect your mailbox"
      subtitle="Your email address and hosting stay exactly where they are."
      onClose={onClose}
      wide
    >
      <form onSubmit={submit}>
        {localError && (
          <div className="alert error" role="alert">
            {localError}
          </div>
        )}
        <div className="info-strip">
          Other email (IMAP/SMTP) — includes OrangeHost, VentraIP and other email hosts. Use the secure server settings supplied by your provider.
        </div>
        {cfg?.demo && (
          <div className="alert">
            Live connections are disabled in this demo. Use a configured
            production instance to add a real mailbox.
          </div>
        )}
        <Field label="Mailbox email address">
          <input
            name="email"
            type="email"
            required
            placeholder="hello@yourdomain.com.au"
          />
        </Field>
        <div className="form-columns">
          {["imap", "smtp"].map((kind) => (
            <section key={kind} className="form-section">
              <h3>
                {kind === "imap"
                  ? "Incoming mail · IMAP"
                  : "Outgoing mail · SMTP"}
              </h3>
              <Field label="Server hostname">
                <input
                  name={kind + "Host"}
                  required
                  placeholder="From your hosting control panel"
                />
              </Field>
              <div className="form-columns">
                <Field label="Port">
                  <select name={kind + "Port"}>
                    {(kind === "imap" ? [993, 143] : [465, 587]).map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Encryption">
                  <select name={kind + "Tls"}>
                    <option value="tls">TLS</option>
                    <option value="starttls">STARTTLS</option>
                  </select>
                </Field>
              </div>
              <Field label="Username (defaults to email)">
                <input name={kind + "Username"} autoComplete="off" />
              </Field>
              <Field
                label={
                  kind === "imap"
                    ? "Mailbox password"
                    : "SMTP password (if different)"
                }
              >
                <input
                  name={kind === "imap" ? "password" : "smtpPassword"}
                  type="password"
                  required={kind === "imap"}
                  autoComplete="new-password"
                />
              </Field>
            </section>
          ))}
        </div>
        <div className="form-columns three">
          <Field label="Initial import">
            <select name="importDays">
              <option value="7">Last 7 days</option>
              <option value="14">Last 14 days</option>
              <option value="30">Last 30 days</option>
            </select>
          </Field>
          <Field label="Check interval">
            <select name="pollSeconds">
              {[300, 900, 1200, 1800, 3600]
                .filter((s) => s >= cfg.minPollSeconds)
                .map((s) => (
                  <option key={s} value={s}>
                    {s / 60} minutes
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Keep local copies">
            <select name="retentionDays">
              <option value="30">30 days</option>
              <option value="90">90 days</option>
            </select>
          </Field>
        </div>
        <label className="checkbox">
          <input name="serverSavesSent" type="checkbox" />
          My provider automatically saves SMTP messages to Sent
        </label>
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy || cfg?.demo}>
            {busy ? "Connecting…" : "Save mailbox"}
            <ChevronRight size={17} />
          </button>
        </div>
      </form>
    </Modal>
  );
}
function DraftModal({ draft, boxes, onClose, onRefresh, onChange, cfg }: any) {
  const [content, setContent] = useState<any>({
      ...draft.content,
      to: draft.content.to.join(", "),
      cc: draft.content.cc.join(", "),
      bcc: draft.content.bcc.join(", "),
    }),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [localError, setLocalError] = useState("");
  useEffect(() => {
    setContent({
      ...draft.content,
      to: draft.content.to.join(", "),
      cc: draft.content.cc.join(", "),
      bcc: draft.content.bcc.join(", "),
    });
    setDirty(false);
  }, [draft.id, draft.version]);
  const locked = [
    "Sending",
    "Accepted by mail server",
    "Delivery uncertain",
  ].includes(draft.status);
  const update = (key: string, value: any) => {
    setDirty(true);
    setContent({ ...content, [key]: value });
  };
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setLocalError("");
    try {
      await fn();
      await onRefresh();
    } catch (e: any) {
      setLocalError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    const d = await api("/drafts/" + draft.id, "PUT", {
      version: draft.version,
      content: {
        ...content,
        to: split(content.to),
        cc: split(content.cc),
        bcc: split(content.bcc),
      },
    });
    onChange(d);
    setDirty(false);
  }
  return (
    <Modal
      title="Make it yours."
      subtitle="Review your reply and every recipient before approving."
      onClose={onClose}
      wide
    >
      <div className="draft-meta">
        <Badge text={draft.status} />
        <span>Version {draft.version}</span>
        <span>
          From:{" "}
          <strong>
            {boxes.find((b: any) => b.id === draft.mailbox_id)?.email}
          </strong>
        </span>
      </div>
      {localError && (
        <div className="alert error" role="alert">
          {localError}
        </div>
      )}
      <fieldset disabled={locked || busy}>
        <div className="form-columns">
          <Field label="To">
            <input
              value={content.to}
              onChange={(e) => update("to", e.target.value)}
            />
          </Field>
          <Field label="Cc">
            <input
              value={content.cc}
              onChange={(e) => update("cc", e.target.value)}
            />
          </Field>
        </div>
        <Field label="Bcc">
          <input
            value={content.bcc}
            onChange={(e) => update("bcc", e.target.value)}
            placeholder="Separate addresses with commas"
          />
        </Field>
        <Field label="Subject">
          <input
            value={content.subject}
            onChange={(e) => update("subject", e.target.value)}
          />
        </Field>
        <Field label="Your reply">
          <textarea
            className="compose-body"
            value={content.body}
            onChange={(e) => update("body", e.target.value)}
          />
        </Field>
        <label className="attachment-input">
          <Paperclip size={16} />
          Attach files (5 MB total)
          <input
            type="file"
            multiple
            onChange={(e) =>
              void action(async () => {
                const files = Array.from(e.target.files || []);
                const attachments = await Promise.all(
                  files.map(async (f) => ({
                    filename: f.name,
                    contentType: f.type || "application/octet-stream",
                    base64: await new Promise<string>((resolve, reject) => {
                      const reader = new FileReader();
                      reader.onload = () =>
                        resolve(String(reader.result).split(",")[1]);
                      reader.onerror = reject;
                      reader.readAsDataURL(f);
                    }),
                  })),
                );
                update("attachments", [...content.attachments, ...attachments]);
              })
            }
          />
        </label>
        {content.attachments.map((a: any, i: number) => (
          <div className="attachment-chip" key={i}>
            <Paperclip size={14} />
            {a.filename}
            <button
              aria-label={"Remove " + a.filename}
              onClick={() =>
                update(
                  "attachments",
                  content.attachments.filter((_: any, j: number) => i !== j),
                )
              }
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </fieldset>
      <div className="info-strip">
        <ShieldCheck size={18} />
        {dirty
          ? "Your edits need saving. Saving removes any previous approval."
          : draft.status === "Approved"
            ? "This version is approved. You can now queue it for sending."
            : "Approval applies only to this exact version, including recipients and attachments."}
      </div>
      <div className="modal-actions">
        <button className="secondary" onClick={onClose}>
          Close
        </button>
        {!locked && (
          <>
            <button
              className="secondary"
              disabled={busy || !dirty}
              onClick={() => void action(save)}
            >
              Save changes
            </button>
            {draft.status !== "Approved" ? (
              <button
                className="primary"
                disabled={busy || dirty}
                onClick={() =>
                  void action(async () => {
                    await api("/drafts/" + draft.id + "/approve", "POST", {
                      version: draft.version,
                    });
                    onChange(await api("/drafts/" + draft.id));
                  })
                }
              >
                <Check size={17} />
                Approve this version
              </button>
            ) : (
              <button
                className="primary"
                disabled={busy || dirty}
                onClick={() =>
                  void action(async () => {
                    await api("/drafts/" + draft.id + "/send", "POST", {});
                    onClose();
                  })
                }
              >
                <Send size={17} />
                {cfg?.demo ? "Simulate sending" : "Queue approved reply"}
              </button>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
function MailboxCard({ b, run, refresh, canManage }: any) {
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState("");
  const [checkError, setCheckError] = useState("");
  const checkNow = async () => {
    if (checking) return;
    setChecking(true);
    setCheckResult("");
    setCheckError("");
    try {
      const result = await api("/mailboxes/" + b.id + "/check", "POST", {});
      setCheckResult(result.imported ? `Check completed: ${result.imported} new message${result.imported === 1 ? "" : "s"} imported.` : "Check completed: no new messages found.");
    } catch (error) {
      setCheckError(error instanceof Error ? error.message : "Mailbox check failed. Please try again.");
    } finally {
      setChecking(false);
      await refresh().catch(() => setCheckError("Could not refresh mailbox details. Reload the page to see the latest status."));
    }
  };
  const [confirm, setConfirm] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ imap: string; smtp: string } | null>(null);
  const [testError, setTestError] = useState("");
  const testConnection = async () => {
    if (testing) return;
    setTesting(true);
    setTestResult(null);
    setTestError("");
    try {
      setTestResult(await api("/mailboxes/" + b.id + "/test", "POST", {}));
    } catch (error) {
      setTestError(error instanceof Error ? error.message : "Connection test failed. Please try again.");
    } finally {
      setTesting(false);
    }
  };
  return (
    <section className="panel mailbox-card">
      <div className="mailbox-card-top">
        <span className="round-icon">
          <Mail size={24} />
        </span>
        <Badge
          text={
            b.demo ? "Demo mailbox" : b.paused ? "Paused" : b.status
          }
        />
      </div>
      <h3>{b.email}</h3>
      <p className="muted">
        {b.provider === "orangehost"
          ? "OrangeHost"
          : b.provider === "ventraip"
            ? "VentraIP"
            : "IMAP / SMTP"}
      </p>
      <div className="mailbox-details">
        <span>
          Last successful check
          <strong>
            {b.last_check ? stamp(b.last_check) : "Not checked yet"}
          </strong>
        </span>
        <span>
          Check interval
          <strong>{Math.round(b.settings.pollSeconds / 60)} minutes</strong>
        </span>
        <span>
          Next check
          <strong>
            {b.paused ? "Paused" : b.demo ? "Simulated" : stamp(b.next_check)}
          </strong>
        </span>
      </div>
      <div className="card-actions">
        <button className="secondary" disabled={checking || b.demo} aria-busy={checking} onClick={() => void checkNow()}>
          <RefreshCw size={15} />{checking ? "Checking…" : "Check Now"}
        </button>
        {canManage && <>
          <button
            className="secondary"
            onClick={() => void testConnection()}
            disabled={testing}
            aria-busy={testing}
          >
            <Plug size={15} />
            {testing ? "Testing…" : "Test connection"}
          </button>
          <button
            className="secondary"
            onClick={() =>
              void run(async () => {
                await api("/mailboxes/" + b.id, "PATCH", { paused: !b.paused });
                await refresh();
              })
            }
          >
            {b.paused ? <Play size={15} /> : <Pause size={15} />}{" "}
            {b.paused ? "Resume" : "Pause"}
          </button>
          <button
            className="icon-btn danger"
            aria-label="Disconnect mailbox"
            onClick={() => setConfirm(true)}
          >
            <Trash2 size={16} />
          </button>
        </>}
      </div>
      <div className="connection-test-result" role="status" aria-live="polite" aria-atomic="true">
        {checking && <p>Checking for new email… Keep this page open for the result.</p>}
        {checkResult && <p>{checkResult}</p>}
        {checkError && <p className="connection-test-error">{checkError}</p>}
      </div>
      {b.paused && <p className="muted">Check Now runs once; scheduled monitoring stays paused.</p>}
      <div className="connection-test-result" role="status" aria-live="polite" aria-atomic="true">
        {testing && <p>Checking incoming mail (IMAP) and outgoing mail (SMTP)…</p>}
        {testResult && (
          <>
            <strong>Connection test completed</strong>
            <p>Incoming mail (IMAP): {testResult.imap}</p>
            <p>Outgoing mail (SMTP): {testResult.smtp}</p>
          </>
        )}
        {testError && <p className="connection-test-error">{testError}</p>}
      </div>
      {canManage && <p className="muted">Tests your mailbox login without sending email. Use Check Now to import messages immediately, or wait for a scheduled check.</p>}
      {confirm && (
        <div className="alert error">
          <p>
            Disconnect this mailbox and delete its stored messages, drafts and
            credentials?
          </p>
          <button
            className="danger"
            onClick={() =>
              void run(async () => {
                await api("/mailboxes/" + b.id, "DELETE");
                await refresh();
              })
            }
          >
            Disconnect and delete
          </button>
          <button onClick={() => setConfirm(false)}>Keep mailbox</button>
        </div>
      )}
    </section>
  );
}
function Monitoring({ boxes, alerts, run, refresh }: any) {
  const [rules, setRules] = useState<any[]>([]),
    [show, setShow] = useState(false);
  const load = useCallback(async () => {
    const data = await api("/rules");
    setRules(
      data.filter((r: any) => boxes.some((b: any) => b.id === r.mailbox_id)),
    );
  }, [boxes]);
  useEffect(() => {
    void run(load);
  }, [load]);
  return (
    <>
      <PageTitle
        eyebrow="LESS CHECKING, MORE KNOWING"
        title="Keep an eye on what matters."
        text="Choose the signals. We’ll bring matching messages to your attention."
        action={
          <button
            className="primary"
            onClick={() => setShow(true)}
            disabled={!boxes.length}
          >
            <Plus size={17} />
            Create a rule
          </button>
        }
      />
      <div className="monitor-grid">
        <section className="panel">
          <div className="panel-heading">
            <h3>Latest alerts</h3>
            <Badge text="Rule-based matches" />
          </div>
          {alerts.length ? (
            alerts.map((a: any) => (
              <div className={"alert-row " + (a.seen ? "seen" : "")} key={a.id}>
                <span className="round-icon">
                  <Radio size={18} />
                </span>
                <div className="grow">
                  <strong>{a.subject}</strong>
                  <p>{a.sender}</p>
                  <small>
                    {a.rule_name} · {stamp(a.created_at)}
                  </small>
                </div>
                {!a.seen && (
                  <button
                    className="text-btn"
                    onClick={() =>
                      void run(async () => {
                        await api("/alerts/" + a.id, "PATCH", {});
                        await refresh();
                      })
                    }
                  >
                    Mark seen
                  </button>
                )}
              </div>
            ))
          ) : (
            <Empty
              title="Nothing needs your attention"
              text="Matching emails will appear here as the worker checks your mailboxes."
            />
          )}
        </section>
        <section className="panel">
          <div className="panel-heading">
            <h3>Your rules</h3>
            <span className="count">{rules.length}</span>
          </div>
          {rules.map((r) => (
            <div className="rule-row" key={r.id}>
              <Radio size={18} />
              <div className="grow">
                <strong>{r.name}</strong>
                <p>
                  {Object.entries(r.criteria)
                    .map(([k, v]) => `${k}: ${v}`)
                    .join(" · ") || "All incoming messages"}
                </p>
                <small>
                  {boxes.find((b: any) => b.id === r.mailbox_id)?.email}
                </small>
              </div>
              <button
                className="icon-btn"
                aria-label={"Delete " + r.name}
                onClick={() =>
                  void run(async () => {
                    await api("/rules/" + r.id, "DELETE");
                    await load();
                  })
                }
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          {!rules.length && (
            <Empty
              title="Start with one useful rule"
              text="Watch a sender, domain, recipient or subject keyword."
            />
          )}
        </section>
      </div>
      {show && (
        <Modal
          title="Create a monitoring rule"
          subtitle="All conditions must match. These are deterministic rules, not AI urgency scores."
          onClose={() => setShow(false)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = Object.fromEntries(new FormData(e.currentTarget));
              void run(async () => {
                const criteria: any = {};
                for (const key of ["sender", "domain", "recipient", "subject"])
                  if (f[key]) criteria[key] = f[key];
                if (f.unread === "on") criteria.unread = true;
                await api("/rules", "POST", {
                  mailboxId: f.mailboxId,
                  name: f.name,
                  criteria,
                });
                await load();
                setShow(false);
              });
            }}
          >
            <Field label="Rule name">
              <input name="name" required />
            </Field>
            <Field label="Mailbox">
              <select name="mailboxId">
                {boxes.map((b: any) => (
                  <option value={b.id} key={b.id}>
                    {b.email}
                  </option>
                ))}
              </select>
            </Field>
            {[
              ["sender", "Exact sender email"],
              ["domain", "Sender domain"],
              ["recipient", "Recipient email"],
              ["subject", "Subject contains"],
            ].map(([k, l]) => (
              <Field key={k} label={l}>
                <input name={k} />
              </Field>
            ))}
            <label className="checkbox">
              <input type="checkbox" name="unread" />
              Unread messages only
            </label>
            <div className="modal-actions">
              <button className="primary">Create rule</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
function Team({ wid, role, boxes, run, setNotice }: any) {
  const [members, setMembers] = useState<any[]>([]),
    [permissions, setPermissions] = useState<any>({});
  const load = useCallback(async () => {
    if (role === "member") return;
    setMembers(await api("/workspaces/" + wid + "/members"));
    const p: any = {};
    for (const b of boxes)
      p[b.id] = await api("/mailboxes/" + b.id + "/permissions");
    setPermissions(p);
  }, [wid, role, boxes]);
  useEffect(() => {
    void run(load);
  }, [load]);
  if (role === "member")
    return (
      <Empty
        title="Your team is managed by your administrator"
        text="Ask a workspace owner or administrator to change team access."
      />
    );
  return (
    <>
      <PageTitle
        eyebrow="A PLACE FOR YOUR PEOPLE"
        title="Better email, together."
        text="Give each person access to the mailboxes they need."
      />
      <div className="panel padded">
        <h3>Invite a teammate</h3>
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            const data = Object.fromEntries(new FormData(e.currentTarget));
            void run(async () => {
              const r = await api(
                "/workspaces/" + wid + "/invite",
                "POST",
                data,
              );
              setNotice(r.message);
            });
          }}
        >
          <input
            aria-label="Invite email"
            name="email"
            type="email"
            placeholder="colleague@company.com.au"
            required
          />
          <select aria-label="Role" name="role">
            <option value="member">Member</option>
            <option value="administrator">Administrator</option>
          </select>
          <button className="primary">
            Send invitation
            <ArrowUpRight size={16} />
          </button>
        </form>
      </div>
      <div className="panel">
        {members.map((m) => (
          <div className="team-row" key={m.id}>
            <div className="team-person">
              <span className="avatar">{initials(m.name)}</span>
              <div className="grow">
                <strong>{m.name}</strong>
                <small>{m.email}</small>
              </div>
              <Badge text={m.role} />
              {m.role !== "owner" && role === "owner" && (
                <>
                  <button
                    className="text-btn"
                    onClick={() =>
                      void run(async () => {
                        await api(
                          "/workspaces/" + wid + "/members/" + m.id,
                          "PATCH",
                          {
                            role:
                              m.role === "member" ? "administrator" : "member",
                          },
                        );
                        await load();
                      })
                    }
                  >
                    Make {m.role === "member" ? "administrator" : "member"}
                  </button>
                  <button
                    className="text-btn danger"
                    onClick={() =>
                      void run(async () => {
                        await api(
                          "/workspaces/" + wid + "/members/" + m.id,
                          "DELETE",
                        );
                        await load();
                      })
                    }
                  >
                    Remove
                  </button>
                </>
              )}
            </div>
            {m.role === "member" &&
              boxes.map((b: any) => {
                const p = permissions[b.id]?.find(
                  (p: any) => p.user_id === m.id,
                );
                return (
                  <div className="permission-row" key={b.id}>
                    <span>{b.email}</span>
                    <select
                      aria-label={"Access to " + b.email + " for " + m.name}
                      value={!p ? "none" : p.can_send ? "send" : "read"}
                      onChange={(e) => {
                        const v = e.target.value;
                        void run(async () => {
                          await api(
                            "/mailboxes/" + b.id + "/permissions/" + m.id,
                            "PUT",
                            { access: v !== "none", canSend: v === "send" },
                          );
                          await load();
                        });
                      }}
                    >
                      <option value="none">No access</option>
                      <option value="read">Read and monitor</option>
                      <option value="send">Read, draft and approve</option>
                    </select>
                  </div>
                );
              })}
          </div>
        ))}
      </div>
    </>
  );
}
function SettingsView({ work, boxes, run, onSaved, cfg }: any) {
  const [connections, setConnections] = useState<any[]>([]);
  useEffect(() => {
    void run(async () => setConnections(await api("/connections")));
  }, []);
  return (
    <>
      <PageTitle
        eyebrow="MAKE YOURSELF AT HOME"
        title="The way you work."
        text="Fine-tune your replies, local retention and connected tools."
      />
      {work?.role !== "member" && (
        <>
          <section className="panel padded">
            <h3>Workspace preferences</h3>
            <form
              key={work.id}
              onSubmit={(e) => {
                e.preventDefault();
                const f = Object.fromEntries(new FormData(e.currentTarget));
                void run(async () => {
                  await api("/workspaces/" + work.id, "PATCH", {
                    referenceMaterial: f.referenceMaterial,
                    aiDailyLimit: Number(f.aiDailyLimit),
                    notifications: f.notifications === "on",
                  });
                  await onSaved();
                });
              }}
            >
              <Field label="Reference material for suggested replies">
                <textarea
                  name="referenceMaterial"
                  defaultValue={work.settings.referenceMaterial || ""}
                  placeholder="Add confirmed policies and background information. Avoid secrets."
                />
              </Field>
              <div className="form-columns">
                <Field label="Daily AI draft limit">
                  <input
                    type="number"
                    min="1"
                    max="100"
                    name="aiDailyLimit"
                    defaultValue={work.settings.aiDailyLimit || 20}
                  />
                </Field>
                <Field label="AI provider status">
                  <span>
                    {cfg.aiEnabled
                      ? "Configured on the server"
                      : "Not configured — manual replies are available"}
                  </span>
                </Field>
              </div>
              <label className="checkbox">
                <input
                  type="checkbox"
                  name="notifications"
                  defaultChecked={work.settings.notifications !== false}
                />
                Show in-app monitoring indicators
              </label>
              <button className="primary">Save preferences</button>
            </form>
          </section>
          {boxes.map((b: any) => (
            <section className="panel padded" key={b.id}>
              <h3>{b.email}</h3>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = Object.fromEntries(new FormData(e.currentTarget));
                  void run(async () => {
                    await api("/mailboxes/" + b.id, "PATCH", {
                      signature: f.signature,
                      tone: f.tone,
                      retentionDays: Number(f.retentionDays),
                      pollSeconds: Number(f.pollSeconds),
                    });
                    await onSaved();
                  });
                }}
              >
                <Field label="Signature">
                  <textarea
                    name="signature"
                    defaultValue={b.settings.signature}
                  />
                </Field>
                <Field label="Reply tone">
                  <input name="tone" defaultValue={b.settings.tone} />
                </Field>
                <div className="form-columns">
                  <Field label="Retain local messages (days)">
                    <input
                      type="number"
                      name="retentionDays"
                      min="1"
                      max="365"
                      defaultValue={b.settings.retentionDays}
                    />
                  </Field>
                  <Field label="Check interval (seconds)">
                    <input
                      type="number"
                      name="pollSeconds"
                      min={cfg.minPollSeconds}
                      max="86400"
                      defaultValue={b.settings.pollSeconds}
                    />
                  </Field>
                </div>
                <p className="muted">
                  Retention removes local copies only. It does not delete
                  messages from your mail provider.
                </p>
                <button className="primary">Save mailbox preferences</button>
              </form>
            </section>
          ))}
        </>
      )}
      <section className="panel padded">
        <h3>ChatGPT connection</h3>
        <p>
          Connect ChatGPT to your authorised mailboxes using this server’s MCP
          endpoint.
        </p>
        <code className="endpoint">{location.origin}/mcp</code>
        <p className="muted">
          The deployed service must use HTTPS. Sign in and grant access during
          connection. Replies still need approval here.
        </p>
        {connections.map((c) => (
          <div key={c.client_id} className="connection-row">
            <span>{c.name || "Connected application"}</span>
            <button
              className="secondary"
              onClick={() =>
                void run(async () => {
                  await api("/connections/" + c.client_id, "DELETE");
                  setConnections(await api("/connections"));
                })
              }
            >
              Revoke access
            </button>
          </div>
        ))}
        {!connections.length && (
          <p className="muted">No active ChatGPT connections.</p>
        )}
      </section>
    </>
  );
}
function ActivityView({ wid, role, run }: any) {
  const [items, setItems] = useState<any[]>([]);
  useEffect(() => {
    if (role !== "member")
      void run(async () =>
        setItems(await api("/workspaces/" + wid + "/audit")),
      );
  }, [wid, role]);
  return (
    <>
      <PageTitle
        eyebrow="A CLEAR RECORD"
        title="Know what happened."
        text="A minimal activity trail, without storing email content in logs."
      />
      <section className="panel">
        {items.map((a, i) => (
          <div className="activity-row" key={i}>
            <Activity size={18} />
            <strong className="grow">{a.action.replaceAll(".", " · ")}</strong>
            <time>{stamp(a.created_at)}</time>
          </div>
        ))}
        {!items.length && (
          <Empty
            title="No activity to show"
            text={
              role === "member"
                ? "Activity logs are available to workspace administrators."
                : "Connections, approvals and sends will appear here."
            }
          />
        )}
      </section>
    </>
  );
}
function OAuthConsent({ token, run }: any) {
  const [pending, setPending] = useState<any>(null);
  useEffect(() => {
    void run(async () =>
      setPending(
        await api("/oauth/pending?token=" + encodeURIComponent(token)),
      ),
    );
  }, [token]);
  if (!pending) return null;
  return (
    <section className="panel padded">
      <h2>Connect {pending.clientName}?</h2>
      <p>
        This application can read your authorised mailboxes and prepare drafts.
        Sending requires your approval in ClickeMailMonitor.
      </p>
      <p>Access renews automatically for up to 90 days. You can revoke this connection in Settings at any time. Password reset also revokes access.</p>
      <p className="muted">Return address: {pending.redirectUri}</p>
      <div className="card-actions">
        {[false, true].map((allow) => (
          <button
            key={String(allow)}
            className={allow ? "primary" : "secondary"}
            onClick={() =>
              void run(async () => {
                const r = await api("/oauth/consent", "POST", { token, allow });
                location.assign(r.redirect);
              })
            }
          >
            {allow ? "Allow connection" : "Cancel"}
          </button>
        ))}
      </div>
    </section>
  );
}
createRoot(document.getElementById("root")!).render(<App />);

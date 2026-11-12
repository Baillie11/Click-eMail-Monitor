import path from "node:path";
import express from "express";
import { openDatabase } from "./db.js";
import { migrate } from "./schema.js";
import { config, validateConfig } from "./config.js";
import { createApp, errorHandler } from "./app.js";
import { seed } from "./seed.js";
import { tick } from "./worker.js";
validateConfig();
const db = openDatabase();
await migrate(db);
if (config.demo) await seed(db);
const app = createApp(db);
app.use(express.static(path.resolve("dist/web")));
app.get("/{*path}", (_req, res) =>
  res.sendFile(path.resolve("dist/web/index.html")),
);
app.use(errorHandler);
const server = app.listen(config.port, process.env.HOST || "127.0.0.1", () =>
  console.log(
    `ClickeMailMonitor: ${config.origin}${config.demo ? " — DEMO, synthetic email only" : ""}`,
  ),
);
let busy = false;
const timer = config.demo
  ? setInterval(async () => {
      if (busy) return;
      busy = true;
      try {
        await tick(db);
      } catch {
        console.error("Demo worker check failed.");
      } finally {
        busy = false;
      }
    }, 3000)
  : undefined;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    if (timer) clearInterval(timer);
    server.close(() => {
      void db.close().then(() => process.exit(0));
    });
  });

import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import https from "https";
import http from "http";
import router from "./routes";
import proxyRouter from "./routes/proxy";
import adminRouter from "./routes/admin";
import { logger } from "./lib/logger";
import { initPool } from "./lib/backendPool";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) { return { id: req.id, method: req.method, url: req.url?.split("?")[0] }; },
      res(res) { return { statusCode: res.statusCode }; },
    },
  }),
);
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

app.use("/api", router);
app.use("/v1", proxyRouter);
app.use("/v1/admin", adminRouter);

// ─── Startup: initialize backend pool ─────────────────────────────────────
async function startup(): Promise<void> {
  await initPool();

  // Auto-registration: if this instance has MASTER_URL set, register itself
  const masterUrl = process.env.MASTER_URL?.replace(/\/$/, "");
  const masterAdminKey = process.env.MASTER_ADMIN_KEY;
  const selfKey = process.env.PROXY_API_KEY;

  // Auto-detect SELF_URL from Replit environment
  const replSlug = process.env.REPL_SLUG;
  const replOwner = process.env.REPL_OWNER;
  const selfUrl = (
    process.env.SELF_URL
    || (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : null)
    || (replSlug && replOwner ? `https://${replSlug}--${replOwner}.replit.app` : null)
  )?.replace(/\/$/, "");

  // Auto-detect SELF_LABEL
  const selfLabel = process.env.SELF_LABEL || replSlug || "sub-node";

  if (masterUrl && masterAdminKey && selfUrl && selfKey) {
    logger.info({ masterUrl, selfUrl, selfLabel }, "Auto-registering with master instance...");
    try {
      await registerWithMaster(masterUrl, masterAdminKey, selfUrl, selfKey, selfLabel);
      logger.info("Auto-registration successful");
    } catch (err) {
      logger.warn({ err }, "Auto-registration failed (will retry is not implemented — check MASTER_URL/MASTER_ADMIN_KEY)");
    }
  }
}

function registerWithMaster(
  masterUrl: string,
  adminKey: string,
  selfUrl: string,
  selfKey: string,
  label?: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify({ url: selfUrl, key: selfKey, label }), "utf-8");
    const targetUrl = new URL(masterUrl + "/v1/admin/backends");
    const isHttps = targetUrl.protocol === "https:";
    const lib = isHttps ? https : http;

    const req = lib.request(
      {
        hostname: targetUrl.hostname,
        port: targetUrl.port || (isHttps ? 443 : 80),
        path: targetUrl.pathname,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": body.length,
          "authorization": `Bearer ${adminKey}`,
          "host": targetUrl.host,
        },
        timeout: 15_000,
      },
      (res) => {
        res.resume();
        if ((res.statusCode ?? 500) < 300) resolve();
        else reject(new Error(`Master returned HTTP ${res.statusCode}`));
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("Registration request timed out")));
    req.write(body);
    req.end();
  });
}

startup().catch((err) => logger.error({ err }, "Startup error"));

export default app;

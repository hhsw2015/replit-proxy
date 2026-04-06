import https from "https";
import http from "http";
import { logger } from "./logger";
import { loadStoredBackends, type StoredBackend } from "./db";
import type { IncomingMessage, ServerResponse } from "http";

const FAILURE_THRESHOLD = 3;
const DISABLE_DURATION_MS = 60_000;

interface BackendState extends StoredBackend {
  failures: number;
  disabledUntil: number;
}

let pool: BackendState[] = [];
let roundRobinIndex = 0;

export async function initPool(): Promise<void> {
  const stored = await loadStoredBackends();
  const fromEnv = parseEnvBackends();
  const all = [...stored, ...fromEnv];
  const seen = new Set<string>();
  pool = all
    .filter((b) => {
      if (seen.has(b.url)) return false;
      seen.add(b.url);
      return true;
    })
    .map((b) => ({ ...b, failures: 0, disabledUntil: 0 }));
  logger.info({ count: pool.length }, "Backend pool initialized");
}

const DEFAULT_KEY = "sk-proxy-default-key-2024";

function labelFromUrl(url: string): string {
  try {
    const host = new URL(url).hostname;
    return host.split(".")[0] || "sub-node";
  } catch { return "sub-node"; }
}

function parseEnvBackends(): StoredBackend[] {
  const raw = process.env.BACKENDS;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Array<{ url: string; key?: string; label?: string }>;
    return parsed.map((b) => ({
      url: b.url.replace(/\/$/, ""),
      key: b.key || DEFAULT_KEY,
      addedAt: 0,
      label: b.label || labelFromUrl(b.url),
    }));
  } catch {
    logger.error("BACKENDS env var is not valid JSON");
    return [];
  }
}

export function addToPool(backend: StoredBackend): void {
  const url = backend.url.replace(/\/$/, "");
  const existing = pool.findIndex((b) => b.url === url);
  if (existing >= 0) {
    pool[existing] = { ...backend, url, failures: 0, disabledUntil: 0 };
  } else {
    pool.push({ ...backend, url, failures: 0, disabledUntil: 0 });
  }
}

export function removeFromPool(url: string): void {
  const normalized = url.replace(/\/$/, "");
  pool = pool.filter((b) => b.url !== normalized);
}

export function hasBackends(): boolean {
  return pool.length > 0;
}

export function getPoolStatus(): object[] {
  const now = Date.now();
  return pool.map((b) => ({
    url: b.url,
    label: b.label ?? null,
    failures: b.failures,
    status: b.disabledUntil > now ? "down" : "up",
    addedAt: b.addedAt,
  }));
}

function pickBackend(): BackendState | null {
  const now = Date.now();
  const available = pool.filter((b) => b.disabledUntil <= now);
  if (available.length === 0) return null;
  const idx = roundRobinIndex % available.length;
  roundRobinIndex = (roundRobinIndex + 1) % available.length;
  return available[idx];
}

function markFailure(backend: BackendState): void {
  backend.failures++;
  if (backend.failures >= FAILURE_THRESHOLD) {
    backend.disabledUntil = Date.now() + DISABLE_DURATION_MS;
    logger.warn({ url: backend.url }, `Backend disabled for ${DISABLE_DURATION_MS / 1000}s`);
  }
}

function markSuccess(backend: BackendState): void {
  backend.failures = 0;
  backend.disabledUntil = 0;
}

function makeRequest(
  backend: BackendState,
  method: string,
  path: string,
  incomingHeaders: Record<string, string | string[] | undefined>,
  body: Buffer,
): { req: ReturnType<typeof https.request>; res: Promise<IncomingMessage> } {
  const targetUrl = new URL(backend.url + path);
  const isHttps = targetUrl.protocol === "https:";
  const lib = isHttps ? https : http;

  const reqHeaders: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(incomingHeaders)) {
    if (!v) continue;
    const lower = k.toLowerCase();
    if (lower === "host" || lower === "connection" || lower === "transfer-encoding") continue;
    reqHeaders[k] = v as string | string[];
  }
  reqHeaders["authorization"] = `Bearer ${backend.key}`;
  reqHeaders["host"] = targetUrl.host;
  if (body.length > 0) reqHeaders["content-length"] = String(body.length);

  let resolveRes!: (v: IncomingMessage) => void;
  let rejectRes!: (e: Error) => void;
  const resPromise = new Promise<IncomingMessage>((res, rej) => {
    resolveRes = res;
    rejectRes = rej;
  });

  const req = lib.request(
    {
      hostname: targetUrl.hostname,
      port: targetUrl.port || (isHttps ? 443 : 80),
      path: targetUrl.pathname + targetUrl.search,
      method,
      headers: reqHeaders,
      timeout: 120_000,
    },
    resolveRes,
  );

  req.on("error", rejectRes);
  req.on("timeout", () => req.destroy(new Error("Backend request timed out")));

  if (body.length > 0) req.write(body);
  req.end();

  return { req, res: resPromise };
}

export interface ForwardResult {
  statusCode: number;
  headers: Record<string, string | string[]>;
  body: Buffer;
}

export async function forwardRequest(
  method: string,
  path: string,
  headers: Record<string, string | string[] | undefined>,
  body: Buffer,
  retries = 2,
): Promise<ForwardResult> {
  let lastError: Error | null = null;
  const tried = new Set<BackendState>();

  for (let attempt = 0; attempt <= retries; attempt++) {
    const backend = pickBackend();
    if (!backend) throw new Error("No healthy backends available in the pool");
    if (tried.has(backend)) continue;
    tried.add(backend);

    try {
      const { res: resPromise } = makeRequest(backend, method, path, headers, body);
      const res = await resPromise;
      const chunks: Buffer[] = [];
      await new Promise<void>((resolve, reject) => {
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", resolve);
        res.on("error", reject);
      });
      const result: ForwardResult = {
        statusCode: res.statusCode ?? 502,
        headers: res.headers as Record<string, string | string[]>,
        body: Buffer.concat(chunks),
      };
      if (result.statusCode >= 500) {
        markFailure(backend);
        lastError = new Error(`Backend returned ${result.statusCode}`);
        continue;
      }
      markSuccess(backend);
      return result;
    } catch (err) {
      markFailure(backend);
      lastError = err instanceof Error ? err : new Error(String(err));
      logger.warn({ url: backend.url, err: lastError.message }, "Backend failed, trying next");
    }
  }

  throw lastError ?? new Error("All backend attempts failed");
}

export async function forwardStream(
  method: string,
  path: string,
  headers: Record<string, string | string[] | undefined>,
  body: Buffer,
  clientRes: ServerResponse,
  retries = 2,
): Promise<void> {
  let lastError: Error | null = null;
  const tried = new Set<BackendState>();

  for (let attempt = 0; attempt <= retries; attempt++) {
    const backend = pickBackend();
    if (!backend) throw new Error("No healthy backends available in the pool");
    if (tried.has(backend)) continue;
    tried.add(backend);

    try {
      const { res: resPromise } = makeRequest(backend, method, path, headers, body);
      const res = await resPromise;

      if ((res.statusCode ?? 502) >= 500) {
        markFailure(backend);
        lastError = new Error(`Backend returned ${res.statusCode}`);
        continue;
      }

      markSuccess(backend);

      // Pipe headers and stream body directly to client
      const outHeaders: Record<string, string | string[]> = {};
      for (const [k, v] of Object.entries(res.headers)) {
        if (!v || k.toLowerCase() === "transfer-encoding") continue;
        outHeaders[k] = v as string | string[];
      }
      clientRes.writeHead(res.statusCode ?? 200, outHeaders);

      await new Promise<void>((resolve, reject) => {
        res.on("data", (chunk: Buffer) => {
          clientRes.write(chunk);
        });
        res.on("end", () => {
          clientRes.end();
          resolve();
        });
        res.on("error", reject);
        clientRes.on("close", () => res.destroy());
      });
      return;
    } catch (err) {
      markFailure(backend);
      lastError = err instanceof Error ? err : new Error(String(err));
      logger.warn({ url: backend.url, err: lastError.message }, "Backend stream failed, trying next");
    }
  }

  throw lastError ?? new Error("All backend stream attempts failed");
}

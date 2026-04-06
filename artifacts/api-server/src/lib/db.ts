import Database from "@replit/database";
import { logger } from "./logger";

const DB_KEY = "proxy_backends";

export interface StoredBackend {
  url: string;
  key: string;
  addedAt: number;
  label?: string;
}

let db: InstanceType<typeof Database> | null = null;

function getDb(): InstanceType<typeof Database> {
  if (!db) db = new Database();
  return db;
}

export async function loadStoredBackends(): Promise<StoredBackend[]> {
  try {
    const val = await getDb().get(DB_KEY) as StoredBackend[] | null;
    return Array.isArray(val) ? val : [];
  } catch (err) {
    logger.error({ err }, "Failed to load backends from DB");
    return [];
  }
}

export async function saveStoredBackends(backends: StoredBackend[]): Promise<void> {
  try {
    await getDb().set(DB_KEY, backends);
  } catch (err) {
    logger.error({ err }, "Failed to save backends to DB");
  }
}

export async function registerBackend(url: string, key: string, label?: string): Promise<StoredBackend> {
  const backends = await loadStoredBackends();
  const normalized = url.replace(/\/$/, "");
  const existing = backends.findIndex((b) => b.url === normalized);
  const entry: StoredBackend = { url: normalized, key, addedAt: Date.now(), label };
  if (existing >= 0) {
    backends[existing] = entry;
    logger.info({ url: normalized }, "Backend updated in DB");
  } else {
    backends.push(entry);
    logger.info({ url: normalized, total: backends.length }, "Backend registered in DB");
  }
  await saveStoredBackends(backends);
  return entry;
}

export async function removeBackend(url: string): Promise<boolean> {
  const backends = await loadStoredBackends();
  const normalized = url.replace(/\/$/, "");
  const filtered = backends.filter((b) => b.url !== normalized);
  if (filtered.length === backends.length) return false;
  await saveStoredBackends(filtered);
  logger.info({ url: normalized }, "Backend removed from DB");
  return true;
}

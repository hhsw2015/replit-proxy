import { Router, type Request, type Response } from "express";
import { registerBackend, removeBackend } from "../lib/db";
import { addToPool, removeFromPool, getPoolStatus } from "../lib/backendPool";
import { logger } from "../lib/logger";

const router = Router();

const adminKey = process.env.ADMIN_KEY || "sk-admin-default-key-2024";

function verifyAdmin(req: Request, res: Response): boolean {
  if (!adminKey) {
    res.status(503).json({ error: "ADMIN_KEY not configured on this instance" });
    return false;
  }
  const auth = req.headers["authorization"];
  if (!auth || auth !== `Bearer ${adminKey}`) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

/**
 * GET /v1/admin/backends
 * 查看当前后端池状态
 */
router.get("/backends", (req, res) => {
  if (!verifyAdmin(req, res)) return;
  res.json({ backends: getPoolStatus() });
});

/**
 * POST /v1/admin/backends
 * 注册或更新一个后端
 * Body: { url, key, label? }
 */
router.post("/backends", async (req: Request, res: Response) => {
  if (!verifyAdmin(req, res)) return;

  const { url, key, label } = req.body as { url?: string; key?: string; label?: string };
  if (!url || !key) {
    res.status(400).json({ error: "url and key are required" });
    return;
  }

  try {
    const entry = await registerBackend(url, key, label);
    addToPool(entry);
    logger.info({ url, label }, "Backend registered via admin API");
    res.json({ ok: true, backend: entry, pool: getPoolStatus() });
  } catch (err) {
    logger.error({ err }, "Failed to register backend");
    res.status(500).json({ error: String(err) });
  }
});

/**
 * DELETE /v1/admin/backends
 * 移除一个后端
 * Body: { url }
 */
router.delete("/backends", async (req: Request, res: Response) => {
  if (!verifyAdmin(req, res)) return;

  const { url } = req.body as { url?: string };
  if (!url) {
    res.status(400).json({ error: "url is required" });
    return;
  }

  try {
    const removed = await removeBackend(url);
    if (removed) removeFromPool(url);
    res.json({ ok: removed, pool: getPoolStatus() });
  } catch (err) {
    logger.error({ err }, "Failed to remove backend");
    res.status(500).json({ error: String(err) });
  }
});

export default router;

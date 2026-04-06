import { Router, type IRouter } from "express";
import healthRouter from "./health";
import { getPoolStatus } from "../lib/backendPool";

const router: IRouter = Router();

router.use(healthRouter);

router.get("/backends", (_req, res) => {
  res.json({ backends: getPoolStatus() });
});

export default router;

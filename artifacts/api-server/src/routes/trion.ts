import { Router, type IRouter } from "express";
import fs from "fs";

const router: IRouter = Router();

const JSON_PATH     = "/tmp/trion_latest.json";
const V2_CACHE_PATH = "/tmp/trion_v2_oracle.json";

// ── GET /api/trion/latest — L0 raw block data ──────────────────────────────
router.get("/trion/latest", (_req, res) => {
  let raw: string;
  try {
    raw = fs.readFileSync(JSON_PATH, "utf-8");
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      console.log("Awaiting L0 data synchronization...");
      res.status(503).json({ error: "Daemon not running yet. Awaiting L0 data synchronization." });
    } else {
      console.error("[API] Failed to read L0 state file:", err);
      res.status(500).json({ error: "Failed to read latest block data." });
    }
    return;
  }

  try {
    const data = JSON.parse(raw);
    res.json(data);
  } catch {
    console.log("Awaiting L0 data synchronization...");
    res.status(503).json({ error: "L0 data is mid-write. Awaiting L0 data synchronization." });
  }
});

// ── GET /api/trion/v2oracle — Latest V2 relayer state (signed signal cache) ─
router.get("/trion/v2oracle", (_req, res) => {
  let raw: string;
  try {
    raw = fs.readFileSync(V2_CACHE_PATH, "utf-8");
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      res.status(503).json({ error: "V2 relayer not yet active. Awaiting first signal publish." });
    } else {
      console.error("[API] Failed to read V2 oracle cache:", err);
      res.status(500).json({ error: "Failed to read V2 oracle state." });
    }
    return;
  }

  try {
    const data = JSON.parse(raw);
    res.json(data);
  } catch {
    res.status(503).json({ error: "V2 cache is mid-write. Retry shortly." });
  }
});

export default router;

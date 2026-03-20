import { Router, type IRouter } from "express";
import fs from "fs";
import path from "path";

const router: IRouter = Router();

const JSON_PATH = "/tmp/trion_latest.json";

router.get("/trion/latest", (_req, res) => {
  try {
    if (!fs.existsSync(JSON_PATH)) {
      res.status(503).json({ error: "Daemon not running yet. Start the Rust daemon first." });
      return;
    }
    const raw = fs.readFileSync(JSON_PATH, "utf-8");
    const data = JSON.parse(raw);
    res.json(data);
  } catch {
    res.status(500).json({ error: "Failed to read latest block data." });
  }
});

export default router;

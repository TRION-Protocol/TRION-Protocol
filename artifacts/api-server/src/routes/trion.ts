import { Router, type IRouter } from "express";
import fs from "fs";

const router: IRouter = Router();

const JSON_PATH = "/tmp/trion_latest.json";

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

export default router;

import express, { type Express } from "express";
import cors from "cors";
import path from "path";
import router from "./routes";

const app: Express = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

if (process.env.NODE_ENV === "production") {
  const staticDir = path.join(__dirname, "../../trion-dashboard/dist/public");
  app.use(express.static(staticDir));
  app.get("*", (_req, res) => {
    res.sendFile("index.html", { root: staticDir });
  });
}

export default app;

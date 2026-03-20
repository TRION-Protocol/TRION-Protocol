import { Router, type IRouter } from "express";
import healthRouter from "./health";
import trionRouter from "./trion";

const router: IRouter = Router();

router.use(healthRouter);
router.use(trionRouter);

export default router;

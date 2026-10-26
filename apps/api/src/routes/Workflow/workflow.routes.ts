import { Router } from "express";
import { requireAuth, loadMembership } from "../../middlewares/auth";
import { getWorkflowReadiness } from "../../controllers/Workflow/workflow.controller";

const router = Router();

router.use(requireAuth, loadMembership);
router.get("/", getWorkflowReadiness);

export default router;

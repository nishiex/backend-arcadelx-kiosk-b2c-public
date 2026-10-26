import type { Request, Response } from "express";
import { ApiResponse } from "../../utils/ApiResponse";
import { asyncHandler } from "../../utils/asyncHandler";
import { workflowReadiness } from "../../services/workflow-readiness";

export const getWorkflowReadiness = asyncHandler(async (_req: Request, res: Response) => {
  res.json(new ApiResponse(200, await workflowReadiness()));
});

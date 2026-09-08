// error Middleware
import type { Request, Response, NextFunction } from "express";
import { ApiError } from "./ApiError";

export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      success: err.success,
      message: err.message,
      errors: err.errors,
    });
  }

  // Fallback for unhandled errors
  return res.status(500).json({
    success: false,
    message: "Internal Server Error",
    errors: [err.message],
  });
};
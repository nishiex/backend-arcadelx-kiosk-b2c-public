// error Middleware
import type { Request, Response, NextFunction } from "express";
import { ApiError } from "./ApiError";
import { ZodError } from "zod";
import { Prisma } from "../generated/prisma/client";

export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (err instanceof ZodError) {
    return res
      .status(400)
      .json({
        success: false,
        message: "Invalid request",
        errors: err.issues.map(({ path, message }) => ({ path, message })),
      });
  }
  if (
    err instanceof SyntaxError &&
    "status" in err &&
    err.status === 400 &&
    "body" in err
  ) {
    return res
      .status(400)
      .json({ success: false, message: "Invalid JSON body", errors: null });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (["P2002", "P2003", "P2004", "P2034"].includes(err.code)) {
      return res
        .status(409)
        .json({
          success: false,
          message:
            "The operation conflicts with existing data or a concurrent change",
          errors: null,
        });
    }
    if (err.code === "P2025")
      return res
        .status(404)
        .json({ success: false, message: "Record not found", errors: null });
  }
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      success: err.success,
      message: err.message,
      errors: err.errors,
    });
  }

  // Fallback for unhandled errors. The stack is logged because returning a bare 500 with no
  // server-side trace made a production failure undiagnosable. The response body is unchanged,
  // so nothing internal is exposed to the client.
  console.error("[unhandled]", {
    method: req.method,
    path: req.originalUrl,
    name: err instanceof Error ? err.name : typeof err,
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack?.split("\n").slice(0, 6).join("\n") : undefined,
  });
  return res.status(500).json({
    success: false,
    message: "Internal Server Error",
    errors: null,
  });
};

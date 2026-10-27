import type { Request, Response } from "express";
import crypto from "node:crypto";
import { prisma } from "../utils/db";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

function classify(path: string, method: string) {
  const segment = path.split("/").filter(Boolean)[1] ?? "system";
  const entity = {
    auth: "AUTH", members: "MEMBER", network: "NETWORK", agreements: "AGREEMENT",
    kiosks: "KIOSK", orders: "ORDER", revenue: "REVENUE", devices: "DEVICE",
    reports: "REPORT", admin: "ADMIN",
  }[segment] ?? segment.toUpperCase();
  const last = path.split("/").filter(Boolean).at(-1) ?? "";
  const action = last === "approve" || last === "accept" ? "APPROVE"
    : last === "reject" ? "REJECT"
    : last === "initiate" ? "REQUEST"
    : segment === "auth" && last === "login" ? "LOGIN"
    : segment === "auth" && last === "refresh" ? "REFRESH"
    : segment === "auth" && last === "logout" ? "LOGOUT"
    : method === "POST" ? "CREATE"
    : method === "PATCH" ? "UPDATE"
    : method === "DELETE" ? "DELETE" : method === "GET" ? "READ" : method;
  return { entity, action };
}

export async function writeAuditLog(req: Request, res: Response) {
  const requestPath = req.originalUrl.split("?")[0] ?? req.path;
  // Audit-log reads are excluded to avoid recursively creating a new entry every
  // time the audit page refreshes. Every other API request is recorded.
  if (!requestPath.startsWith("/api/") || requestPath === "/api/audit-logs") return;
  const actor = req.user?.id ? await prisma.user.findUnique({
    where: { id: req.user.id }, select: { name: true },
  }) : null;
  const organization = req.membership?.organizationId ? await prisma.organization.findUnique({
    where: { id: req.membership.organizationId }, select: { name: true, type: true },
  }) : null;
  const { entity, action } = classify(requestPath, req.method);
  const reference = requestPath.match(UUID)?.[0] ?? null;
  const bodyKeys = req.body && typeof req.body === "object" ? Object.keys(req.body).filter(key => !/password|token|secret|signature/i.test(key)) : [];
  await prisma.auditLog.create({
    data: {
      id: crypto.randomUUID(), actorUserId: req.user?.id ?? null, actorOrganizationId: req.membership?.organizationId ?? null,
      actorName: actor?.name ?? "System", actorOrgType: organization?.type ?? null, actorOrgName: organization?.name ?? null,
      action, entity, reference, detail: bodyKeys.length ? `Fields: ${bodyKeys.join(", ")}` : null,
      method: req.method, path: requestPath, statusCode: res.statusCode, status: res.statusCode < 400 ? "SUCCESS" : "FAILED",
    },
  });
}

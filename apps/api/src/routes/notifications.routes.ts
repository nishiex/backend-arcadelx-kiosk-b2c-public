import { Router } from "express";
import { requireAuth, loadMembership } from "../middlewares/auth";
import { prisma } from "../utils/db";

const router = Router();

async function snapshot(organizationId: string) {
  const [members, connections, agreements, orders, priceRequests] = await Promise.all([
    prisma.membership.count({ where: { organizationId, status: "PENDING" } }),
    prisma.networkConnection.count({ where: { receiverOrgId: organizationId, status: "PENDING" } }),
    prisma.agreement.count({ where: { childOrgId: organizationId, status: "PENDING_APPROVAL" } }),
    prisma.order.count({ where: { parentOrgId: organizationId, status: "UNDER_REVIEW", paymentStatus: "PENDING" } }),
    prisma.devicePriceRequest.count({ where: { status: "PENDING", requesterOrgId: { not: organizationId } } }),
  ]);
  return { members, connections, agreements, orders, priceRequests };
}

router.get("/stream", requireAuth, loadMembership, async (req, res) => {
  res.status(200).set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();

  let previous = "";
  let closed = false;
  const send = async () => {
    if (closed) return;
    try {
      const next = JSON.stringify(await snapshot(req.membership!.organizationId));
      if (next !== previous) {
        previous = next;
        res.write(`event: notifications\ndata: ${next}\n\n`);
      } else {
        res.write(": keep-alive\n\n");
      }
    } catch (error) {
      console.error("[notifications] stream check failed:", error);
    }
  };
  await send();
  const timer = setInterval(() => void send(), 5000);
  req.on("close", () => { closed = true; clearInterval(timer); });
});

export default router;

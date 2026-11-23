import dotenv from "dotenv"
import path from "node:path"
dotenv.config({ path: path.resolve(process.cwd(), "../../.env") })
const { prisma } = await import("../src/utils/db.js")
const kiosk = await prisma.kiosk.findFirst({ where: { machineCode: "T-109" }, select: { id: true } })
const rows = kiosk ? await prisma.orderKiosk.findMany({ where: { kioskId: kiosk.id }, select: { order: { select: { orderNumber: true, type: true, status: true, grandTotal: true, totalDeposit: true, createdAt: true } } } }) : []
console.log("orders touching T-109:", JSON.stringify(rows, null, 2))
const totals = await prisma.order.aggregate({ _count: true, _sum: { grandTotal: true } })
console.log("all orders:", JSON.stringify(totals))
await prisma.$disconnect()

import dotenv from "dotenv"
import path from "node:path"
dotenv.config({ path: path.resolve(process.cwd(), "../../.env") })
const { prisma } = await import("../src/utils/db.js")
const total = await prisma.kiosk.count()
const matches = await prisma.kiosk.findMany({
  where: { OR: [{ machineCode: { contains: "109" } }, { externalDeviceId: { contains: "109" } }] },
  select: { machineCode: true, externalDeviceId: true, status: true, currentOrg: { select: { name: true } }, _count: { select: { transactions: true } } },
})
console.log("kiosk count:", total)
console.log("kiosks matching 109:", JSON.stringify(matches, null, 2))
await prisma.$disconnect()

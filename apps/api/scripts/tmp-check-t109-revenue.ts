import dotenv from "dotenv"
import path from "node:path"

dotenv.config({ path: path.resolve(process.cwd(), "../../.env") })

const { prisma } = await import("../src/utils/db.js")

const kiosk = await prisma.kiosk.findUnique({
  where: { machineCode: "T-109" },
  select: {
    id: true,
    machineCode: true,
    externalDeviceId: true,
    currentOrgId: true,
    currentOrg: { select: { name: true, type: true } },
  },
})
console.log("T-109:", kiosk)

const [txCount, bigTx, statements, ipDaily, ipSettlements] = await Promise.all([
  prisma.transaction.count(),
  prisma.transaction.findMany({
    where: { amount: { gte: 50000 } },
    orderBy: { occurredAt: "desc" },
    take: 10,
    select: { amount: true, occurredAt: true, kiosk: { select: { machineCode: true } } },
  }),
  prisma.revenueStatement.findMany({
    where: { GrossRevenue: { gte: 50000 } },
    orderBy: { updatedAt: "desc" },
    take: 5,
    select: { Month: true, Year: true, GrossRevenue: true, organization: { select: { name: true } } },
  }),
  prisma.ipDailyGameRevenue.findMany({
    where: { grossRevenue: { gte: 50000 } },
    orderBy: { updatedAt: "desc" },
    take: 5,
    select: { businessDate: true, grossRevenue: true, gameDisplayName: true },
  }),
  prisma.ipSettlement.findMany({
    where: { grossRevenue: { gte: 50000 } },
    orderBy: { updatedAt: "desc" },
    take: 5,
    select: { month: true, year: true, grossRevenue: true },
  }),
])

console.log("total transactions in DB:", txCount)
console.log("transactions >= 50000:", JSON.stringify(bigTx))
console.log("revenue statements >= 50000:", JSON.stringify(statements))
console.log("ip daily game revenue >= 50000:", JSON.stringify(ipDaily))
console.log("ip settlements >= 50000:", JSON.stringify(ipSettlements))

if (kiosk?.currentOrgId) {
  const orgStatements = await prisma.revenueStatement.findMany({
    where: { organizationId: kiosk.currentOrgId },
    orderBy: [{ Year: "desc" }, { Month: "desc" }],
    take: 5,
    select: { Month: true, Year: true, GrossRevenue: true },
  })
  console.log("statements for T-109's org:", JSON.stringify(orgStatements))
}

await prisma.$disconnect()

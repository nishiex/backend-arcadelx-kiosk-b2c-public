import dotenv from "dotenv"
import path from "node:path"

dotenv.config({ path: path.resolve(process.cwd(), "../../.env") })

const { listDevices, getDevicePrices } = await import("../src/services/Mothership/devices.service.js")

const { devices } = await listDevices()
for (const device of devices) {
  const rows = await getDevicePrices(device.deviceId)
  const row = rows.find(r => r.displayName === "Beat Tap Revenge")
  if (!row) continue
  const offTarget = Math.abs(row.effectivePrice - row.basePrice) >= 0.001
  console.log(
    `${device.deviceId} | live=${row.effectivePrice}/${row.effectiveReplayPrice} | catalog=${row.basePrice} | hasOverride=${row.hasOverride} | differsFromCatalog=${row.differsFromCatalog} | wouldRewrite=${offTarget}`
  )
}

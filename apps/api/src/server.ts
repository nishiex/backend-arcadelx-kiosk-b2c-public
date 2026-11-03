import dotenv from "dotenv";

dotenv.config({path:"../../.env"})

const { default: app } = await import("./app.js");
const { env } = await import("./config/env.js");

const PORT = Number(env.PORT);

let pricingJobs: { close: () => Promise<void> } | undefined;
if (env.EOD_PRICE_JOBS_ENABLED === 'true') {
  const { startDevicePricingJobs } = await import('./workers/devicePricing.worker.js');
  pricingJobs = await startDevicePricingJobs();
}

if (process.env.REVENUE_JOBS_ENABLED === 'true') {
  const { startRevenueJobs } = await import('./workers/Revenue/revenue.worker.js');
  const jobs = await startRevenueJobs();
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, async () => { await jobs.close(); await pricingJobs?.close(); process.exit(0); });
  }
}

if (pricingJobs && process.env.REVENUE_JOBS_ENABLED !== 'true') {
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, async () => { await pricingJobs?.close(); process.exit(0); });
  }
}

app.listen(PORT, env.HOST,()=>{
    console.log(`Server Running on ${PORT}`);
})

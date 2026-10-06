import dotenv from "dotenv";

dotenv.config({path:"../../.env"})

const { default: app } = await import("./app.js");
const { env } = await import("./config/env.js");

const PORT = Number(env.PORT);

if (process.env.REVENUE_JOBS_ENABLED === 'true') {
  const { startRevenueJobs } = await import('./workers/Revenue/revenue.worker.js');
  const jobs = await startRevenueJobs();
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, async () => { await jobs.close(); process.exit(0); });
  }
}

app.listen(PORT,()=>{
    console.log(`Server Running on ${PORT}`);
})

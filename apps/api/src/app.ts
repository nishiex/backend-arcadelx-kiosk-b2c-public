import type {Request,Response} from "express"
import express, { urlencoded } from "express";
import cors from "cors";
import helmet from "helmet";
import { prisma } from "./utils/db"
import { errorHandler } from "./utils/errorHandler";
import { ApiResponse } from "./utils/ApiResponse";
import { ApiError } from "./utils/ApiError";
import cookieParser from "cookie-parser";
import authRoutes from './routes/auth.routes';
import memberRoutes from "./routes/member.routes";
import networkRoutes from "./routes/Network/network.routes"
import agreementRoutes from "./routes/Agreements/agreement.routes"
import kioskRoutes from './routes/Kiosk/kiosk.routes';
import internalRoutes from './routes/Internal/internal.routes';
import orderRoutes from './routes/Orders/order.route'
import revenueRoutes from './routes/Revenue/revenue.routes';
import adminGatewayRoutes from './routes/Admin/gateway.routes';
import deviceRoutes from './routes/Admin/device.routes';
import reportsRoutes from './routes/Reports/reports.routes';
import adsRoutes from './routes/Ads/ads.routes';
import auditRoutes from './routes/Audit/audit.routes';
import workflowRoutes from './routes/Workflow/workflow.routes';
import analyticsRoutes from './routes/Analytics/analytics.routes';
import { writeAuditLog } from './services/audit-log.service';
const app = express();

app.use(cors())
app.use(helmet());

app.use(express.json());
app.use(urlencoded({extended:true}))
app.use(cookieParser());
// Capture completed write requests after authentication/membership middleware has
// populated the request context, while never recording audit-log reads themselves.
app.use((req, res, next) => {
  res.once('finish', () => {
    void writeAuditLog(req, res).catch((error) => {
      console.error('[audit-log] write failed:', error instanceof Error ? error.message : String(error));
    });
  });
  next();
});
//routes
app.use("/api/auth",authRoutes)
app.use("/api/members",memberRoutes)
app.use('/api/network', networkRoutes);
app.use('/api/agreements', agreementRoutes);
app.use('/api/kiosks', kioskRoutes);
// Company video ads: library, resumable upload and range-aware playback (COMPANY only).
app.use('/api/ads', adsRoutes);
// Same surface for clients written against the `/api/v1` contract (mobile spec): the same
// router, so no handler is duplicated. `POST /upload-chunk` is intentionally absent --
// uploads stay chunked through `/uploads` + `PUT .../chunks/:index`.
app.use('/api/v1/ads', adsRoutes);
app.use('/api/workflows', workflowRoutes);
app.use('/api/analytics', analyticsRoutes);
// Crucial: These routes bypass standard JWT auth because they are server-to-server
    app.use('/api/internal', internalRoutes);

app.use("/api/orders",orderRoutes)
app.use('/api/revenue', revenueRoutes);
// Payment-gateway administration (proxied to Mothership). Session-authenticated and
// limited to COMPANY OWNER/ADMIN inside the router.
app.use('/api/admin/gateways', adminGatewayRoutes);
// Device fleet and per-device game pricing (proxied to Mothership). Reads are open to
// COMPANY/DISTRIBUTOR/PARTNER; the price write is limited to COMPANY OWNER/ADMIN inside
// the router, because it changes what a live kiosk charges.
app.use('/api/devices', deviceRoutes);
app.use('/api/v1/devices', deviceRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/audit-logs', auditRoutes);
//Health Endpoints
app.get("/health",(req:Request,res:Response)=>
{
    return res.status(200).json(new ApiResponse(200, "OK"));
})

app.get("/health/db",async(req:Request,res:Response)=>
{
    try{
        await prisma.$queryRaw`SELECT 1`;
        return res.status(200).json(new ApiResponse(200, "Database Connected!"));
    }
    catch(err)
    {
        console.error('Database health check failed:', err);
        throw new ApiError(503,"Erro!,Database Disconnected!");
    }
})

//Global Error Handler
app.use(errorHandler);

export default app;

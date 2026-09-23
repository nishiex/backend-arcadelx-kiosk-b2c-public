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
const app = express();

app.use(cors())
app.use(helmet());

app.use(express.json());
app.use(urlencoded({extended:true}))
app.use(cookieParser());

//routes
app.use("/api/auth",authRoutes)
app.use("/api/members",memberRoutes)
app.use('/api/network', networkRoutes);
app.use('/api/agreements', agreementRoutes);
app.use('/api/kiosks', kioskRoutes);

// Crucial: These routes bypass standard JWT auth because they are server-to-server
    app.use('/api/internal', internalRoutes);

app.use("/api/orders",orderRoutes)
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
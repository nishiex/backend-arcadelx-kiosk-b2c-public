import type {Request,Response} from "express"
import express, { urlencoded } from "express";
import cors from "cors";
import helmet from "helmet";
import { prisma } from "./utils/db"
import { errorHandler } from "./utils/errorHandler";
import { ApiResponse } from "./utils/ApiResponse";
import { ApiError } from "./utils/ApiError";
import authRoutes from './routes/auth.routes';
import cookieParser from "cookie-parser";

const app = express();

app.use(cors())
app.use(helmet());

app.use(express.json());
app.use(urlencoded({extended:true}))
app.use(cookieParser());

//routes
app.use("/api/auth",authRoutes)


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
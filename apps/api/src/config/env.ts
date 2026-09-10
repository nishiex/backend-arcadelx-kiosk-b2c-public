import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();


const envSchema = z.object({
  PORT: z.string().default('3000'),
  DATABASE_URL: z.string().url("Must be a valid Postgres URL"),
  DIRECT_URL: z.string().url("Must be a valid Postgres URL"),
  ACCESS_SECRET_TOKEN: z.string().min(64),
  REFRESH_SECRET_TOKEN: z.string().min(64),
  ACCESS_EXPIRY: z.string().default('15m'),
  REFRESH_EXPIRY: z.string().default('7d'),
  NODE_ENV:z.string()
});

const _env = envSchema.safeParse(process.env);

if (!_env.success) {
  console.error(' Invalid environment variables:', _env.error.format());
  process.exit(1); 
}

export const env = _env.data;
import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config();


const envSchema = z.object({
  PORT: z.string().regex(/^\d+$/).refine(value => Number(value) > 0 && Number(value) <= 65535, 'Invalid port').default('4000'),
  DATABASE_URL: z.string().url("Must be a valid Postgres URL"),
  DIRECT_URL: z.string().url("Must be a valid Postgres URL"),
  ACCESS_SECRET_TOKEN: z.string().min(64),
  REFRESH_SECRET_TOKEN: z.string().min(64),
  ACCESS_EXPIRY: z.string().regex(/^[1-9]\d*[mhd]$/).default('15m'),
  REFRESH_EXPIRY: z.string().regex(/^[1-9]\d*[mhd]$/).default('7d'),
  INTERNAL_API_SECRET: z.string().min(32, "Internal API secret must be at least 32 characters"),
  NODE_ENV: z.enum(['development', 'test', 'production']),
  INVOICES_DIR: z.string().optional(),
  MAILJET_API_KEY: z.string().optional(),
  MAILJET_SECRET_KEY: z.string().optional(),
  MAIL_FROM_EMAIL: z.string().optional(),
  MAIL_FROM_NAME: z.string().optional(),
  FRONTEND_LOGIN_URL: z.string().optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_WHATSAPP_FROM: z.string().optional(),
  // Base32 secret provisioned in Google Authenticator for destructive gateway actions.
  // Sensitive gateway mutations fail closed when this is not configured.
  GATEWAY_TOTP_SECRET: z.string().trim().min(16).optional(),
  BUSINESS_TIMEZONE: z.string().default('Asia/Kolkata'),
  EOD_PRICE_JOBS_ENABLED: z.enum(['true', 'false']).default('false'),
  MOTHERSHIP_ANALYTICS_SUMMARY_URL: z.string().url().default('https://main.arcadelx.games/api/v1/analytics/summary'),
});

const productionSchema = envSchema.extend({
  INVOICES_DIR: z.string().refine(path.isAbsolute, 'Use an absolute path on persistent storage'),
  MAILJET_API_KEY: z.string().min(1),
  MAILJET_SECRET_KEY: z.string().min(1),
  MAIL_FROM_EMAIL: z.string().email(),
  MAIL_FROM_NAME: z.string().min(1),
  FRONTEND_LOGIN_URL: z.string().url().refine(value => value.startsWith('https://'), 'Production login URL must use HTTPS'),
});
const _env = (process.env.NODE_ENV === 'production' ? productionSchema : envSchema).safeParse(process.env);

if (!_env.success) {
  console.error(' Invalid environment variables:', _env.error.format());
  // Throw rather than process.exit(1): inside a serverless function an exit kills the
  // invocation with no diagnosis, whereas a throw reports the real message in the logs.
  throw new Error('Invalid environment variables');
}

export const env = _env.data;

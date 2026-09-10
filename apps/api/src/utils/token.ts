import jwt, { type SignOptions } from 'jsonwebtoken';
import type { StringValue } from 'ms';
import crypto from 'crypto';
import { env } from '../config/env';

function expiryToMs(expiry: string): number {
  const match = /^(\d+(?:\.\d+)?)([mhd])$/i.exec(expiry);

  if (!match) {
    throw new Error(`Invalid expiry format: ${expiry}`);
  }

  const value = match[1];
  const unit = match[2];

  if (!value || !unit) {
    throw new Error(`Invalid expiry format: ${expiry}`);
  }

  switch (unit.toLowerCase()) {
    case "m":
      return Number(value) * 60 * 1000;
    case "h":
      return Number(value) * 60 * 60 * 1000;
    case "d":
      return Number(value) * 24 * 60 * 60 * 1000;
    default:
      throw new Error(`Invalid expiry unit: ${unit}`);
  }
}



export const generateTokens = (userId: string) => {
  const accessToken = jwt.sign({ id: userId }, env.ACCESS_SECRET_TOKEN, { expiresIn: env.ACCESS_EXPIRY as StringValue});
  const refreshToken = jwt.sign({ id: userId }, env.REFRESH_SECRET_TOKEN, { expiresIn: env.REFRESH_EXPIRY as StringValue});
  return { accessToken, refreshToken };
};

export const hashToken = (token: string) => {
  return crypto.createHash('sha256').update(token).digest('hex');
};

export const setTokenCookies = (res: any, accessToken: string, refreshToken: string) => {
  const cookieOptions = {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
  };  

  const ACCESS_COOKIE_EXPIRY = expiryToMs(env.ACCESS_EXPIRY);
  const REFRESH_COOKIE_EXPIRY = expiryToMs(env.REFRESH_EXPIRY);
  
  // Access token cookie (shorter lifespan handled by JWT expiry, but we can set maxAge too)
  res.cookie('access_token', accessToken, { ...cookieOptions, maxAge: ACCESS_COOKIE_EXPIRY }); 
  // Refresh token cookie
  res.cookie('refresh_token', refreshToken, { ...cookieOptions, path: '/api/auth/refresh', maxAge: REFRESH_COOKIE_EXPIRY }); 
};
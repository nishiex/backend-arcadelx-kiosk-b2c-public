import type { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { env } from '../config/env';
import { ApiError } from '../utils/ApiError';

export const requireInternalAuth = (req: Request, res: Response, next: NextFunction) => {
  const providedKey = req.header('X-Internal-Api-Key');

  if (!providedKey) {
    throw new ApiError(401, 'Missing internal authentication key');
  }

  // To prevent timing attacks, we hash both the provided key and the env key to a 
  // uniform length (SHA-256) before using timingSafeEqual. 
  // If we just compared raw Buffers of different lengths, timingSafeEqual throws an error, 
  // which leaks that the length is wrong.
  const expectedHash = crypto.createHash('sha256').update(env.INTERNAL_API_SECRET).digest();
  const providedHash = crypto.createHash('sha256').update(providedKey).digest();

  const isValid = crypto.timingSafeEqual(expectedHash, providedHash);

  if (!isValid) {
    throw new ApiError(401, 'Invalid internal authentication key');
  }

  next();
};
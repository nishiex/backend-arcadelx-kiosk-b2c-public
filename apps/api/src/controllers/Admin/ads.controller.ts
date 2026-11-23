import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import {
  fetchAdsConfigFromMothership, fetchAdsListFromMothership, createAdOnMothership,
  updateAdOnMothership, assignAdOnMothership, deleteAdOnMothership,
  streamAdUploadChunk, streamAdFile,
} from '../../services/Mothership/ads.service';

export const getAdsConfig = asyncHandler(async (_req: Request, res: Response) => res.status(200).json(await fetchAdsConfigFromMothership()));
export const getAdsList = asyncHandler(async (_req: Request, res: Response) => res.status(200).json(await fetchAdsListFromMothership()));
export const createAd = asyncHandler(async (req: Request, res: Response) => res.status(200).json(await createAdOnMothership(req.body)));
export const updateAd = asyncHandler(async (req: Request, res: Response) => res.status(200).json(await updateAdOnMothership(req.params.id as string, req.body)));
export const assignAd = asyncHandler(async (req: Request, res: Response) => res.status(200).json(await assignAdOnMothership(req.params.id as string, req.body)));
export const deleteAd = asyncHandler(async (req: Request, res: Response) => res.status(200).json(await deleteAdOnMothership(req.params.id as string)));
export const uploadAdChunk = (req: Request, res: Response) => streamAdUploadChunk(req, res);
export const getAdFile = (req: Request, res: Response) => streamAdFile(req.params.filename as string, req, res);

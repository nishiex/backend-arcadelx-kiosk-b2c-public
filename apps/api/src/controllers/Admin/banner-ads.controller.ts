import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import {
  fetchBannerAdsConfigFromMothership,
  fetchBannerAdsListFromMothership,
  createBannerAdOnMothership,
  updateBannerAdOnMothership,
  deleteBannerAdOnMothership,
  streamUploadChunk,
  streamBannerAdFile,
} from '../../services/Mothership/banner-ads.service';

/**
 * Controller for Banner Ads operations.
 * Proxies requests to Mothership while verifying session authentication and roles.
 */

export const getBannerAdsConfig = asyncHandler(async (_req: Request, res: Response) => {
  const config = await fetchBannerAdsConfigFromMothership();
  res.status(200).json(config);
});

export const getBannerAdsList = asyncHandler(async (_req: Request, res: Response) => {
  const list = await fetchBannerAdsListFromMothership();
  res.status(200).json(list);
});

export const createBannerAd = asyncHandler(async (req: Request, res: Response) => {
  const result = await createBannerAdOnMothership(req.body);
  res.status(200).json(result);
});

export const updateBannerAd = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await updateBannerAdOnMothership(id as string, req.body);
  res.status(200).json(result);
});

export const deleteBannerAd = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await deleteBannerAdOnMothership(id as string);
  res.status(200).json(result);
});

export const uploadBannerAdChunk = (req: Request, res: Response) => {
  streamUploadChunk(req, res);
};

export const getBannerAdFile = (req: Request, res: Response) => {
  const { filename } = req.params;
  streamBannerAdFile(filename as string, req, res);
};

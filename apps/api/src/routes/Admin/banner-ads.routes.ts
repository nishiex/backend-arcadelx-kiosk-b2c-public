import { Router } from 'express';
import {
  requireAuth,
  loadMembership,
  requireOrgType,
  requireRole,
} from '../../middlewares/auth';
import {
  getBannerAdsConfig,
  getBannerAdsList,
  createBannerAd,
  updateBannerAd,
  deleteBannerAd,
  uploadBannerAdChunk,
  getBannerAdFile,
} from '../../controllers/Admin/banner-ads.controller';

const router = Router();

// Gated to authenticated Company members
router.use(requireAuth, loadMembership, requireOrgType('COMPANY'));

// 1. Config: allowed extensions, max size, max days, today
router.get('/config', requireRole('OWNER', 'ADMIN'), getBannerAdsConfig);

// 2. Upload chunk (multipart/form-data)
router.post('/upload-chunk', requireRole('OWNER'), uploadBannerAdChunk);

// 3. Create banner ad
router.post('/', requireRole('OWNER'), createBannerAd);

// 4. List all banner ads with status and stats
router.get('/', requireRole('OWNER', 'ADMIN'), getBannerAdsList);

// 5. Update banner ad
router.post('/:id/update', requireRole('OWNER'), updateBannerAd);
router.put('/:id', requireRole('OWNER'), updateBannerAd);
router.patch('/:id', requireRole('OWNER'), updateBannerAd);

// 6. Delete banner ad
router.post('/:id/delete', requireRole('OWNER'), deleteBannerAd);
router.delete('/:id', requireRole('OWNER'), deleteBannerAd);

// 7. Stream/download video file preview
router.get('/files/:filename', requireRole('OWNER', 'ADMIN'), getBannerAdFile);

export default router;

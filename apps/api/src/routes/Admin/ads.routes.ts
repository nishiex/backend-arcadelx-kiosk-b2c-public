import { Router } from 'express';
import { requireAuth, loadMembership, requireOrgType, requireRole } from '../../middlewares/auth';
import { getAdsConfig, getAdsList, createAd, updateAd, assignAd, deleteAd, uploadAdChunk, getAdFile } from '../../controllers/Admin/ads.controller';

const router = Router();
router.use(requireAuth, loadMembership, requireOrgType('COMPANY'));
router.get('/config', requireRole('OWNER', 'ADMIN'), getAdsConfig);
router.get('/', requireRole('OWNER', 'ADMIN'), getAdsList);
router.post('/upload-chunk', requireRole('OWNER'), uploadAdChunk);
router.post('/', requireRole('OWNER'), createAd);
router.post('/:id/update', requireRole('OWNER'), updateAd);
router.put('/:id', requireRole('OWNER'), updateAd);
router.patch('/:id', requireRole('OWNER'), updateAd);
router.post('/:id/assign', requireRole('OWNER'), assignAd);
router.post('/:id/delete', requireRole('OWNER'), deleteAd);
router.delete('/:id', requireRole('OWNER'), deleteAd);
router.get('/files/:filename', requireRole('OWNER', 'ADMIN'), getAdFile);
export default router;

import express, { Router } from 'express';
import { requireAuth, loadMembership, requireOrgType, requireRole } from '../../middlewares/auth';
import {
  createAd,
  deleteAd,
  discardUploadSession,
  getAd,
  getUploadConfig,
  initUpload,
  listAds,
  streamAdVideo,
  streamAdVideoByFilename,
  updateAd,
  uploadChunk,
  uploadChunkMultipart,
} from '../../controllers/Ads/ad.controller';
import { maxChunkSizeBytes } from '../../services/ads.service';

const router = Router();

// Ads are Company content: every route is scoped to the caller's Company membership.
router.use(requireAuth, loadMembership, requireOrgType('COMPANY'));

// Reads: any active Company member may inspect the library and preview a video.
router.get('/config', getUploadConfig);
router.get('/', listAds);
// Filename-addressed playback for the `/api/v1` contract. Registered before `/:id/video`
// so the literal `files` segment can never be read as an ad id.
router.get('/files/:filename', streamAdVideoByFilename);
router.post('/files', requireRole('OWNER', 'ADMIN'), uploadChunkMultipart);
router.get('/:id', getAd);
router.get('/:id/video', streamAdVideo);

// Writes: OWNER/ADMIN only, matching the Company batch-kiosk and gateway mutations.
router.post('/uploads', requireRole('OWNER', 'ADMIN'), initUpload);

// Chunks arrive as raw bytes. The parser limit is the configured chunk size, so an
// oversized body is rejected before it is buffered in full.
router.put(
  '/uploads/:uploadId/chunks/:chunkIndex',
  requireRole('OWNER', 'ADMIN'),
  express.raw({ type: 'application/octet-stream', limit: maxChunkSizeBytes() }),
  uploadChunk,
);

router.post('/', requireRole('OWNER', 'ADMIN'), createAd);
// Mobile contract: one multipart request per chunk. Registers before `/:id` routes and
// delegates to the same session helpers as the raw-bytes route above.
router.post('/upload-chunk', requireRole('OWNER', 'ADMIN'), uploadChunkMultipart);
router.delete('/uploads/:uploadId', requireRole('OWNER', 'ADMIN'), discardUploadSession);
router.patch('/:id', requireRole('OWNER', 'ADMIN'), updateAd);
router.delete('/:id', requireRole('OWNER', 'ADMIN'), deleteAd);

// Compatibility aliases for clients that carry the action in the path. They delegate to
// the PATCH/DELETE handlers above, so there is still exactly one implementation each.
router.post('/:id/update', requireRole('OWNER', 'ADMIN'), updateAd);
router.post('/:id/delete', requireRole('OWNER', 'ADMIN'), deleteAd);

export default router;

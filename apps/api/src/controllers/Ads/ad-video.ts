import type { Request, Response, NextFunction } from 'express';
import { createReadStream } from 'node:fs';
import { ApiError } from '../../utils/ApiError';
import * as ads from '../../services/ads.service';

/** The columns every playback route needs; callers stay free to select more. */
export type StreamableAd = {
  videoFilename: string;
  mimeType: string;
  originalFilename: string;
};

/**
 * Send one stored ad video as a byte-range aware response.
 *
 * Two surfaces hand out these bytes: the member-facing library (`/api/ads/files/:filename`,
 * `/api/ads/:id/video`) and the kiosk sync feed (`/api/internal/ads/files/:filename`). They
 * differ only in how they authorize the request, so the transfer itself lives here: MIME
 * enforcement, `Content-Disposition`, Range parsing and the 416 answers stay identical on
 * both, and a fix to one cannot leave the other behind.
 *
 * Authorization is deliberately not part of this function. Each caller resolves and scopes
 * its own ad row first, then passes the storage name it is allowed to serve.
 */
export async function serveAdVideo(
  req: Request,
  res: Response,
  next: NextFunction,
  ad: StreamableAd,
): Promise<void> {
  if (!(ads.ALLOWED_VIDEO_TYPES as readonly string[]).includes(ad.mimeType)) {
    throw new ApiError(415, 'Stored video type is not supported');
  }

  const { filePath, size } = await ads.statVideo(ad.videoFilename);

  const safeName = ad.originalFilename.replace(/[^\w.\-]+/g, '_') || 'ad.mp4';
  // `?download=1` turns the same stream into a save-file response. Range handling stays
  // identical, so a resumable download works exactly like playback.
  const asAttachment = ['1', 'true', 'yes'].includes(
    String(req.query.download ?? '').trim().toLowerCase(),
  );
  res.setHeader('Content-Type', ad.mimeType);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader(
    'Content-Disposition',
    `${asAttachment ? 'attachment' : 'inline'}; filename="${safeName}"`,
  );
  res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');

  const range = req.headers.range;
  if (!range) {
    res.status(200);
    res.setHeader('Content-Length', String(size));
    const stream = createReadStream(filePath);
    stream.on('error', (error) => {
      if (res.headersSent) res.destroy();
      else next(error);
    });
    stream.pipe(res);
    return;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!match || (match[1] === '' && match[2] === '')) {
    res.setHeader('Content-Range', `bytes */${size}`);
    throw new ApiError(416, 'Invalid range header');
  }

  let start: number;
  let end: number;

  if (match[1] === '') {
    // Suffix range: the last N bytes.
    const suffix = Number(match[2]);
    if (!Number.isInteger(suffix) || suffix <= 0) {
      res.setHeader('Content-Range', `bytes */${size}`);
      throw new ApiError(416, 'Invalid range header');
    }
    start = Math.max(size - suffix, 0);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  }

  if (!Number.isInteger(start) || !Number.isInteger(end) || start > end || start >= size) {
    res.setHeader('Content-Range', `bytes */${size}`);
    throw new ApiError(416, 'Requested range not satisfiable');
  }

  res.status(206);
  res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
  res.setHeader('Content-Length', String(end - start + 1));

  const stream = createReadStream(filePath, { start, end });
  stream.on('error', (error) => {
    if (res.headersSent) res.destroy();
    else next(error);
  });
  stream.pipe(res);
}

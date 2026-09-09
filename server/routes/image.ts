import { Router } from 'express';
import { createHash, randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs/promises';
import multer from 'multer';
import sharp from 'sharp';
import { openImage, getTile, serveImage, exportImage, applyVisibilityMask, CACHE_DIR } from '../services/image-processor';
import { renderPerspective, reprojectToEquirectangular } from '../services/perspective-projector';
import type { ImageOpenRequest, ImageOpenResponse, ExportRequest, PerspectiveRenderRequest, ReprojectRequest } from '../../shared/types';

export const imageRouter = Router();

// Multer setup — save uploaded files to cache dir
const upload = multer({
  storage: multer.diskStorage({
    destination: CACHE_DIR,
    filename: (_req, file, cb) => {
      const timestamp = Date.now();
      const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, `upload-${timestamp}-${safeName}`);
    },
  }),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB max for large panoramas
});

imageRouter.post('/open', async (req, res) => {
  try {
    const { path } = req.body as ImageOpenRequest;
    if (!path?.trim()) return res.status(400).json({ error: 'path is required' });
    const meta = await openImage(path);
    res.json(meta as ImageOpenResponse);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Serve ảnh gốc (đã resize) cho PSV viewer — giữ tỉ lệ 2:1
imageRouter.get('/serve', async (req, res) => {
  try {
    const { path, maxWidth } = req.query;
    if (!path) return res.status(400).json({ error: 'path is required' });
    const result = await serveImage(String(path), maxWidth ? Number(maxWidth) : undefined);
    res.type('image/png').send(result.buffer);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

imageRouter.get('/tile', async (req, res) => {
  try {
    const { path, x, y, w, h } = req.query;
    if (!path || x === undefined || y === undefined || w === undefined || h === undefined) {
      return res.status(400).json({ error: 'path, x, y, w, h are required' });
    }
    const tile = await getTile(
      String(path),
      Number(x),
      Number(y),
      Number(w),
      Number(h)
    );
    res.type('image/png').send(tile);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

imageRouter.post('/cache-result', async (req, res) => {
  try {
    const { base64Image } = req.body;
    if (!base64Image) return res.status(400).json({ error: 'base64Image is required' });
    const buffer = Buffer.from(base64Image, 'base64');
    const hash = createHash('sha256').update(buffer).digest('hex');
    const cacheFile = path.join(CACHE_DIR, `${hash}.png`);
    await fs.mkdir(path.dirname(cacheFile), { recursive: true });
    await fs.writeFile(cacheFile, buffer);
    res.json({ resultImageId: hash, sizeBytes: buffer.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

imageRouter.post('/perspective-render', async (req, res) => {
  try {
    const { imagePath, layers, viewPose, viewport, rect, mode } = req.body as PerspectiveRenderRequest;
    if (!imagePath?.trim()) return res.status(400).json({ error: 'imagePath is required' });
    if (!viewPose || viewPose.fov === undefined) return res.status(400).json({ error: 'viewPose with fov is required' });
    if (!viewport?.width || !viewport?.height) return res.status(400).json({ error: 'viewport is required' });

    // Use full viewport rect for full-frame mode
    const effectiveRect = mode === 'full-frame'
      ? { x: 0, y: 0, width: viewport.width, height: viewport.height }
      : (rect || { x: 0, y: 0, width: viewport.width, height: viewport.height });

    const metadata = await sharp(imagePath).metadata();
    const panoramaSize = {
      width: metadata.width ?? 8192,
      height: metadata.height ?? 4096,
    };

    const scaleFactor = (req.body as any).scaleFactor ?? 1;
    let renderSource = imagePath;
    let compositeTempPath: string | undefined;
    try {
      if (Array.isArray(layers) && layers.length > 0) {
        compositeTempPath = path.join(CACHE_DIR, `layer-source-${randomUUID()}.png`);
        const compositeBuffer = await exportImage(
          imagePath,
          'png',
          95,
          layers,
          { yaw: 0, pitch: 0, roll: 0 },
        );
        await fs.writeFile(compositeTempPath, compositeBuffer);
        renderSource = compositeTempPath;
      }

      const result = await renderPerspective(renderSource, viewPose, viewport, effectiveRect, panoramaSize, scaleFactor);

      // Cache the rendered perspective
      const hash = createHash('sha256').update(result.buffer).digest('hex');
      const cacheFile = path.join(CACHE_DIR, `${hash}.png`);
      await fs.mkdir(path.dirname(cacheFile), { recursive: true });
      await fs.writeFile(cacheFile, result.buffer);

      res.json({
        resultImageId: hash,
        width: result.width,
        height: result.height,
      });
    } finally {
      if (compositeTempPath) await fs.unlink(compositeTempPath).catch(() => undefined);
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

imageRouter.post('/reproject', async (req, res) => {
  try {
    const { resultImageId, selection, imagePath, maskEnabled, maskData, visibilityMask } = req.body as ReprojectRequest;
    if (!resultImageId || !selection || !imagePath) {
      return res.status(400).json({ error: 'resultImageId, selection, and imagePath are required' });
    }

    const resultPath = path.join(CACHE_DIR, `${resultImageId}.png`);
    await fs.access(resultPath); // verify exists

    const metadata = await sharp(imagePath).metadata();
    const panoramaSize = {
      width: metadata.width ?? 8192,
      height: metadata.height ?? 4096,
    };

    // Persistently memoize this expensive operation. The key includes every
    // input that can change the projected pixels, including the manual mask.
    const visibilityMaskHash = visibilityMask?.base64Mask
      ? createHash('sha256').update(visibilityMask.base64Mask).digest('hex')
      : '';
    const reprojectionKey = createHash('sha256').update(JSON.stringify({
      version: 3,
      resultImageId,
      selection,
      panoramaSize,
      maskEnabled,
      maskData,
      visibilityMaskHash,
    })).digest('hex');
    const reprojectionIndex = path.join(CACHE_DIR, `reproject-${reprojectionKey}.txt`);
    try {
      const cachedId = (await fs.readFile(reprojectionIndex, 'utf8')).trim();
      if (/^[a-f0-9]{64}$/.test(cachedId)) {
        await fs.access(path.join(CACHE_DIR, `${cachedId}.png`));
        return res.json({ equirectImageId: cachedId });
      }
    } catch {
      // Cache miss: continue with reprojection.
    }

    // Reconstruct minimal layer from selection + mask state for reprojection
    const layer = { selection, maskEnabled, maskData } as any;

    let reprojectionSource = resultPath;
    let maskedTempPath: string | undefined;
    if (visibilityMask?.base64Mask) {
      const resultMetadata = await sharp(resultPath).metadata();
      const width = resultMetadata.width ?? 1;
      const height = resultMetadata.height ?? 1;
      const masked = await applyVisibilityMask(
        resultPath,
        visibilityMask.base64Mask,
        0,
        width,
        height,
      );
      maskedTempPath = path.join(CACHE_DIR, `masked-reproject-${randomUUID()}.png`);
      await fs.writeFile(maskedTempPath, masked);
      reprojectionSource = maskedTempPath;
    }

    let reprojected: Buffer;
    try {
      reprojected = await reprojectToEquirectangular(reprojectionSource, layer, panoramaSize);
    } finally {
      if (maskedTempPath) await fs.unlink(maskedTempPath).catch(() => undefined);
    }

    // Cache the reprojected equirectangular buffer
    const hash = createHash('sha256').update(reprojected).digest('hex');
    const cacheFile = path.join(CACHE_DIR, `${hash}.png`);
    await fs.mkdir(path.dirname(cacheFile), { recursive: true });
    await fs.writeFile(cacheFile, reprojected);
    await fs.writeFile(reprojectionIndex, hash, 'utf8');

    res.json({ equirectImageId: hash });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

imageRouter.get('/cache/:id', async (req, res) => {
  try {
    const id = req.params.id;
    // Sanitize: only allow hex characters (SHA256 hash format)
    if (!/^[a-f0-9]{64}$/.test(id)) {
      return res.status(400).json({ error: 'Invalid cache ID format' });
    }
    const cacheFile = path.join(CACHE_DIR, `${id}.png`);
    const buffer = await fs.readFile(cacheFile);
    res.type('image/png').send(buffer);
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      return res.status(404).json({ error: 'Cache file not found' });
    }
    res.status(500).json({ error: err.message });
  }
});

// Upload ảnh từ browser — lưu vào cache dir, trả về path + metadata
imageRouter.post('/upload', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image file provided' });
    const meta = await openImage(req.file.path);
    res.json({ ...meta, path: req.file.path, originalName: req.file.originalname });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

const EXPORT_MIME: Record<string, string> = {
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
};

imageRouter.post('/export', async (req, res) => {
  try {
    const body = req.body as ExportRequest;
    if (!body.path || !body.format) {
      return res.status(400).json({ error: 'path and format are required' });
    }
    const buffer = await exportImage(
      body.path, body.format, body.quality,
      body.layers, body.horizon
    );
    res.type(EXPORT_MIME[body.format]).send(buffer);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

imageRouter.post('/preview', async (req, res) => {
  const { path: imagePath, layers } = req.body as Pick<ExportRequest, 'path' | 'layers'>;
  if (!imagePath) return res.status(400).json({ error: 'path is required' });
  try {
    const buffer = await exportImage(
      imagePath,
      'png',
      95,
      Array.isArray(layers) ? layers : [],
      { yaw: 0, pitch: 0, roll: 0 },
    );
    res.type('image/png').send(buffer);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

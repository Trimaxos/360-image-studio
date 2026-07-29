import { Router } from 'express';
import { createHash } from 'crypto';
import path from 'path';
import fs from 'fs/promises';
import { openImage, getTile, serveImage, exportImage, CACHE_DIR } from '../services/image-processor';
import type { ImageOpenRequest, ImageOpenResponse, TileRequest, ExportRequest } from '../../shared/types';

export const imageRouter = Router();

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

imageRouter.post('/export', async (req, res) => {
  try {
    const body = req.body as ExportRequest;
    if (!body.path || !body.outputPath) {
      return res.status(400).json({ error: 'path and outputPath are required' });
    }
    await exportImage(
      body.path, body.outputPath, body.format, body.quality,
      body.layers, body.horizon
    );
    res.json({ success: true, outputPath: body.outputPath });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

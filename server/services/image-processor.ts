import sharp from 'sharp';
import path from 'path';
import fs from 'fs/promises';
import type { ImageMeta, Horizon, Layer } from '../../shared/types';

export const CACHE_DIR = path.join(process.env.HOME || '/tmp', '.cache', '360-image-studio');

async function ensureCacheDir() {
  await fs.mkdir(CACHE_DIR, { recursive: true });
}

export async function openImage(imagePath: string): Promise<ImageMeta> {
  const metadata = await sharp(imagePath).metadata();
  const stat = await fs.stat(imagePath);

  if (!metadata.width || !metadata.height) {
    throw new Error(`Cannot read image dimensions: ${imagePath}`);
  }

  if (metadata.width > 16000 || metadata.height > 8000) {
    throw new Error(`Image too large: ${metadata.width}x${metadata.height}. Max: 16000x8000`);
  }

  const formatMap: Record<string, ImageMeta['format']> = {
    jpeg: 'jpeg', jpg: 'jpeg', png: 'png', tiff: 'tiff', webp: 'webp',
  };
  const fmt = metadata.format || 'jpeg';

  return {
    path: imagePath,
    width: metadata.width,
    height: metadata.height,
    format: formatMap[fmt] || 'jpeg',
    sizeBytes: stat.size,
  };
}

export async function serveImage(
  imagePath: string,
  maxWidth?: number
): Promise<{ buffer: Buffer; width: number; height: number; format: string }> {
  const metadata = await sharp(imagePath).metadata();
  const origW = metadata.width || 8192;
  const origH = metadata.height || 4096;

  let pipeline = sharp(imagePath);

  if (maxWidth && origW > maxWidth) {
    const newH = Math.round(origH * (maxWidth / origW));
    pipeline = pipeline.resize(maxWidth, newH, { fit: 'inside', withoutEnlargement: true });
    return {
      buffer: await pipeline.png().toBuffer(),
      width: maxWidth,
      height: newH,
      format: 'png',
    };
  }

  return {
    buffer: await pipeline.png().toBuffer(),
    width: origW,
    height: origH,
    format: metadata.format || 'jpeg',
  };
}

export async function getTile(
  imagePath: string,
  x: number,
  y: number,
  w: number,
  h: number
): Promise<Buffer> {
  return sharp(imagePath)
    .extract({ left: Math.round(x), top: Math.round(y), width: Math.round(w), height: Math.round(h) })
    .png()
    .toBuffer();
}

export async function exportImage(
  imagePath: string,
  outputPath: string,
  format: 'jpeg' | 'png' | 'webp' | 'avif',
  quality: number,
  layers: Layer[],
  horizon: Horizon
): Promise<void> {
  await ensureCacheDir();

  // Start with original image
  let pipeline = sharp(imagePath);

  // Apply horizon correction if needed
  if (horizon.roll !== 0 || horizon.pitch !== 0 || horizon.yaw !== 0) {
    // Simple roll rotation via affine transform
    if (horizon.roll !== 0) {
      pipeline = pipeline.rotate(horizon.roll, { background: { r: 0, g: 0, b: 0, alpha: 0 } });
    }
    // Pitch/yaw correction will be implemented in Phase 2 (Horizon Level)
    void horizon.pitch;
    void horizon.yaw;
  }

  // Composite layers in order (bottom to top)
  const sortedLayers = [...layers].sort((a, b) => a.order - b.order);

  if (sortedLayers.length > 0) {
    for (const layer of sortedLayers) {
      if (!layer.visible) continue;

      const cacheFile = path.join(CACHE_DIR, `${layer.resultImageId}.png`);
      try {
        await fs.access(cacheFile);

        // Nếu có maskData, tạo mask từ maskData để blend mượt
        // thay vì overlay toàn bộ tile hình chữ nhật
        if (layer.maskData && layer.maskData.length > 0) {
          const { createMaskFromShapes } = await import('./mask-generator');
          const maskBuffer = await createMaskFromShapes(
            layer.maskData,
            Math.round(layer.tileCoords.w),
            Math.round(layer.tileCoords.h)
          );

          // maskBuffer: white shapes on transparent background (RGBA)
          // Dùng 'dest-in' để giữ result chỉ ở vùng mask không trong suốt
          const maskedResult = await sharp(cacheFile)
            .composite([{ input: maskBuffer, blend: 'dest-in' }])
            .png()
            .toBuffer();

          // Composite: result ĐÃ masked (có alpha đúng) lên ảnh gốc
          pipeline = pipeline.composite([{
            input: maskedResult,
            top: Math.round(layer.tileCoords.y),
            left: Math.round(layer.tileCoords.x),
            blend: 'over',
          }]);
        } else {
          // Fallback: không có mask → blend toàn bộ tile
          pipeline = pipeline.composite([{
            input: cacheFile,
            top: Math.round(layer.tileCoords.y),
            left: Math.round(layer.tileCoords.x),
            blend: 'over',
          }]);
        }
      } catch {
        // Layer cache file missing — skip silently
      }
    }
  }

  // Encode and write
  const formatOptions: Record<string, any> = {
    jpeg: { quality },
    png: { quality, compressionLevel: 9 },
    webp: { quality },
    avif: { quality },
  };

  await pipeline.toFormat(format as any, formatOptions[format]).toFile(outputPath);
}

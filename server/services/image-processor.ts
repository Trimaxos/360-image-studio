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
  _horizon: Horizon
): Promise<void> {
  await ensureCacheDir();

  // Start with original image
  let pipeline = sharp(imagePath);
  const sourceMeta = await sharp(imagePath).metadata();
  const panoramaSize = {
    width: sourceMeta.width ?? 8192,
    height: sourceMeta.height ?? 4096,
  };

  // Composite layers in order (bottom to top)
  const sortedLayers = exportableLayers(layers);

  if (sortedLayers.length > 0) {
    for (const layer of sortedLayers) {
      const cacheFile = path.join(CACHE_DIR, `${layer.resultImageId}.png`);
      try {
        await fs.access(cacheFile);

        if (layer.type === 'perspective') {
          const { projectPerspectiveLayer } = await import('./perspective-projector');
          const projected = await projectPerspectiveLayer(cacheFile, layer, panoramaSize);
          pipeline = pipeline.composite([{ input: projected, top: 0, left: 0, blend: 'over' }]);
          continue;
        }

        if (layer.selection?.maskBase64) {
          const maskedResult = await applyBase64Mask(cacheFile, layer.selection.maskBase64);
          pipeline = pipeline.composite([{
            input: maskedResult,
            top: Math.round(layer.tileCoords.y),
            left: Math.round(layer.tileCoords.x),
            blend: 'over',
          }]);
          continue;
        }

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

export function exportableLayers(layers: Layer[]): Layer[] {
  return layers
    .filter((layer) => layer.visible !== false && layer.status === 'committed')
    .sort((a, b) => a.order - b.order);
}

export async function applyBase64Mask(resultPath: string, base64Mask: string): Promise<Buffer> {
  const metadata = await sharp(resultPath).metadata();
  const width = metadata.width ?? 1;
  const height = metadata.height ?? 1;
  const alpha = await sharp(Buffer.from(base64Mask, 'base64'))
    .resize(width, height, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer();
  const rgb = await sharp(resultPath).removeAlpha().raw().toBuffer();
  const rgba = Buffer.alloc(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    rgba[pixel * 4] = rgb[pixel * 3];
    rgba[pixel * 4 + 1] = rgb[pixel * 3 + 1];
    rgba[pixel * 4 + 2] = rgb[pixel * 3 + 2];
    rgba[pixel * 4 + 3] = alpha[pixel];
  }
  return sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

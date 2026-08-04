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

  // Composite layers in order (bottom to top).
  // Collect all composites first, then apply in a single call so every layer
  // stacks correctly.  Chaining .composite() in a loop can overwrite earlier ops.
  const sortedLayers = exportableLayers(layers);
  const composites: Array<{ input: string | Buffer; top: number; left: number; blend: 'over' }> = [];

  console.log(`[export] total layers: ${layers.length}, exportable: ${sortedLayers.length}`);
  for (const layer of sortedLayers) {
    const appliedVariant = (layer.variants ?? []).find((v) => v.applied);
    console.log(`[export] layer ${layer.id} order=${layer.order} type=${layer.type} resultImageId=${layer.resultImageId} hasAppliedVariant=${!!appliedVariant} variantResultId=${appliedVariant?.resultImageId}`);
  }

  if (sortedLayers.length > 0) {
    for (const layer of sortedLayers) {
      // Find applied variant — if none, skip this layer entirely
      const appliedVariant = (layer.variants ?? []).find((v) => v.applied);
      if (!appliedVariant) {
        console.log(`[export] layer ${layer.id}: no applied variant, skipping`);
        continue;
      }

      const variantFile = path.join(CACHE_DIR, `${appliedVariant.resultImageId}.png`);
      try {
        await fs.access(variantFile);

        if (layer.type === 'perspective') {
          // Prefer the equirectangular buffer generated for THIS applied variant.
          // Fall back to the legacy layer-level equirectImageId ONLY when the layer
          // has a single variant (migrated v3) — with >1 variant the layer-level id
          // may be stale for a different variant and must not be used.
          const equirectId = appliedVariant.equirectImageId
            ?? ((layer.variants?.length ?? 0) <= 1 ? layer.equirectImageId : undefined);
          if (equirectId) {
            const eqFile = path.join(CACHE_DIR, `${equirectId}.png`);
            try {
              await fs.access(eqFile);
              composites.push({ input: eqFile, top: 0, left: 0, blend: 'over' });
              continue;
            } catch { /* fall through */ }
          }
          const { reprojectToEquirectangular } = await import('./perspective-projector');
          const reprojected = await reprojectToEquirectangular(variantFile, layer, panoramaSize);
          composites.push({ input: reprojected, top: 0, left: 0, blend: 'over' });
          continue;
        }

        // Flat layer: use selection.tileCoords as fallback for projects saved
        // before the createPerspectiveLayer fix (which hardcoded x=0,y=0).
        const selCoords = (layer as any).selection?.tileCoords;
        const tileX = layer.tileCoords.x || (selCoords?.x ?? 0);
        const tileY = layer.tileCoords.y || (selCoords?.y ?? 0);

        // Flat layer: apply visibility mask if present
        if (appliedVariant.visibilityMask?.base64Mask) {
          const maskedResult = await applyVisibilityMask(
            variantFile,
            appliedVariant.visibilityMask.base64Mask,
            appliedVariant.visibilityMask.brushSoftness,
            appliedVariant.width,
            appliedVariant.height,
          );
          composites.push({
            input: maskedResult,
            top: Math.round(tileY),
            left: Math.round(tileX),
            blend: 'over',
          });
        } else {
          // No visibility mask — blend full variant tile with its natural alpha
          composites.push({
            input: variantFile,
            top: Math.round(tileY),
            left: Math.round(tileX),
            blend: 'over',
          });
        }
      } catch {
        console.log(`[export] variant cache file missing: ${appliedVariant.resultImageId}, skipping layer`);
      }
    }
  }

  if (composites.length > 0) {
    pipeline = pipeline.composite(composites);
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

/** @deprecated Use applyVisibilityMask instead — supports feather + alpha combine */
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

export async function applyVisibilityMask(
  resultPath: string,
  base64Mask: string,
  softness: number,
  width: number,
  height: number,
): Promise<Buffer> {
  // Decode mask
  const maskBuf = await sharp(Buffer.from(base64Mask, 'base64'))
    .resize(width, height, { fit: 'fill' })
    .ensureAlpha()
    .png()
    .toBuffer();

  // Apply feather (blur) if softness > 0
  let featheredMask = maskBuf;
  if (softness > 0) {
    const maxSize = Math.max(width, height);
    const sigma = (softness / 100) * (maxSize / 100); // scale sigma to reasonable range
    featheredMask = await sharp(maskBuf)
      .blur(sigma)
      .png()
      .toBuffer();
  }

  // Extract luminance from the feathered mask — the client's mask is an OPAQUE PNG
  // (black background = hidden, white strokes = revealed). Its alpha channel is 255
  // everywhere, so visibility must be read from the greyscale/luma value instead.
  const maskLuma = await sharp(featheredMask)
    .greyscale()
    .raw()
    .toBuffer();

  const resultRgb = await sharp(resultPath)
    .removeAlpha()
    .raw()
    .toBuffer();

  const resultAlpha = await sharp(resultPath)
    .ensureAlpha()
    .extractChannel(3)
    .raw()
    .toBuffer();

  // Combine: result RGB + min(maskLuma, resultAlpha) as final alpha.
  // The mask ANDs with the result's natural alpha: a region is visible only where
  // the mask is bright AND the result itself has pixels (preserves PNG transparency).
  const pixelCount = width * height;
  const rgba = Buffer.alloc(pixelCount * 4);
  for (let i = 0; i < pixelCount; i++) {
    rgba[i * 4]     = resultRgb[i * 3];
    rgba[i * 4 + 1] = resultRgb[i * 3 + 1];
    rgba[i * 4 + 2] = resultRgb[i * 3 + 2];
    rgba[i * 4 + 3] = Math.min(maskLuma[i], resultAlpha[i]);
  }

  return sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

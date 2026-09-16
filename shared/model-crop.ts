import type { ViewPose } from './types';

export interface Size { width: number; height: number }
export interface CropRect extends Size { x: number; y: number }
export const MODEL_MIN_PIXELS = 655_360;
export const MODEL_MAX_PIXELS = 8_294_400;
export const MODEL_MAX_EDGE = 3840;

// Enumerate supported aspect ratios once; pointer moves only evaluate these
// small integer ratios, not every width/height pair on the model grid.
const modelRatios: Size[] = [];
const seenRatios = new Set<string>();
for (let width = 16; width <= MODEL_MAX_EDGE; width += 16) {
  for (let height = 16; height <= MODEL_MAX_EDGE; height += 16) {
    if (!isValidModelSize({ width, height })) continue;
    let a = width, b = height;
    while (b) [a, b] = [b, a % b];
    const ratio = { width: width / a, height: height / a };
    const key = `${ratio.width}:${ratio.height}`;
    if (!seenRatios.has(key)) {
      seenRatios.add(key);
      modelRatios.push(ratio);
    }
  }
}

export function isValidModelSize({ width, height }: Size): boolean {
  return Number.isInteger(width) && Number.isInteger(height)
    && width > 0 && height > 0 && width % 16 === 0 && height % 16 === 0
    && Math.max(width, height) <= MODEL_MAX_EDGE
    && Math.max(width / height, height / width) <= 3
    && width * height >= MODEL_MIN_PIXELS && width * height <= MODEL_MAX_PIXELS;
}

/** Find an output on the 16px grid with exactly the source aspect ratio. */
export function exactModelSize(width: number, height: number): Size | null {
  if (!Number.isInteger(width) || !Number.isInteger(height)
    || width <= 0 || height <= 0) return null;
  if (isValidModelSize({ width, height })) return { width, height };
  let a = width, b = height;
  while (b) [a, b] = [b, a % b];
  const unitW = width / a * 16, unitH = height / a * 16;
  const minimum = Math.ceil(Math.sqrt(MODEL_MIN_PIXELS / (unitW * unitH)));
  const maximum = Math.floor(Math.min(MODEL_MAX_EDGE / Math.max(unitW, unitH),
    Math.sqrt(MODEL_MAX_PIXELS / (unitW * unitH))));
  if (minimum > maximum) return null;
  const multiplier = Math.max(minimum, Math.min(maximum, Math.floor(a / 16)));
  const size = { width: unitW * multiplier, height: unitH * multiplier };
  return isValidModelSize(size) ? size : null;
}

/** Trim context at the edges; never distort the content or move its center. */
export function planModelCrop(width: number, height: number): { crop: CropRect; output: Size } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 16 || height < 16) {
    throw new Error('Hãy chọn vùng rộng hơn (mỗi cạnh ít nhất 16 px) hoặc tắt tự căn khung.');
  }
  const centered = (w: number, h: number, output: Size) => ({
    crop: { x: Math.floor((width - w) / 2), y: Math.floor((height - h) / 2), width: w, height: h },
    output,
  });
  // Preserve already usable crops, trimming only the fractional/grid edges.
  const snapped = { width: Math.floor(width / 16) * 16, height: Math.floor(height / 16) * 16 };
  if (isValidModelSize(snapped)) return centered(snapped.width, snapped.height, snapped);

  const usableW = Math.min(width, height * 3);
  const usableH = Math.min(height, width * 3);
  const targetPixels = Math.max(MODEL_MIN_PIXELS, Math.min(MODEL_MAX_PIXELS,
    usableW * usableH, MODEL_MAX_EDGE ** 2 / Math.max(usableW / usableH, usableH / usableW)));
  let best: ReturnType<typeof centered> | null = null;
  let bestScore = Infinity;
  for (const ratio of modelRatios) {
    const factor = Math.floor(Math.min(width / ratio.width, height / ratio.height));
    if (factor < 1) continue;
    const w = ratio.width * factor, h = ratio.height * factor;
    const output = exactModelSize(w, h);
    if (!output) continue;
    // Continuous trade-off, not a loss cutoff: prefer retaining context and
    // staying near the required resolution. The user sees the final crop.
    const score = Math.log(width * height / (w * h))
      + Math.abs(Math.log(output.width * output.height / targetPixels));
    if (score < bestScore - 1e-12 || (Math.abs(score - bestScore) <= 1e-12
      && best && output.width * output.height < best.output.width * best.output.height)) {
      bestScore = score;
      best = centered(w, h, output);
    }
  }
  if (!best) throw new Error('Không thể căn khung; hãy chọn vùng rộng hơn.');
  return best;
}
export function calcPerspectiveResolution(
  viewport: Size, pose: ViewPose, rect: CropRect, panorama: Size, scaleFactor = 1,
): Size {
  const height = Math.max(1, Math.round(
    (rect.height / viewport.height) * (pose.fov * panorama.height / 180) * scaleFactor,
  ));
  return { width: Math.max(1, Math.round(height * rect.width / rect.height)), height };
}

/** Use continuous native density so preview, rendering and reprojection
 * share exactly the same viewport rectangle (no rounded aspect drift). */
export function planPerspectiveCrop(
  viewport: Size, pose: ViewPose, rect: CropRect, panorama: Size, scaleFactor = 1,
): { rect: CropRect; crop: CropRect; output: Size } {
  const density = pose.fov * panorama.height / (180 * viewport.height) * scaleFactor;
  const plan = planModelCrop(rect.width * density, rect.height * density);
  const width = plan.crop.width / density, height = plan.crop.height / density;
  return { ...plan, rect: {
    x: rect.x + (rect.width - width) / 2, y: rect.y + (rect.height - height) / 2,
    width, height,
  } };
}

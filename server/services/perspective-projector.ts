import sharp from 'sharp';
import type { Layer, ViewPose } from '../../shared/types';
import { createMaskFromShapes } from './mask-generator';

interface Size { width: number; height: number }
interface Point { x: number; y: number }

const radians = (degrees: number) => degrees * Math.PI / 180;
const modulo = (value: number, divisor: number) => ((value % divisor) + divisor) % divisor;

export function calcPerspectiveResolution(
  viewport: Size,
  pose: ViewPose,
  rect: { x: number; y: number; width: number; height: number },
  panorama: Size,
  scaleFactor: number = 1,
): Size {
  // Vertical resolution: rect covers rect.height/viewport.height of the vertical FOV.
  // Each degree of latitude = panorama.height / 180 equirectangular pixels.
  // outHeight = rect's share of vertical FOV × pixels per degree × scaleFactor.
  const outHeight = Math.max(1, Math.round(
    (rect.height / viewport.height) * (pose.fov * panorama.height / 180) * scaleFactor,
  ));

  // Width derived from rect's own aspect ratio — not viewport's.
  // This ensures the perspective output preserves the selection proportions
  // for both full-frame and free-select modes.
  const outWidth = Math.max(1, Math.round(outHeight * rect.width / rect.height));

  return { width: outWidth, height: outHeight };
}

export async function renderPerspective(
  imagePath: string,
  viewPose: ViewPose,
  viewport: Size,
  rect: { x: number; y: number; width: number; height: number },
  panorama: Size,
  scaleFactor: number = 1,
): Promise<{ buffer: Buffer; width: number; height: number }> {
  const outSize = calcPerspectiveResolution(viewport, viewPose, rect, panorama, scaleFactor);

  // Read source panorama as raw RGBA
  const source = await sharp(imagePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const srcData = source.data;
  const srcWidth = panorama.width;
  const srcHeight = panorama.height;

  const output = Buffer.alloc(outSize.width * outSize.height * 4);

  const aspect = viewport.width / viewport.height;
  const tanHalfFov = Math.tan(radians(viewPose.fov) / 2);

  // Precompute forward rotation angles (must match projectScreenPoint)
  const rollRad = radians(viewPose.roll);
  const pitchRad = radians(viewPose.pitch);
  const yawRad = radians(viewPose.yaw);

  const cosRoll = Math.cos(rollRad);
  const sinRoll = Math.sin(rollRad);
  const cosPitch = Math.cos(pitchRad);
  const sinPitch = Math.sin(pitchRad);
  const cosYaw = Math.cos(yawRad);
  const sinYaw = Math.sin(yawRad);

  for (let py = 0; py < outSize.height; py++) {
    for (let px = 0; px < outSize.width; px++) {
      // Map output pixel to viewport coordinate (center of pixel = +0.5)
      const vpX = rect.x + (px + 0.5) / outSize.width * rect.width;
      const vpY = rect.y + (py + 0.5) / outSize.height * rect.height;

      // NDC: x from -1 (left) to 1 (right), y from 1 (top) to -1 (bottom)
      const ndcX = (vpX / viewport.width) * 2 - 1;
      const ndcY = 1 - (vpY / viewport.height) * 2;

      // Camera-space direction (forward projection)
      let cx = ndcX * aspect * tanHalfFov;
      let cy = ndcY * tanHalfFov;
      let cz = 1;
      const len = Math.hypot(cx, cy, cz);
      cx /= len; cy /= len; cz /= len;

      // Roll (around Z) — forward rotation matching projectScreenPoint
      const rx = cx * cosRoll - cy * sinRoll;
      const ry = cx * sinRoll + cy * cosRoll;
      cx = rx; cy = ry;

      // Pitch (around X)
      const py2 = cy * cosPitch + cz * sinPitch;
      const pz2 = -cy * sinPitch + cz * cosPitch;
      cy = py2; cz = pz2;

      // Yaw (around Y)
      const yx = cx * cosYaw + cz * sinYaw;
      const yz = -cx * sinYaw + cz * cosYaw;
      cx = yx; cz = yz;

      // Convert direction to equirectangular coordinates
      const longitude = Math.atan2(cx, cz);
      const latitude = Math.asin(Math.max(-1, Math.min(1, cy)));

      const srcX = modulo((longitude / (2 * Math.PI) + 0.5) * srcWidth, srcWidth);
      const srcY = Math.max(0, Math.min(srcHeight - 1, (0.5 - latitude / Math.PI) * srcHeight));

      // Bilinear interpolation
      const sx0 = Math.floor(srcX);
      const sy0 = Math.floor(srcY);
      const fx = srcX - sx0;
      const fy = srcY - sy0;

      const sx1 = (sx0 + 1) % srcWidth;
      const sy1 = Math.min(sy0 + 1, srcHeight - 1);

      const i00 = (sy0 * srcWidth + sx0) * 4;
      const i10 = (sy0 * srcWidth + sx1) * 4;
      const i01 = (sy1 * srcWidth + sx0) * 4;
      const i11 = (sy1 * srcWidth + sx1) * 4;

      const outIdx = (py * outSize.width + px) * 4;
      for (let c = 0; c < 4; c++) {
        const top = srcData[i00 + c] * (1 - fx) + srcData[i10 + c] * fx;
        const bottom = srcData[i01 + c] * (1 - fx) + srcData[i11 + c] * fx;
        output[outIdx + c] = Math.round(top * (1 - fy) + bottom * fy);
      }
    }
  }

  return {
    buffer: await sharp(output, {
      raw: { width: outSize.width, height: outSize.height, channels: 4 },
    }).png().toBuffer(),
    width: outSize.width,
    height: outSize.height,
  };
}

export function projectScreenPoint(
  point: Point,
  viewport: Size,
  pose: ViewPose,
  panorama: Size,
): Point {
  const aspect = viewport.width / viewport.height;
  const tanHalfFov = Math.tan(radians(pose.fov) / 2);
  const ndcX = point.x / viewport.width * 2 - 1;
  const ndcY = 1 - point.y / viewport.height * 2;

  let x = ndcX * aspect * tanHalfFov;
  let y = ndcY * tanHalfFov;
  let z = 1;
  const length = Math.hypot(x, y, z);
  x /= length; y /= length; z /= length;

  const roll = radians(pose.roll);
  const rolledX = x * Math.cos(roll) - y * Math.sin(roll);
  const rolledY = x * Math.sin(roll) + y * Math.cos(roll);
  x = rolledX; y = rolledY;

  const pitch = radians(pose.pitch);
  const pitchedY = y * Math.cos(pitch) + z * Math.sin(pitch);
  const pitchedZ = -y * Math.sin(pitch) + z * Math.cos(pitch);
  y = pitchedY; z = pitchedZ;

  const yaw = radians(pose.yaw);
  const yawedX = x * Math.cos(yaw) + z * Math.sin(yaw);
  const yawedZ = -x * Math.sin(yaw) + z * Math.cos(yaw);
  x = yawedX; z = yawedZ;

  const longitude = Math.atan2(x, z);
  const latitude = Math.asin(Math.max(-1, Math.min(1, y)));
  return {
    x: modulo((longitude / (2 * Math.PI) + 0.5) * panorama.width, panorama.width),
    y: Math.max(0, Math.min(panorama.height - 1, (0.5 - latitude / Math.PI) * panorama.height)),
  };
}

// ---- Lanczos2 (a=2) kernel for high-quality resampling ----

/** Lanczos kernel weight for a=2. Zero outside [-2, 2). */
export function lanczos2Weight(x: number): number {
  if (x === 0) return 1;
  const ax = Math.abs(x);
  if (ax >= 2) return 0;
  const pix = Math.PI * x;
  const s = Math.sin(pix) / pix;              // sinc(x)
  return s * Math.sin(pix / 2) / (pix / 2);  // sinc(x) · sinc(x/2)
}

/**
 * Test whether a world-space pole direction (0, ±1, 0) projects inside the
 * perspective view frustum after inverse rotation.  Used to detect when the
 * 12-edge-sample heuristic misses the true y-extent because the pole lies
 * inside the view (not on the edges).
 */
export function isPoleVisible(
  poleDir: [number, number, number],
  cosYaw: number, sinYaw: number,
  cosPitch: number, sinPitch: number,
  cosRoll: number, sinRoll: number,
  aspect: number, tanHalfFov: number,
): boolean {
  // Inverse-rotate world direction → camera space (mirrors main loop lines 372-383)
  const cx1 = cosYaw * poleDir[0] - sinYaw * poleDir[2];
  const cz1 = sinYaw * poleDir[0] + cosYaw * poleDir[2];
  const cy2 = cosPitch * poleDir[1] - sinPitch * cz1;
  const cz2 = sinPitch * poleDir[1] + cosPitch * cz1;
  const cx3 = cosRoll * cx1 + sinRoll * cy2;
  const cy3 = -sinRoll * cx1 + cosRoll * cy2;
  const cz3 = cz2;

  if (cz3 <= 0) return false;
  const ndcX = cx3 / (cz3 * aspect * tanHalfFov);
  const ndcY = cy3 / (cz3 * tanHalfFov);
  return Math.abs(ndcX) <= 1 && Math.abs(ndcY) <= 1;
}

/** cos(lat) threshold below which the gap-detection x-range heuristic is
 *  unreliable and we fall back to iterating the full panorama width.
 *  0.02 ≈ within 1.15° of the pole (cos(88.85°) ≈ 0.02). */
const POLE_COS_THRESHOLD = 0.02;

/** Sample source image at subpixel (x,y) using Lanczos2 (4×4 = 16 samples).
 *  x wraps horizontally (equirectangular), y clamps vertically. */
function sampleLanczos2(
  src: Buffer, w: number, h: number,
  x: number, y: number,
): [number, number, number, number] {
  let r = 0, g = 0, b = 0, a = 0, totalWeight = 0;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  // Lanczos2 kernel radius = 2 → sample sy ∈ [-1, 0, 1, 2]
  for (let sy = -1; sy <= 2; sy++) {
    const py = iy + sy;
    if (py < 0 || py >= h) continue;
    const wy = lanczos2Weight(y - (py + 0.5));
    if (wy === 0) continue;
    for (let sx = -1; sx <= 2; sx++) {
      const px = ((ix + sx) % w + w) % w;  // horizontal wrap
      const wx = lanczos2Weight(x - (px + 0.5));
      const weight = wy * wx;
      if (weight === 0) continue;
      const i = (py * w + px) * 4;
      r += src[i] * weight;
      g += src[i + 1] * weight;
      b += src[i + 2] * weight;
      a += src[i + 3] * weight;
      totalWeight += weight;
    }
  }
  const norm = totalWeight || 1;
  return [
    Math.round(Math.max(0, Math.min(255, r / norm))),
    Math.round(Math.max(0, Math.min(255, g / norm))),
    Math.round(Math.max(0, Math.min(255, b / norm))),
    Math.round(Math.max(0, Math.min(255, a / norm))),
  ];
}

/**
 * Inverse mapping: reproject perspective result back to equirectangular.
 * Iterates over equirectangular bounding box → inverse rotate → NDC → Lanczos2 sample from source.
 * No holes, high-quality resampling, ~10× faster than forward mapping.
 */
export async function reprojectToEquirectangular(
  resultPath: string,
  layer: Layer,
  panorama: Size,
): Promise<Buffer> {
  const selection = layer.selection;
  if (!selection) throw new Error(`Perspective layer ${layer.id} is missing selection projection data`);

  // Load source result + apply mask if present
  const { data: rawData, info } = await sharp(resultPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const rw = info.width;
  const rh = info.height;

  // Pre-mask the source: only bake mask into alpha when per-layer "apply mask" toggle is on
  // and there are active (non-disabled) mask shapes. Fixes Bug 2: undo lasso → all-black
  // mask used to make entire layer transparent.
  let sourceData: Buffer;
  const activeShapes = (layer.maskData ?? []).filter((s) => s.enabled !== false);
  if (layer.maskEnabled && activeShapes.length > 0) {
    const maskBuf = await createMaskFromShapes(activeShapes, rw, rh);
    const { data: maskRaw } = await sharp(maskBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const masked = Buffer.alloc(rw * rh * 4);
    for (let i = 0; i < rw * rh; i++) {
      const si = i * 4;
      masked[si] = rawData[si];
      masked[si + 1] = rawData[si + 1];
      masked[si + 2] = rawData[si + 2];
      masked[si + 3] = maskRaw[si + 3]; // only alpha from mask
    }
    sourceData = masked;
  } else {
    sourceData = rawData;
  }

  const { width: panoW, height: panoH } = panorama;
  const viewport = selection.viewport;
  const rect = selection.rect;
  const pose = selection.viewPose;

  // Precompute inverse rotation angles
  const rollRad = radians(pose.roll);
  const pitchRad = radians(pose.pitch);
  const yawRad = radians(pose.yaw);
  const cosRoll = Math.cos(rollRad);
  const sinRoll = Math.sin(rollRad);
  const cosPitch = Math.cos(pitchRad);
  const sinPitch = Math.sin(pitchRad);
  const cosYaw = Math.cos(yawRad);
  const sinYaw = Math.sin(yawRad);

  // Projection constants (must match renderPerspective)
  const aspect = viewport.width / viewport.height;
  const tanHalfFov = Math.tan(radians(pose.fov) / 2);

  // Compute y-bounding box in equirectangular space from 12 sample points
  const samples = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width * 0.25, y: rect.y },
    { x: rect.x + rect.width * 0.5, y: rect.y },
    { x: rect.x + rect.width * 0.75, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x, y: rect.y + rect.height * 0.5 },
    { x: rect.x + rect.width, y: rect.y + rect.height * 0.5 },
    { x: rect.x, y: rect.y + rect.height },
    { x: rect.x + rect.width * 0.25, y: rect.y + rect.height },
    { x: rect.x + rect.width * 0.5, y: rect.y + rect.height },
    { x: rect.x + rect.width * 0.75, y: rect.y + rect.height },
    { x: rect.x + rect.width, y: rect.y + rect.height },
  ];
  const projected = samples.map(p => projectScreenPoint(p, viewport, pose, panorama));
  let yMin = Infinity, yMax = -Infinity;
  for (const p of projected) {
    if (p.y < yMin) yMin = p.y;
    if (p.y > yMax) yMax = p.y;
  }
  const pad = 2;
  yMin = Math.max(0, Math.floor(yMin) - pad);
  yMax = Math.min(panoH - 1, Math.ceil(yMax) + pad);

  // When a pole is inside the view frustum the 12 edge-sample heuristic
  // misses it because the pole always lies at the view CENTER, not on the
  // edges.  Hugin solves this with a full miniature render; we solve it
  // with an explicit pole-visibility check (see isPoleVisible above).
  const northPoleVisible = isPoleVisible(
    [0, 1, 0], cosYaw, sinYaw, cosPitch, sinPitch, cosRoll, sinRoll, aspect, tanHalfFov,
  );
  const southPoleVisible = isPoleVisible(
    [0, -1, 0], cosYaw, sinYaw, cosPitch, sinPitch, cosRoll, sinRoll, aspect, tanHalfFov,
  );
  if (northPoleVisible) yMin = 0;
  if (southPoleVisible) yMax = panoH - 1;

  // Detect x-wrapping from projected x values.
  // The largest gap between consecutive sorted xs is the UNVIEWED area.
  // The VIEWED area is its complement — either one contiguous range or two wrapping ranges.
  const xs = projected.map(p => p.x);
  xs.sort((a, b) => a - b);
  let maxGap = -1, maxGapIdx = -1;
  for (let i = 0; i < xs.length - 1; i++) {
    const gap = xs[i + 1] - xs[i];
    if (gap > maxGap) { maxGap = gap; maxGapIdx = i; }
  }
  const circGap = (xs[0] + panoW) - xs[xs.length - 1];
  if (circGap > maxGap) { maxGap = circGap; maxGapIdx = xs.length - 1; }

  // Build x-ranges covering the VIEWED area
  interface XRange { start: number; end: number }
  let xRanges: XRange[];
  if (maxGapIdx === xs.length - 1) {
    // Unviewed area wraps 360° → viewed area is contiguous: xs[0] … xs[last]
    xRanges = [{ start: Math.floor(xs[0]) - pad, end: Math.ceil(xs[xs.length - 1]) + pad }];
  } else {
    // Unviewed area is between xs[i] and xs[i+1] → viewed area wraps 360° in two ranges
    xRanges = [
      { start: Math.floor(xs[maxGapIdx + 1]) - pad, end: panoW - 1 },
      { start: 0, end: Math.ceil(xs[maxGapIdx]) + pad },
    ];
  }
  xRanges = xRanges
    .map(r => ({ start: Math.max(0, r.start), end: Math.min(panoW - 1, r.end) }))
    .filter(r => r.start <= r.end);

  // Allocate output (transparent fill)
  const output = Buffer.alloc(panoW * panoH * 4);
  output.fill(0);

  // Precompute sin/cos for each longitude column
  const lonSin = new Float64Array(panoW);
  const lonCos = new Float64Array(panoW);
  for (let tx = 0; tx < panoW; tx++) {
    const lon = (tx / panoW) * 2 * Math.PI - Math.PI;
    lonSin[tx] = Math.sin(lon);
    lonCos[tx] = Math.cos(lon);
  }

  // === Main inverse-mapping loop over equirectangular bounding box ===
  for (let ty = yMin; ty <= yMax; ty++) {
    const lat = Math.PI / 2 - (ty / panoH) * Math.PI;
    const cosLat = Math.cos(lat);
    const sinLat = Math.sin(lat);

    // Gap detection is unreliable where cos(lat) ≈ 0 because all longitudes
    // map to nearly the same world direction.  Fall back to full width so
    // near-pole rows are fully covered (the NDC test below correctly skips
    // out-of-view columns).
    const effectiveRanges = cosLat < POLE_COS_THRESHOLD
      ? [{ start: 0, end: panoW - 1 }]
      : xRanges;

    for (const range of effectiveRanges) {
      for (let tx = range.start; tx <= range.end; tx++) {
        const wrappedTx = ((tx % panoW) + panoW) % panoW;

        // World direction from equirectangular coordinates
        const cxW = cosLat * lonSin[wrappedTx];
        const cyW = sinLat;
        const czW = cosLat * lonCos[wrappedTx];

        // ---- Inverse rotation: world → camera ----
        // Forward: R_y(yaw) * R_x(-pitch) * R_z(roll)
        // Inverse: R_z(-roll) * R_x(pitch) * R_y(-yaw)

        // Step 1: R_y(-yaw)
        const cx1 = cosYaw * cxW - sinYaw * czW;
        const cz1 = sinYaw * cxW + cosYaw * czW;

        // Step 2: R_x(pitch) — inverse of forward R_x(-pitch)
        const cy2 = cosPitch * cyW - sinPitch * cz1;
        const cz2 = sinPitch * cyW + cosPitch * cz1;

        // Step 3: R_z(-roll)
        const cx3 = cosRoll * cx1 + sinRoll * cy2;
        const cy3 = -sinRoll * cx1 + cosRoll * cy2;
        const cz3 = cz2;

        if (cz3 <= 0) continue;

        // Project to NDC
        const ndcX = cx3 / (cz3 * aspect * tanHalfFov);
        const ndcY = cy3 / (cz3 * tanHalfFov);

        if (Math.abs(ndcX) > 1 || Math.abs(ndcY) > 1) continue;

        // NDC → viewport → source pixel
        const vpX = (ndcX + 1) / 2 * viewport.width;
        const vpY = (1 - ndcY) / 2 * viewport.height;
        const srcX = (vpX - rect.x) / rect.width * rw - 0.5;
        const srcY = (vpY - rect.y) / rect.height * rh - 0.5;

        if (srcX < -0.5 || srcX >= rw - 0.5 || srcY < -0.5 || srcY >= rh - 0.5) continue;

        // Lanczos2 sample
        const [cr, cg, cb, ca] = sampleLanczos2(sourceData, rw, rh, srcX, srcY);

        const outIdx = (ty * panoW + wrappedTx) * 4;
        output[outIdx] = cr;
        output[outIdx + 1] = cg;
        output[outIdx + 2] = cb;
        output[outIdx + 3] = ca;
      }
    }
  }

  return sharp(output, {
    raw: { width: panoW, height: panoH, channels: 4 },
  }).png().toBuffer();
}

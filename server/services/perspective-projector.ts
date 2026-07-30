import sharp from 'sharp';
import type { Layer, ViewPose } from '../../shared/types';

interface Size { width: number; height: number }
interface Point { x: number; y: number }

const radians = (degrees: number) => degrees * Math.PI / 180;
const modulo = (value: number, divisor: number) => ((value % divisor) + divisor) % divisor;

export function calcPerspectiveResolution(
  viewport: Size,
  pose: ViewPose,
  rect: { x: number; y: number; width: number; height: number },
  panorama: Size,
): Size {
  const aspect = viewport.width / viewport.height;
  const halfFovRad = radians(pose.fov) / 2;

  // Horizontal FOV from vertical FOV + aspect ratio (reverse of projectScreenPoint)
  const hFovRad = 2 * Math.atan(aspect * Math.tan(halfFovRad));
  const hFovDeg = hFovRad * 180 / Math.PI;

  // Full perspective view resolution matching source pixel density
  const fullPerspWidth = hFovDeg * panorama.width / 360;
  const fullPerspHeight = pose.fov * panorama.height / 180;

  // Scale by rect proportion of viewport
  return {
    width: Math.max(1, Math.round((rect.width / viewport.width) * fullPerspWidth)),
    height: Math.max(1, Math.round((rect.height / viewport.height) * fullPerspHeight)),
  };
}

export async function renderPerspective(
  imagePath: string,
  viewPose: ViewPose,
  viewport: Size,
  rect: { x: number; y: number; width: number; height: number },
  panorama: Size,
): Promise<{ buffer: Buffer; width: number; height: number }> {
  const outSize = calcPerspectiveResolution(viewport, viewPose, rect, panorama);

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

export async function projectPerspectiveLayer(
  resultPath: string,
  layer: Layer,
  panorama: Size,
): Promise<Buffer> {
  const selection = layer.selection;
  if (!selection) throw new Error(`Perspective layer ${layer.id} is missing selection projection data`);

  const { data, info } = await sharp(resultPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let mask: Buffer | null = null;
  if (selection.maskBase64) {
    mask = await sharp(Buffer.from(selection.maskBase64, 'base64'))
      .resize(info.width, info.height, { fit: 'fill' })
      .greyscale()
      .raw()
      .toBuffer();
  }

  const output = Buffer.alloc(panorama.width * panorama.height * 4);
  const rect = selection.rect;
  const feather = Math.max(1, Math.min(8, Math.floor(Math.min(info.width, info.height) / 8)));

  for (let sourceY = 0; sourceY < info.height; sourceY += 1) {
    for (let sourceX = 0; sourceX < info.width; sourceX += 1) {
      const sourceIndex = (sourceY * info.width + sourceX) * 4;
      const maskAlpha = mask ? mask[sourceY * info.width + sourceX] : data[sourceIndex + 3];
      if (maskAlpha < 2) continue;
      const edge = Math.min(sourceX, sourceY, info.width - 1 - sourceX, info.height - 1 - sourceY);
      const featherAlpha = Math.min(1, (edge + 1) / feather);
      const alpha = Math.round(maskAlpha * featherAlpha);
      const screenPoint = {
        x: rect.x + (sourceX + 0.5) / info.width * rect.width,
        y: rect.y + (sourceY + 0.5) / info.height * rect.height,
      };
      const projected = projectScreenPoint(screenPoint, selection.viewport, selection.viewPose, panorama);
      const targetX = Math.round(projected.x) % panorama.width;
      const targetY = Math.round(projected.y);

      // A small splat prevents pinholes caused by forward projection.
      for (let offsetY = 0; offsetY <= 1; offsetY += 1) {
        for (let offsetX = 0; offsetX <= 1; offsetX += 1) {
          const px = (targetX + offsetX) % panorama.width;
          const py = Math.min(panorama.height - 1, targetY + offsetY);
          const targetIndex = (py * panorama.width + px) * 4;
          if (alpha < output[targetIndex + 3]) continue;
          output[targetIndex] = data[sourceIndex];
          output[targetIndex + 1] = data[sourceIndex + 1];
          output[targetIndex + 2] = data[sourceIndex + 2];
          output[targetIndex + 3] = alpha;
        }
      }
    }
  }

  return sharp(output, {
    raw: { width: panorama.width, height: panorama.height, channels: 4 },
  }).png().toBuffer();
}

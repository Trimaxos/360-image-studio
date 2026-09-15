import type { ImageMode } from '../../shared/types';

/** 360 panoramas are equirectangular (2:1). Allow ±5% for slightly cropped exports. */
export function detectImageMode(width: number, height: number): ImageMode {
  if (!(width > 0) || !(height > 0)) return 'flat';
  const ratio = width / height;
  return ratio >= 1.9 && ratio <= 2.1 ? '360' : 'flat';
}

/** Saved project mode wins over auto-detection, but only when it is valid. */
export function resolveImageMode(saved: unknown, detected: ImageMode): ImageMode {
  return saved === 'flat' || saved === '360' ? saved : detected;
}

import type { ImageMode } from '../../shared/types';

/** 360 panoramas are equirectangular (2:1). Allow ±5% for slightly cropped exports. */
export function detectImageMode(width: number, height: number): ImageMode {
  if (!width || !height) return 'flat';
  const ratio = width / height;
  return ratio >= 1.9 && ratio <= 2.1 ? '360' : 'flat';
}

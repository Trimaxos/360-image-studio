export interface TransformRect { left: number; top: number; right: number; bottom: number }

export type TransformHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export const MIN_TRANSFORM_SIZE = 20;

export function moveRect(rect: TransformRect, dx: number, dy: number): TransformRect {
  return {
    left: rect.left + dx,
    right: rect.right + dx,
    top: rect.top + dy,
    bottom: rect.bottom + dy,
  };
}

/**
 * Photoshop Ctrl+T style resize: edge handles stretch a single axis freely,
 * corner handles stretch both. `keepAspect` (Shift) locks the original
 * proportions, anchored at the opposite corner.
 */
export function resizeRect(
  rect: TransformRect,
  handle: TransformHandle,
  point: { x: number; y: number },
  keepAspect = false,
): TransformRect {
  const next: TransformRect = { ...rect };
  if (handle.includes('w')) next.left = Math.min(point.x, next.right - MIN_TRANSFORM_SIZE);
  if (handle.includes('e')) next.right = Math.max(point.x, next.left + MIN_TRANSFORM_SIZE);
  if (handle.includes('n')) next.top = Math.min(point.y, next.bottom - MIN_TRANSFORM_SIZE);
  if (handle.includes('s')) next.bottom = Math.max(point.y, next.top + MIN_TRANSFORM_SIZE);

  if (keepAspect && handle.length === 2) {
    const startW = rect.right - rect.left;
    const startH = rect.bottom - rect.top;
    const scaleX = (next.right - next.left) / startW;
    const scaleY = (next.bottom - next.top) / startH;
    const factor = Math.abs(scaleX) > Math.abs(scaleY) ? scaleX : scaleY;
    if (handle.includes('e')) next.right = next.left + startW * factor;
    else next.left = next.right - startW * factor;
    if (handle.includes('s')) next.bottom = next.top + startH * factor;
    else next.top = next.bottom - startH * factor;
    // The aspect lock can still violate the minimum on very small drags
    if (next.right - next.left < MIN_TRANSFORM_SIZE || next.bottom - next.top < MIN_TRANSFORM_SIZE) {
      return { ...rect };
    }
  }
  return next;
}

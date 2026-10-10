// Round soft brush used by the result mask editor. A brush has two circles: inside the inner one (radius * hardness)
// it paints at full strength, between the inner and the outer circle it fades smoothly to zero. The dabs of one stroke
// are merged with max(), so the fade survives however densely the dabs overlap, and the stroke's opacity is applied
// once when it is composited onto the mask (like the opacity of a stroke in common image editors).
export interface StrokeBuffer { width: number; height: number; alpha: Float32Array }
export interface DirtyRect { x: number; y: number; width: number; height: number }

export const MAX_BRUSH_SIZE = 300;   // the size slider's maximum (a diameter, in mask pixels)

/** One press of [ or ]: about 10% bigger or smaller, but always at least one pixel so small sizes never get stuck. */
export function stepBrushSize(size: number, up: boolean): number {
  const scaled = Math.round(size * (up ? 1.1 : 1 / 1.1));
  const moved = scaled === size ? size + (up ? 1 : -1) : scaled;
  return Math.min(MAX_BRUSH_SIZE, Math.max(1, moved));
}

export function brushAlpha(distance: number, radius: number, hardness: number): number {
  const outer = Math.max(radius, 0.5);
  if (distance >= outer) return 0;
  // Even a fully hard brush gets a one pixel ramp at its edge: a bare threshold on the pixel centres draws a staircase.
  const inner = Math.min(outer * Math.min(100, Math.max(0, hardness)) / 100, Math.max(0, outer - 1));
  if (distance <= inner) return 1;
  const t = (distance - inner) / (outer - inner);
  return 1 - t * t * (3 - 2 * t);
}

export function createStrokeBuffer(width: number, height: number): StrokeBuffer {
  return { width, height, alpha: new Float32Array(width * height) };
}

/** Merge one dab into the stroke; returns the pixels it touched (clipped to the canvas), or null when it missed. */
export function stampStroke(buffer: StrokeBuffer, x: number, y: number, radius: number, hardness: number): DirtyRect | null {
  const left = Math.max(0, Math.floor(x - radius)), top = Math.max(0, Math.floor(y - radius));
  const right = Math.min(buffer.width, Math.ceil(x + radius) + 1), bottom = Math.min(buffer.height, Math.ceil(y + radius) + 1);
  if (right <= left || bottom <= top) return null;
  for (let py = top; py < bottom; py++) {
    const dy = py + 0.5 - y;
    for (let px = left; px < right; px++) {
      const alpha = brushAlpha(Math.hypot(px + 0.5 - x, dy), radius, hardness);
      const index = py * buffer.width + px;
      if (alpha > buffer.alpha[index]) buffer.alpha[index] = alpha;
    }
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function unionRect(a: DirtyRect | null, b: DirtyRect | null): DirtyRect | null {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}

/** Write `rect` of the grey mask: the mask as it was when the stroke began, moved towards black (erase) or white (restore). */
export function compositeStroke(base: Uint8ClampedArray, target: Uint8ClampedArray, buffer: StrokeBuffer, rect: DirtyRect,
  tool: 'erase' | 'restore', opacity: number): void {
  const strength = Math.min(100, Math.max(0, opacity)) / 100;
  for (let py = rect.y; py < rect.y + rect.height; py++) {
    for (let px = rect.x; px < rect.x + rect.width; px++) {
      const amount = buffer.alpha[py * buffer.width + px] * strength;
      const index = (py * buffer.width + px) * 4;
      const value = base[index];
      const next = tool === 'erase' ? value * (1 - amount) : value + (255 - value) * amount;
      target[index] = target[index + 1] = target[index + 2] = Math.round(next);
      target[index + 3] = 255;
    }
  }
}

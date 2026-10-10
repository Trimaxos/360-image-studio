// Window marks -> crop specs. Pure maths shared by the "Khung cửa" panel and its tests.
// Coordinates are the app's own: yaw 0 is the image centre of the equirectangular panorama, pitch is positive up,
// and the viewer's FOV is the VERTICAL field of view (the logical viewport is 1120x761, aspect 1.47).
import { PRESET_RATIOS } from './model-crop';
import type { ViewPose } from './types';

export interface Size { width: number; height: number }
export interface Rect { x: number; y: number; width: number; height: number }

/** The logical viewer every crop is defined in (the numbers the 360 viewer has in a 1600x900 window). */
export const VIEWPORT: Size = { width: 1120, height: 761 };

export type MarkKind = 'window' | 'nadir';

/** A box in degrees. yaw may run past ±180 (a window across the left/right seam, e.g. 176..186); pitch is positive up. */
export interface CropMark {
  id: string;
  name: string;
  kind: MarkKind;
  yaw: [number, number];
  pitch: [number, number];
}
export type ParsedMark = Omit<CropMark, 'id'>;

export interface CropSpec {
  name: string;
  kind: MarkKind;
  pose: ViewPose;
  rect: Rect;
  prompt: string;
  warnings: string[];
}

const rad = (degrees: number) => (degrees * Math.PI) / 180;

/** Any yaw (176..186 runs across the seam) into (-180, 180]. */
export function normalizeYaw(yaw: number): number {
  const wrapped = ((((yaw + 180) % 360) + 360) % 360) - 180;
  return wrapped === -180 ? 180 : wrapped;
}

/** Where a direction lands in the viewer for a pose; null when it is behind the camera. The server's projectScreenPoint, inverted. */
export function projectToViewer(
  yaw: number, pitch: number, pose: { yaw: number; pitch: number; fov: number }, viewport: Size = VIEWPORT,
): { x: number; y: number } | null {
  const lon = rad(yaw), lat = rad(pitch);
  const X = Math.cos(lat) * Math.sin(lon), Y = Math.sin(lat), Z = Math.cos(lat) * Math.cos(lon);
  const cy = Math.cos(rad(pose.yaw)), sy = Math.sin(rad(pose.yaw));
  const x1 = X * cy - Z * sy, z1 = X * sy + Z * cy;
  const cp = Math.cos(rad(pose.pitch)), sp = Math.sin(rad(pose.pitch));
  const y = Y * cp - z1 * sp, z = Y * sp + z1 * cp;
  if (z <= 1e-6) return null;
  const t = Math.tan(rad(pose.fov) / 2), aspect = viewport.width / viewport.height;
  return { x: ((x1 / z) / (aspect * t) + 1) / 2 * viewport.width, y: (1 - (y / z) / t) / 2 * viewport.height };
}

const NUMBER = '(-?\\d+(?:\\.\\d+)?)';
const RANGE = `${NUMBER}\\s*\\.\\.\\s*${NUMBER}`;
const LINE = new RegExp(`^(?:(.+?)\\s*:\\s*)?yaw\\s+${RANGE}\\s*[,;]?\\s*pitch\\s+${RANGE}$`, 'i');

export interface ParseError { line: number; text: string; message: string }

const ordered = (a: number, b: number): [number, number] => (a <= b ? [a, b] : [b, a]);

function problemWith(yaw: [number, number], pitch: [number, number]): string | null {
  if (yaw[1] - yaw[0] <= 0) return 'yaw phải có bề rộng > 0.';
  if (yaw[1] - yaw[0] > 180) return 'yaw rộng quá 180°: hãy tách thành nhiều khung.';
  if (yaw[0] < -360 || yaw[1] > 360) return 'yaw nằm ngoài khoảng −360..360.';
  if (pitch[1] - pitch[0] <= 0) return 'pitch phải có bề cao > 0.';
  if (pitch[0] < -90 || pitch[1] > 90) return 'pitch phải nằm trong −90..90.';
  return null;
}

/** One box per line: "Tên: yaw a..b, pitch c..d". Bad lines are reported by number; good lines are kept. */
export function parseMarkLines(text: string, firstNumber = 1): { marks: ParsedMark[]; errors: ParseError[] } {
  const marks: ParsedMark[] = [];
  const errors: ParseError[] = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;
    const match = LINE.exec(line);
    if (!match) {
      errors.push({ line: index + 1, text: line, message: 'Sai cú pháp. Ví dụ: Cửa A: yaw 70..110, pitch -8..14' });
      return;
    }
    const [, name, yawA, yawB, pitchA, pitchB] = match;
    const yaw = ordered(Number(yawA), Number(yawB));
    const pitch = ordered(Number(pitchA), Number(pitchB));
    const message = problemWith(yaw, pitch);
    if (message) {
      errors.push({ line: index + 1, text: line, message });
      return;
    }
    marks.push({ name: name?.trim() || `Cửa ${firstNumber + marks.length}`, kind: 'window', yaw, pitch });
  });
  return { marks, errors };
}

/** The number an unnamed box gets next: one past the highest "Cửa N" among the names already taken (boxes and layers). */
export function nextMarkNumber(names: string[]): number {
  return names.reduce((highest, name) => {
    const match = /^Cửa (\d+)$/.exec(name);
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0) + 1;
}

const SEAM_TOLERANCE = 1e-6; // px

/** The box on the flat image: one rectangle, or two when it runs across the left/right seam. */
export function markRects(mark: Pick<CropMark, 'yaw' | 'pitch'>, image: Size): Rect[] {
  const [yawFrom, yawTo] = mark.yaw;
  const [pitchFrom, pitchTo] = mark.pitch;
  const start = ((((yawFrom + 180) % 360) + 360) % 360) / 360 * image.width;
  const width = (yawTo - yawFrom) / 360 * image.width;
  const y = (90 - pitchTo) / 180 * image.height;
  const height = (pitchTo - pitchFrom) / 180 * image.height;
  const first = image.width - start;
  // A box ending exactly on the seam can overshoot by float noise (1e-12 px): keep it whole, no hairline on the far edge.
  if (width <= first + SEAM_TOLERANCE) return [{ x: start, y, width: Math.min(width, first), height }];
  return [{ x: start, y, width: first, height }, { x: 0, y, width: width - first, height }];
}

export const WINDOW_PROMPT = 'Apply HDR processing to the outside view through every window: balanced exposure with recovered highlight and shadow detail, a natural blue sky and green foliage, and remove the glare, glow and colour cast around the window frames. Keep the room interior, curtains, pillars and furniture unchanged.';
export const NADIR_PROMPT = 'Remove the camera tripod from the center of the floor. Reconstruct the floor exactly as it continues around it, with the same material, color and lighting. Keep the texture sharp and detailed, matching the surrounding floor.';

const MARGIN = 0.35;                       // context on each side, as a share of the box's own size
const MIN_MARGIN = 4;                      // degrees
const MIN_SPAN = { yaw: 28, pitch: 21 };   // a distant window must not become a tiny tile
const FOV_RANGE = { min: 20, max: 120 };
const FIT_PADDING = 8;                     // px kept free inside the viewport
const EDGE_SAMPLES = 13;
const MAX_TILE_EDGE = 3840;
const NADIR = {
  pose: { yaw: 0, pitch: -90, roll: 0, fov: 90 },
  rect: { x: 400, y: 212, width: 330, height: 330 },
};

export const NADIR_NAME = 'Chân máy';

export function nadirMark(): CropMark {
  return { id: 'nadir', name: NADIR_NAME, kind: 'nadir', yaw: [0, 0], pitch: [-90, -90] };
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const round1 = (value: number) => Math.round(value * 10) / 10;

interface Region { yawFrom: number; yawTo: number; pitchFrom: number; pitchTo: number }
export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

/** Bounding box (viewer px) of the region's outline; null when any part of it is behind the camera. */
function projectedBounds(region: Region, pose: { yaw: number; pitch: number; fov: number }, viewport: Size): Bounds | null {
  const bounds: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (let index = 0; index < EDGE_SAMPLES; index += 1) {
    const t = index / (EDGE_SAMPLES - 1);
    const yaw = region.yawFrom + (region.yawTo - region.yawFrom) * t;
    const pitch = region.pitchFrom + (region.pitchTo - region.pitchFrom) * t;
    const edge: Array<[number, number]> = [
      [yaw, region.pitchFrom], [yaw, region.pitchTo], [region.yawFrom, pitch], [region.yawTo, pitch],
    ];
    for (const [a, b] of edge) {
      const point = projectToViewer(a, b, pose, viewport);
      if (!point) return null;
      bounds.minX = Math.min(bounds.minX, point.x);
      bounds.minY = Math.min(bounds.minY, point.y);
      bounds.maxX = Math.max(bounds.maxX, point.x);
      bounds.maxY = Math.max(bounds.maxY, point.y);
    }
  }
  return bounds;
}

const fits = (bounds: Bounds, viewport: Size) => bounds.minX >= FIT_PADDING && bounds.minY >= FIT_PADDING
  && bounds.maxX <= viewport.width - FIT_PADDING && bounds.maxY <= viewport.height - FIT_PADDING;

/**
 * The smallest rectangle in one of the selection tool's ratios that holds the bounds inside the viewport, or null.
 * Sizes are whole multiples of the ratio's integer pair, the way roundSelectionSize sizes a dragged preset, so the
 * tile keeps the ratio exactly; a free ratio makes the model hand back a different aspect and the generation fail.
 */
export function presetRectAround(bounds: Bounds, viewport: Size): Rect | null {
  const left = Math.floor(bounds.minX), right = Math.ceil(bounds.maxX);
  const top = Math.floor(bounds.minY), bottom = Math.ceil(bounds.maxY);
  let best: Rect | null = null;
  for (const [w, h] of PRESET_RATIOS) {
    const factor = Math.ceil(Math.max((right - left) / w, (bottom - top) / h));
    const width = w * factor, height = h * factor;
    if (width > viewport.width || height > viewport.height) continue;
    if (best && width * height >= best.width * best.height) continue;
    best = {
      x: clamp(Math.floor((left + right - width) / 2), 0, viewport.width - width),
      y: clamp(Math.floor((top + bottom - height) / 2), 0, viewport.height - height),
      width,
      height,
    };
  }
  return best;
}

/** Last resort for a box nothing can hold: the biggest preset-ratio rectangle inside the viewport, centred. */
function largestPresetRect(viewport: Size): Rect {
  let best: Rect = { x: 0, y: 0, width: 1, height: 1 };
  for (const [w, h] of PRESET_RATIOS) {
    const factor = Math.floor(Math.min(viewport.width / w, viewport.height / h));
    const width = w * factor, height = h * factor;
    if (width * height <= best.width * best.height) continue;
    best = { x: Math.floor((viewport.width - width) / 2), y: Math.floor((viewport.height - height) / 2), width, height };
  }
  return best;
}

/** A mark -> the pose and drag rectangle Apply Rect would take, with generous context around the box. */
export function compileMark(mark: CropMark, options: { panorama: Size; viewport?: Size }): CropSpec {
  const viewport = options.viewport ?? VIEWPORT;
  if (mark.kind === 'nadir') {
    return { name: mark.name, kind: 'nadir', pose: { ...NADIR.pose }, rect: { ...NADIR.rect }, prompt: NADIR_PROMPT, warnings: [] };
  }
  const [yawFrom, yawTo] = mark.yaw;
  const [pitchFrom, pitchTo] = mark.pitch;
  const spanYaw = yawTo - yawFrom;
  const spanPitch = pitchTo - pitchFrom;
  const halfYaw = Math.max((spanYaw + 2 * Math.max(spanYaw * MARGIN, MIN_MARGIN)) / 2, MIN_SPAN.yaw / 2);
  const halfPitch = Math.max((spanPitch + 2 * Math.max(spanPitch * MARGIN, MIN_MARGIN)) / 2, MIN_SPAN.pitch / 2);
  const centerYaw = (yawFrom + yawTo) / 2;
  const centerPitch = clamp((pitchFrom + pitchTo) / 2, -90, 90);
  const yaw = round1(normalizeYaw(centerYaw));
  const pitch = round1(centerPitch);
  const region: Region = {
    yawFrom: centerYaw - halfYaw,
    yawTo: centerYaw + halfYaw,
    pitchFrom: clamp(centerPitch - halfPitch, -89.9, 89.9),
    pitchTo: clamp(centerPitch + halfPitch, -89.9, 89.9),
  };

  const warnings: string[] = [];
  let fov = FOV_RANGE.max;
  let rect: Rect | null = null;
  for (let candidate = FOV_RANGE.min; candidate <= FOV_RANGE.max; candidate += 1) {
    const measured = projectedBounds(region, { yaw, pitch, fov: candidate }, viewport);
    const held = measured && fits(measured, viewport) ? presetRectAround(measured, viewport) : null;
    if (held) {
      fov = candidate;
      rect = held;
      break;
    }
  }
  if (!rect) {
    warnings.push('Khung quá lớn: crop chỉ phủ một phần. Hãy tách thành nhiều khung nhỏ hơn.');
    rect = largestPresetRect(viewport);
  }

  if (Math.abs(pitch) > 60) warnings.push('Khung sát trần/sàn (|pitch| > 60°): ảnh crop bị méo.');
  if (fov > 110) warnings.push(`FOV ${fov}° quá rộng: rìa crop bị giãn.`);
  const density = (fov * options.panorama.height) / (180 * viewport.height);
  const edge = Math.round(Math.max(rect.width, rect.height) * density);
  if (edge > MAX_TILE_EDGE) warnings.push(`Tile ~${edge} px vượt ${MAX_TILE_EDGE}: server sẽ cắt bớt lề.`);

  return { name: mark.name, kind: 'window', pose: { yaw, pitch, roll: 0, fov }, rect, prompt: WINDOW_PROMPT, warnings };
}

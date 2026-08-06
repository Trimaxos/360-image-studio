import type { Layer, SelectionDraft, ViewPose } from '../../shared/types';

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function clampPoint(point: Point, bounds: Rect): Point {
  return {
    x: clamp(point.x, bounds.x, bounds.x + bounds.width),
    y: clamp(point.y, bounds.y, bounds.y + bounds.height),
  };
}

export function dragRect(start: Point, end: Point, bounds: Rect): Rect {
  const first = clampPoint(start, bounds);
  const last = clampPoint(end, bounds);
  return {
    x: Math.min(first.x, last.x),
    y: Math.min(first.y, last.y),
    width: Math.abs(last.x - first.x),
    height: Math.abs(last.y - first.y),
  };
}

export function containRect(viewport: Size, image: Size): Rect {
  const scale = Math.min(viewport.width / image.width, viewport.height / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  return {
    x: (viewport.width - width) / 2,
    y: (viewport.height - height) / 2,
    width,
    height,
  };
}

export function mapViewportRectToImage(rect: Rect, bounds: Rect, image: Size) {
  const x = (rect.x - bounds.x) * image.width / bounds.width;
  const y = (rect.y - bounds.y) * image.height / bounds.height;
  const width = rect.width * image.width / bounds.width;
  const height = rect.height * image.height / bounds.height;
  return {
    x: Math.max(0, Math.round(x)),
    y: Math.max(0, Math.round(y)),
    w: Math.min(image.width, Math.max(1, Math.round(width))),
    h: Math.min(image.height, Math.max(1, Math.round(height))),
  };
}

interface Vector3 { x: number; y: number; z: number }

function screenVector(point: Point, viewport: Size, pose: ViewPose): Vector3 {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const tanHalfFov = Math.tan(radians(pose.fov) / 2);
  const aspect = viewport.width / viewport.height;
  let x = (point.x / viewport.width * 2 - 1) * aspect * tanHalfFov;
  let y = (1 - point.y / viewport.height * 2) * tanHalfFov;
  let z = 1;
  const length = Math.hypot(x, y, z);
  x /= length; y /= length; z /= length;

  const roll = radians(pose.roll);
  [x, y] = [x * Math.cos(roll) - y * Math.sin(roll), x * Math.sin(roll) + y * Math.cos(roll)];
  const pitch = radians(pose.pitch);
  [y, z] = [y * Math.cos(pitch) + z * Math.sin(pitch), -y * Math.sin(pitch) + z * Math.cos(pitch)];
  const yaw = radians(pose.yaw);
  [x, z] = [x * Math.cos(yaw) + z * Math.sin(yaw), -x * Math.sin(yaw) + z * Math.cos(yaw)];
  return { x, y, z };
}

function panoramaVector(point: Point, panorama: Size): Vector3 {
  const longitude = (point.x / panorama.width - .5) * Math.PI * 2;
  const latitude = (.5 - point.y / panorama.height) * Math.PI;
  const cosLatitude = Math.cos(latitude);
  return {
    x: Math.sin(longitude) * cosLatitude,
    y: Math.sin(latitude),
    z: Math.cos(longitude) * cosLatitude,
  };
}

function angle(first: Vector3, second: Vector3): number {
  return Math.acos(Math.max(-1, Math.min(1, first.x * second.x + first.y * second.y + first.z * second.z)));
}

function capForSelection(selection: SelectionDraft): { center: Vector3; radius: number } {
  const { rect, viewport, viewPose } = selection;
  const center = screenVector({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }, viewport, viewPose);
  const corners = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x, y: rect.y + rect.height },
    { x: rect.x + rect.width, y: rect.y + rect.height },
  ];
  return { center, radius: Math.max(...corners.map((corner) => angle(center, screenVector(corner, viewport, viewPose)))) };
}

function capForFlatLayer(layer: Layer, panorama: Size): { center: Vector3; radius: number } {
  const tile = layer.tileCoords;
  const center = panoramaVector({ x: tile.x + tile.w / 2, y: tile.y + tile.h / 2 }, panorama);
  const corners = [
    { x: tile.x, y: tile.y },
    { x: tile.x + tile.w, y: tile.y },
    { x: tile.x, y: tile.y + tile.h },
    { x: tile.x + tile.w, y: tile.y + tile.h },
  ];
  return { center, radius: Math.max(...corners.map((corner) => angle(center, panoramaVector(corner, panorama)))) };
}

/** Conservative spherical overlap check used to avoid compositing unrelated layers. */
export function layerIntersectsSelection(layer: Layer, selection: SelectionDraft, panorama: Size): boolean {
  // Older perspective layers may not contain projection metadata. Keep them to
  // avoid incorrectly dropping a visible edit that cannot be located safely.
  if (layer.type === 'perspective' && !layer.selection) return true;
  const current = capForSelection(selection);
  const previous = layer.type === 'perspective'
    ? capForSelection(layer.selection)
    : capForFlatLayer(layer, panorama);
  const tolerance = Math.PI / 180;
  return angle(current.center, previous.center) <= current.radius + previous.radius + tolerance;
}

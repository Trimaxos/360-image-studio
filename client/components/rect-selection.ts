import { planModelCrop, planPerspectiveCrop } from '../../shared/model-crop';
import type { ViewPose } from '../../shared/types';

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
  const x = clamp(Math.round((rect.x - bounds.x) * image.width / bounds.width), 0, image.width - 1);
  const y = clamp(Math.round((rect.y - bounds.y) * image.height / bounds.height), 0, image.height - 1);
  const width = clamp(Math.round(rect.width * image.width / bounds.width), 1, image.width - x);
  const height = clamp(Math.round(rect.height * image.height / bounds.height), 1, image.height - y);
  return { x, y, w: width, h: height };
}

export function planAlignedSelection(
  sourceView: 'flat' | '360', rect: Rect, viewport: Size, image: Size, pose: ViewPose,
) {
  if (sourceView === '360') {
    const plan = planPerspectiveCrop(viewport, pose, rect, image);
    return { ...plan, tileCoords: { x: 0, y: 0, w: plan.output.width, h: plan.output.height } };
  }
  const bounds = containRect(viewport, image);
  // Round inward so even a fractional viewport drag never includes pixels
  // outside the user's requested context rectangle.
  const x = clamp(Math.ceil((rect.x - bounds.x) * image.width / bounds.width - 1e-9), 0, image.width);
  const y = clamp(Math.ceil((rect.y - bounds.y) * image.height / bounds.height - 1e-9), 0, image.height);
  const right = clamp(Math.floor((rect.x + rect.width - bounds.x) * image.width / bounds.width + 1e-9), x, image.width);
  const bottom = clamp(Math.floor((rect.y + rect.height - bounds.y) * image.height / bounds.height + 1e-9), y, image.height);
  const tile = { x, y, w: right - x, h: bottom - y };
  const plan = planModelCrop(tile.w, tile.h);
  const tileCoords = { x: tile.x + plan.crop.x, y: tile.y + plan.crop.y,
    w: plan.crop.width, h: plan.crop.height };
  return { ...plan, tileCoords, rect: {
    x: bounds.x + tileCoords.x * bounds.width / image.width,
    y: bounds.y + tileCoords.y * bounds.height / image.height,
    width: tileCoords.w * bounds.width / image.width,
    height: tileCoords.h * bounds.height / image.height,
  } };
}

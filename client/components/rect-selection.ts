import { planModelCrop, planPerspectiveCrop, roundSelectionSize } from '../../shared/model-crop';
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

export const SELECTION_RATIOS = ['1:1', '2:3', '3:2', '4:3', '3:4', '16:9', '9:16', '1:2', '2:1', '1:3', '3:1'] as const;

export function dragRect(start: Point, end: Point, bounds: Rect, aspectRatio?: number): Rect {
  const first = clampPoint(start, bounds);
  const last = clampPoint(end, bounds);
  if (aspectRatio !== undefined) {
    const dx = last.x - first.x;
    const dy = last.y - first.y;
    const maxWidth = dx < 0 ? first.x - bounds.x : bounds.x + bounds.width - first.x;
    const maxHeight = dy < 0 ? first.y - bounds.y : bounds.y + bounds.height - first.y;
    const width = Math.min(Math.max(Math.abs(dx), Math.abs(dy) * aspectRatio), maxWidth, maxHeight * aspectRatio);
    const height = width / aspectRatio;
    return { x: dx < 0 ? first.x - width : first.x,
      y: dy < 0 ? first.y - height : first.y, width, height };
  }
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
  const { width, height } = roundSelectionSize(
    rect.width * image.width / bounds.width, rect.height * image.height / bounds.height, image,
  );
  // Move the rounded origin inward at image edges instead of clipping one
  // dimension independently and losing the selected ratio.
  const x = clamp(Math.round((rect.x - bounds.x) * image.width / bounds.width), 0, image.width - width);
  const y = clamp(Math.round((rect.y - bounds.y) * image.height / bounds.height), 0, image.height - height);
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

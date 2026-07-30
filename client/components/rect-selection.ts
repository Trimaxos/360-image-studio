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

import { useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { markRects, nextMarkNumber, type CropMark } from '../../shared/crop-plan';
import { useProjectStore } from '../stores/project';
import { clampPoint, containRect, type Point } from './rect-selection';

const range = (from: number, to: number, step: number) => {
  const values: number[] = [];
  for (let value = from; value <= to; value += step) values.push(value);
  return values;
};
const round1 = (value: number) => Math.round(value * 10) / 10;

/** Yaw/pitch grid and the marked boxes, drawn inside the Flat View's SVG (image pixel units). */
export function MarksSvgLayer({ width, height, marks, grid }: { width: number; height: number; marks: CropMark[]; grid: boolean }) {
  const font = width / 80;
  return (
    <g className="marks-layer" pointerEvents="none" fontSize={font}>
      {grid && range(-180, 180, 10).map((yaw) => {
        const x = ((yaw + 180) / 360) * width;
        return (
          <g key={`yaw${yaw}`}>
            <line className={yaw % 30 === 0 ? 'marks-grid strong' : 'marks-grid'} x1={x} y1={0} x2={x} y2={height} vectorEffect="non-scaling-stroke" />
            {yaw % 30 === 0 && <text className="marks-label" x={x + font * 0.2} y={font * 1.1}>{yaw}</text>}
          </g>
        );
      })}
      {grid && range(-80, 80, 10).map((pitch) => {
        const y = ((90 - pitch) / 180) * height;
        return (
          <g key={`pitch${pitch}`}>
            <line className={pitch % 30 === 0 ? 'marks-grid strong' : 'marks-grid'} x1={0} y1={y} x2={width} y2={y} vectorEffect="non-scaling-stroke" />
            {pitch % 30 === 0 && <text className="marks-label" x={font * 0.2} y={y - font * 0.2}>{pitch}</text>}
          </g>
        );
      })}
      {marks.map((mark) => markRects(mark, { width, height }).map((rect, index) => (
        <g key={`${mark.id}-${index}`}>
          <rect className="marks-box" x={rect.x} y={rect.y} width={rect.width} height={rect.height} vectorEffect="non-scaling-stroke" />
          {index === 0 && <text className="marks-name" x={rect.x + font * 0.3} y={rect.y + font * 1.1}>{mark.name}</text>}
        </g>
      )))}
    </g>
  );
}

/** Drag on the Flat View to add a box; the pointer is mapped through the contain-fit bounds of the image. */
export function MarkDrawOverlay({ imageWidth, imageHeight }: { imageWidth: number; imageHeight: number }) {
  const addMarks = useProjectStore((state) => state.addMarks);
  const marks = useProjectStore((state) => state.marks);
  const layers = useProjectStore((state) => state.layers);
  const overlay = useRef<HTMLDivElement>(null);
  const start = useRef<Point | null>(null);
  const [drag, setDrag] = useState<{ from: Point; to: Point } | null>(null);

  const measure = () => {
    const box = overlay.current!.getBoundingClientRect();
    return { box, area: containRect({ width: box.width, height: box.height }, { width: imageWidth, height: imageHeight }) };
  };
  const pointOf = (event: ReactPointerEvent): Point => {
    const { box, area } = measure();
    return clampPoint({ x: event.clientX - box.left, y: event.clientY - box.top }, area);
  };
  const finish = (event: ReactPointerEvent<HTMLDivElement>) => {
    const from = start.current;
    start.current = null;
    setDrag(null);
    if (!from) return;
    const to = pointOf(event);
    if (Math.abs(to.x - from.x) < 6 || Math.abs(to.y - from.y) < 6) return;
    const { area } = measure();
    const yawOf = (x: number) => round1(((x - area.x) / area.width) * 360 - 180);
    const pitchOf = (y: number) => round1(90 - ((y - area.y) / area.height) * 180);
    const yaw = [yawOf(from.x), yawOf(to.x)].sort((a, b) => a - b) as [number, number];
    const pitch = [pitchOf(from.y), pitchOf(to.y)].sort((a, b) => a - b) as [number, number];
    const taken = [...marks.map((mark) => mark.name), ...layers.map((layer) => layer.name ?? '')];
    addMarks([{ name: `Cửa ${nextMarkNumber(taken)}`, kind: 'window', yaw, pitch }]);
  };

  return (
    <div
      ref={overlay}
      className="marks-draw-overlay"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        start.current = pointOf(event);
        setDrag({ from: start.current, to: start.current });
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => { if (start.current) setDrag({ from: start.current, to: pointOf(event) }); }}
      onPointerUp={(event) => {
        finish(event);
        event.currentTarget.releasePointerCapture?.(event.pointerId);
      }}
      onPointerCancel={() => { start.current = null; setDrag(null); }}
    >
      {drag && (
        <div className="marks-draw-rect" style={{
          left: Math.min(drag.from.x, drag.to.x), top: Math.min(drag.from.y, drag.to.y),
          width: Math.abs(drag.to.x - drag.from.x), height: Math.abs(drag.to.y - drag.from.y),
        }} />
      )}
    </div>
  );
}

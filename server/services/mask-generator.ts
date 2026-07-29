import sharp from 'sharp';
import type { MaskShape } from '../../shared/types';

/**
 * Tạo mask image từ MaskShape[].
 * Output: PNG RGBA — white pixels where mask covers, transparent everywhere else.
 */
export async function createMaskFromShapes(
  shapes: MaskShape[],
  width: number,
  height: number
): Promise<Buffer> {
  const svgParts: string[] = [];

  for (const shape of shapes) {
    if (shape.type === 'brush' && shape.points) {
      const pts = shape.points.map(p => `${p.x},${p.y}`).join(' ');
      svgParts.push(
        `<polyline points="${pts}" fill="none" stroke="white" stroke-width="25" stroke-linecap="round" stroke-linejoin="round" opacity="1"/>`
      );
    } else if (shape.type === 'rect') {
      svgParts.push(
        `<rect x="${shape.x}" y="${shape.y}" width="${shape.w}" height="${shape.h}" fill="white" opacity="1"/>`
      );
    } else if (shape.type === 'lasso' && shape.points) {
      const pts = shape.points.map(p => `${p.x},${p.y}`).join(' ');
      svgParts.push(
        `<polygon points="${pts}" fill="white" opacity="1"/>`
      );
    }
  }

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${svgParts.join('')}</svg>`;

  // Render SVG lên transparent canvas
  return sharp({
    create: {
      width: Math.round(width),
      height: Math.round(height),
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: Buffer.from(svg), blend: 'over' }])
    .png()
    .toBuffer();
}

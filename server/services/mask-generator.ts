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
  const active = shapes.filter((s) => s.enabled !== false);
  const addShapes = active.filter((s) => s.action !== 'subtract');
  const subShapes = active.filter((s) => s.action === 'subtract');

  // 1. Render additive shapes as white on transparent
  const addSvgParts: string[] = [];
  for (const shape of addShapes) {
    if (shape.type === 'brush' && shape.points) {
      const pts = shape.points.map(p => `${p.x},${p.y}`).join(' ');
      addSvgParts.push(
        `<polyline points="${pts}" fill="none" stroke="white" stroke-width="25" stroke-linecap="round" stroke-linejoin="round" opacity="1"/>`
      );
    } else if (shape.type === 'rect') {
      addSvgParts.push(
        `<rect x="${shape.x}" y="${shape.y}" width="${shape.w}" height="${shape.h}" fill="white" opacity="1"/>`
      );
    } else if (shape.type === 'lasso' && shape.points) {
      const pts = shape.points.map(p => `${p.x},${p.y}`).join(' ');
      addSvgParts.push(
        `<polygon points="${pts}" fill="white" opacity="1"/>`
      );
    }
  }

  // 2. Render subtractive shapes as white on transparent (will be used with dest-out)
  const subSvgParts: string[] = [];
  for (const shape of subShapes) {
    if (shape.type === 'brush' && shape.points) {
      const pts = shape.points.map(p => `${p.x},${p.y}`).join(' ');
      subSvgParts.push(
        `<polyline points="${pts}" fill="none" stroke="white" stroke-width="25" stroke-linecap="round" stroke-linejoin="round" opacity="1"/>`
      );
    } else if (shape.type === 'lasso' && shape.points) {
      const pts = shape.points.map(p => `${p.x},${p.y}`).join(' ');
      subSvgParts.push(
        `<polygon points="${pts}" fill="white" opacity="1"/>`
      );
    }
  }

  const svgW = Math.round(width);
  const svgH = Math.round(height);

  // Render additive mask
  const addSvg = `<svg width="${svgW}" height="${svgH}" xmlns="http://www.w3.org/2000/svg">${addSvgParts.join('')}</svg>`;
  let maskBuffer = await sharp({
    create: {
      width: svgW,
      height: svgH,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: Buffer.from(addSvg), blend: 'over' }])
    .png()
    .toBuffer();

  // Apply subtractive shapes via dest-out
  if (subSvgParts.length > 0) {
    const subSvg = `<svg width="${svgW}" height="${svgH}" xmlns="http://www.w3.org/2000/svg">${subSvgParts.join('')}</svg>`;
    const subBuffer = await sharp({
      create: {
        width: svgW,
        height: svgH,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([{ input: Buffer.from(subSvg), blend: 'over' }])
      .png()
      .toBuffer();

    maskBuffer = await sharp(maskBuffer)
      .composite([{ input: subBuffer, blend: 'dest-out' }])
      .png()
      .toBuffer();
  }

  return maskBuffer;
}

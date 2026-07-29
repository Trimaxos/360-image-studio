/** Convert Blob/ArrayBuffer to base64 string (không có data URI prefix) */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip data:...;base64, prefix
      resolve(result.split(',')[1]);
    };
    reader.onerror = () => reject(new Error('Failed to read blob'));
    reader.readAsDataURL(blob);
  });
}

export interface MaskShape {
  id: string;
  tool: 'brush' | 'rect' | 'lasso';
  points: { x: number; y: number }[];
  radius?: number;
}

export function maskToBoundingBox(shapes: MaskShape[]): { x: number; y: number; w: number; h: number } | null {
  if (!shapes.length) return null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (const shape of shapes) {
    for (const p of shape.points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    if (shape.radius) {
      minX -= shape.radius; minY -= shape.radius;
      maxX += shape.radius; maxY += shape.radius;
    }
  }

  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

// Convert Fabric.js canvas to MaskShape[] — defined in Task 13 (fabricToMaskData)
// See Task 13 Step 2 for the full implementation re-exported from here

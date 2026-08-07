/** Convert Blob/ArrayBuffer to base64 string (không có data URI prefix) */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip data:...;base64, prefix
      resolve(result.split(',')[1]);
    };
    reader.onerror = () => reject(new Error('Không đọc được dữ liệu ảnh'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Generate a solid white mask at the given dimensions.
 * A white mask makes the AI edit the complete selected rectangle.
 */
export function createWhiteMask(width: number, height: number): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  return Promise.resolve(canvas.toDataURL('image/png').split(',')[1]);
}


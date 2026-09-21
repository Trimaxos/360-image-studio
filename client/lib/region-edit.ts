function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Không thể tải ảnh để xử lý vùng chỉnh sửa.'));
    image.src = source.startsWith('data:') ? source : `data:image/png;base64,${source}`;
  });
}

/**
 * Keeps the AI-edited image only within the drawn region — everywhere else
 * reverts to the original. The AI always receives the full image (so it has
 * real context to work from instead of an isolated, feature-less crop); this
 * blend is what actually confines the visible change to where the user drew,
 * regardless of whether the model honored an inpainting mask.
 */
export async function blendRegionResult(
  originalBase64: string,
  editedBase64: string,
  maskBase64: string,
): Promise<string> {
  const [original, edited, mask] = await Promise.all([
    loadImage(originalBase64),
    loadImage(editedBase64),
    loadImage(maskBase64),
  ]);
  const width = original.naturalWidth;
  const height = original.naturalHeight;

  const result = document.createElement('canvas');
  result.width = width;
  result.height = height;
  const resultContext = result.getContext('2d')!;
  resultContext.drawImage(original, 0, 0, width, height);

  const overlay = document.createElement('canvas');
  overlay.width = width;
  overlay.height = height;
  const overlayContext = overlay.getContext('2d', { willReadFrequently: true })!;
  overlayContext.drawImage(edited, 0, 0, width, height);

  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = width;
  maskCanvas.height = height;
  const maskContext = maskCanvas.getContext('2d', { willReadFrequently: true })!;
  maskContext.drawImage(mask, 0, 0, width, height);

  const overlayPixels = overlayContext.getImageData(0, 0, width, height);
  const maskPixels = maskContext.getImageData(0, 0, width, height);
  for (let index = 3; index < overlayPixels.data.length; index += 4) {
    overlayPixels.data[index] = Math.round(overlayPixels.data[index] * maskPixels.data[index - 3] / 255);
  }
  overlayContext.putImageData(overlayPixels, 0, 0);
  resultContext.drawImage(overlay, 0, 0);

  return result.toDataURL('image/png').split(',')[1];
}

/**
 * Describes where the drawn region sits as percentages of the image, for
 * models with no real mask input at all — without this, those models have
 * zero spatial information about where the user actually wants the edit.
 */
export function describeRegionLocation(
  points: { x: number; y: number }[],
  imageWidth: number,
  imageHeight: number,
): string {
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const pct = (value: number, total: number) => Math.round(Math.max(0, Math.min(total, value)) / total * 100);
  const left = pct(Math.min(...xs), imageWidth);
  const right = pct(Math.max(...xs), imageWidth);
  const top = pct(Math.min(...ys), imageHeight);
  const bottom = pct(Math.max(...ys), imageHeight);
  return `horizontally ${left}%-${right}% and vertically ${top}%-${bottom}% of the image, `
    + 'measured from the left/top edge (0%) to the right/bottom edge (100%)';
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Không thể tải ảnh để tạo bản xem trước.'));
    image.src = url;
  });
}

const previewCache = new Map<string, string>();
const MAX_PREVIEW_CACHE_ENTRIES = 8;

/** Places the edited AI result over the untouched source using the saved grayscale mask. */
export async function composeVariantPreview(
  originalUrl: string,
  variantUrl: string,
  base64Mask: string,
): Promise<string> {
  const cacheKey = `${originalUrl}|${variantUrl}|${base64Mask}`;
  const cached = previewCache.get(cacheKey);
  if (cached) {
    // Refresh insertion order so recently revisited results stay cached.
    previewCache.delete(cacheKey);
    previewCache.set(cacheKey, cached);
    return cached;
  }
  const [original, variant, mask] = await Promise.all([
    loadImage(originalUrl),
    loadImage(variantUrl),
    loadImage(`data:image/png;base64,${base64Mask}`),
  ]);
  const width = variant.naturalWidth;
  const height = variant.naturalHeight;
  const result = document.createElement('canvas');
  result.width = width;
  result.height = height;
  const resultContext = result.getContext('2d')!;
  resultContext.drawImage(original, 0, 0, width, height);

  const overlay = document.createElement('canvas');
  overlay.width = width;
  overlay.height = height;
  const overlayContext = overlay.getContext('2d', { willReadFrequently: true })!;
  overlayContext.drawImage(variant, 0, 0, width, height);
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = width;
  maskCanvas.height = height;
  const maskContext = maskCanvas.getContext('2d', { willReadFrequently: true })!;
  maskContext.drawImage(mask, 0, 0, width, height);
  const overlayPixels = overlayContext.getImageData(0, 0, width, height);
  const maskPixels = maskContext.getImageData(0, 0, width, height);
  for (let index = 3; index < overlayPixels.data.length; index += 4) {
    overlayPixels.data[index] = Math.round(
      overlayPixels.data[index] * maskPixels.data[index - 3] / 255,
    );
  }
  overlayContext.putImageData(overlayPixels, 0, 0);
  resultContext.drawImage(overlay, 0, 0);
  const preview = result.toDataURL('image/png');
  previewCache.set(cacheKey, preview);
  if (previewCache.size > MAX_PREVIEW_CACHE_ENTRIES) {
    const oldestKey = previewCache.keys().next().value;
    if (oldestKey) previewCache.delete(oldestKey);
  }
  return preview;
}

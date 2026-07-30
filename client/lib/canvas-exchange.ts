interface Size {
  width: number;
  height: number;
}

export function coverSourceRect(source: Size, target: Size) {
  const sourceAspect = source.width / source.height;
  const targetAspect = target.width / target.height;
  if (sourceAspect > targetAspect) {
    const sw = source.height * targetAspect;
    return { sx: (source.width - sw) / 2, sy: 0, sw, sh: source.height };
  }
  const sh = source.width / targetAspect;
  return { sx: 0, sy: (source.height - sh) / 2, sw: source.width, sh };
}

export async function blobToPngBase64(blob: Blob, target: Size): Promise<string> {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(target.width));
    canvas.height = Math.max(1, Math.round(target.height));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Trình duyệt không hỗ trợ canvas 2D.');
    const crop = coverSourceRect(
      { width: bitmap.width, height: bitmap.height },
      { width: canvas.width, height: canvas.height },
    );
    context.drawImage(
      bitmap,
      crop.sx, crop.sy, crop.sw, crop.sh,
      0, 0, canvas.width, canvas.height,
    );
    return canvas.toDataURL('image/png').split(',')[1];
  } finally {
    bitmap.close();
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function copyPngBlob(blob: Blob): Promise<void> {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
    throw new Error('Trình duyệt không hỗ trợ copy ảnh vào clipboard.');
  }
  const png = blob.type === 'image/png'
    ? blob
    : new Blob([await blob.arrayBuffer()], { type: 'image/png' });
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
}

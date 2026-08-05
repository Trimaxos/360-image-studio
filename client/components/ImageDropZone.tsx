import { useState } from 'react';

export function isSupportedImage(file: File): boolean {
  return /^image\/(jpeg|png|tiff|webp)$/.test(file.type)
    || /\.(jpe?g|png|tiff?|webp)$/i.test(file.name);
}

export default function ImageDropZone({ onOpenFile }: { onOpenFile: (file: File) => Promise<void> }) {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const inputId = 'empty-image-picker';
  const open = async (file?: File) => {
    if (!file) return;
    if (!isSupportedImage(file)) {
      setError('Định dạng không hỗ trợ. Chọn JPG, PNG, TIFF hoặc WebP.');
      return;
    }
    setError('');
    try {
      await onOpenFile(file);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể mở ảnh.');
    }
  };
  return (
    <label
      className={`image-drop-zone ${dragging ? 'dragging' : ''}`}
      htmlFor={inputId}
      onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        void open(event.dataTransfer.files[0]);
      }}
    >
      <input
        id={inputId}
        type="file"
        accept="image/jpeg,image/png,image/tiff,image/webp,.jpg,.jpeg,.png,.tif,.tiff,.webp"
        onChange={(event) => {
          void open(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
      <span className="drop-icon">＋</span>
      <strong>Kéo thả ảnh panorama vào đây</strong>
      <span>hoặc bấm để chọn ảnh</span>
      {error && <span className="drop-error">{error}</span>}
    </label>
  );
}

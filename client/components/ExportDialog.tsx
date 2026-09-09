import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { downloadBlob } from '../lib/canvas-exchange';
import { useProjectStore } from '../stores/project';

interface Props {
  open: boolean;
  onClose: () => void;
}

const FORMATS = ['jpeg', 'png', 'webp', 'avif'] as const;

const MIME: Record<string, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
};

export default function ExportDialog({ open, onClose }: Props) {
  const imagePath = useProjectStore((s) => s.imagePath);
  const layers = useProjectStore((s) => s.layers);
  const horizon = useProjectStore((s) => s.horizon);

  const [format, setFormat] = useState<typeof FORMATS[number]>('jpeg');
  const [quality, setQuality] = useState(95);
  const [exporting, setExporting] = useState(false);
  const [done, setDone] = useState(false);
  const [savedName, setSavedName] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setFormat('jpeg');
    setQuality(95);
    setExporting(false);
    setDone(false);
    setSavedName('');
    setError('');
  }, [open]);

  if (!open) return null;

  const baseName = () => {
    const base = (imagePath?.split('/').pop()?.split('\\').pop()?.replace(/\.\w+$/, '') ?? 'panorama');
    return `${base}-edited`;
  };

  const close = () => {
    setDone(false);
    setError('');
    setExporting(false);
    onClose();
  };

  const handleExport = async () => {
    if (!imagePath) return;
    setExporting(true);
    setError('');
    try {
      const blob = await api.image.export({ path: imagePath, format, quality, layers, horizon });
      const filename = `${baseName()}.${format}`;

      if (typeof window.showSaveFilePicker === 'function') {
        try {
          const handle = await window.showSaveFilePicker({
            suggestedName: filename,
            types: [{ description: `${format.toUpperCase()} image`, accept: { [MIME[format]]: [`.${format}`] } }],
          });
          const writable = await handle.createWritable();
          await writable.write(blob);
          await writable.close();
          setSavedName(handle.name);
        } catch (err: any) {
          if (err?.name === 'AbortError') return;
          throw err;
        }
      } else {
        downloadBlob(blob, filename);
        setSavedName(filename);
      }
      setDone(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-box" style={{ width: 440 }}>
        <h2>Export Image</h2>

        <div className="modal-row">
          <label>Format:</label>
          <select value={format} onChange={(e) => setFormat(e.target.value as any)}>
            {FORMATS.map((f) => <option key={f} value={f}>{f.toUpperCase()}</option>)}
          </select>
        </div>

        <div className="modal-row">
          <label>Quality: {quality}%</label>
          <input type="range" min={1} max={100} value={quality}
            onChange={(e) => setQuality(Number(e.target.value))} />
        </div>

        {done ? (
          <div style={{ marginTop: 16 }}>
            <p style={{ color: '#4caf50', fontSize: 13, marginBottom: 12 }}>
              ✅ Exported {savedName}
            </p>
            <div className="modal-actions">
              <button className="modal-btn modal-btn-primary" onClick={close}>Close</button>
            </div>
          </div>
        ) : (
          <div className="modal-actions">
            <button className="modal-btn modal-btn-secondary" onClick={close}>Cancel</button>
            <button
              className="modal-btn modal-btn-primary"
              disabled={exporting}
              onClick={() => void handleExport()}
            >
              {exporting ? '⏳ Exporting...' : 'Export'}
            </button>
          </div>
        )}

        {error && <p style={{ color: '#ef5350', fontSize: 13, marginTop: 12 }}>{error}</p>}
      </div>
    </div>
  );
}

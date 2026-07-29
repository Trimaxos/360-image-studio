import React, { useState } from 'react';
import { api } from '../lib/api';
import { useProjectStore } from '../stores/project';

interface Props {
  open: boolean;
  onClose: () => void;
}

const FORMATS = ['jpeg', 'png', 'webp', 'avif'] as const;

export default function ExportDialog({ open, onClose }: Props) {
  const [format, setFormat] = useState<typeof FORMATS[number]>('jpeg');
  const [quality, setQuality] = useState(95);
  const [outputPath, setOutputPath] = useState('');
  const [exporting, setExporting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const imagePath = useProjectStore((s) => s.imagePath);
  const layers = useProjectStore((s) => s.layers);
  const horizon = useProjectStore((s) => s.horizon);

  if (!open) return null;

  const handleExport = async () => {
    if (!outputPath.trim() || !imagePath) return;
    setExporting(true);
    setError('');
    try {
      await api.image.export({
        path: imagePath,
        outputPath,
        format,
        quality,
        layers,
        horizon,
      });
      setDone(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.dialog}>
        <h2 style={styles.title}>Export Image</h2>

        <label style={styles.label}>
          Format:
          <select value={format} onChange={(e) => setFormat(e.target.value as any)} style={styles.select}>
            {FORMATS.map((f) => <option key={f} value={f}>{f.toUpperCase()}</option>)}
          </select>
        </label>

        <label style={styles.label}>
          Quality: {quality}%
          <input type="range" min={1} max={100} value={quality}
            onChange={(e) => setQuality(Number(e.target.value))} style={styles.range} />
        </label>

        <label style={styles.label}>
          Output path:
          <input type="text" value={outputPath}
            onChange={(e) => setOutputPath(e.target.value)}
            placeholder="/home/user/panorama_edited.jpg"
            style={styles.input} />
        </label>

        <div style={styles.actions}>
          <button onClick={onClose} style={styles.cancelBtn}>Cancel</button>
          <button onClick={handleExport} disabled={exporting || !outputPath.trim() || done}
            style={{ ...styles.exportBtn, opacity: exporting ? 0.5 : 1 }}>
            {done ? '✅ Done' : exporting ? '⏳ Exporting...' : 'Export'}
          </button>
        </div>

        {error && <p style={styles.error}>{error}</p>}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
  },
  dialog: {
    background: '#1a1a2e', padding: 24, borderRadius: 12, width: 400,
    border: '1px solid #333', color: '#fff',
  },
  title: { margin: '0 0 20px 0', fontSize: 20 },
  label: { display: 'block', marginBottom: 16, fontSize: 14, color: '#ccc' },
  select: { width: '100%', padding: 8, marginTop: 4, background: '#16213e', color: '#fff', border: '1px solid #444', borderRadius: 6 },
  input: { width: '100%', padding: 8, marginTop: 4, background: '#16213e', color: '#fff', border: '1px solid #444', borderRadius: 6, boxSizing: 'border-box' },
  range: { width: '100%', marginTop: 4 },
  actions: { display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 20 },
  cancelBtn: { padding: '8px 20px', background: '#444', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' },
  exportBtn: { padding: '8px 20px', background: '#0d7377', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' },
  error: { color: '#ef5350', fontSize: 13, marginTop: 12 },
};

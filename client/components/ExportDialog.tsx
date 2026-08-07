import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useProjectStore } from '../stores/project';

interface Props {
  open: boolean;
  onClose: () => void;
}

const FORMATS = ['jpeg', 'png', 'webp', 'avif'] as const;

export default function ExportDialog({ open, onClose }: Props) {
  const imagePath = useProjectStore((s) => s.imagePath);
  const layers = useProjectStore((s) => s.layers);
  const horizon = useProjectStore((s) => s.horizon);

  const [format, setFormat] = useState<typeof FORMATS[number]>('jpeg');
  const [quality, setQuality] = useState(95);
  const [outputDir, setOutputDir] = useState('');
  const [filename, setFilename] = useState('');
  const [exporting, setExporting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [browseOpen, setBrowseOpen] = useState(false);
  const [browsePath, setBrowsePath] = useState('');
  const [browseDirs, setBrowseDirs] = useState<{ name: string; path: string }[]>([]);
  const [browseParent, setBrowseParent] = useState<string | null>(null);
  const [homeDir, setHomeDir] = useState('');

  // Initialize homeDir from server on first mount
  useEffect(() => {
    api.filesystem.browse().then(r => setHomeDir(r.path)).catch(() => setHomeDir('/tmp'));
  }, []);

  // Reset all state when dialog opens
  useEffect(() => {
    if (!open) return;
    const base = (imagePath?.split('/').pop()?.split('\\').pop()?.replace(/\.\w+$/, '') ?? 'panorama');
    setOutputDir('');
    setFilename(`${base}-edited`);
    setFormat('jpeg');
    setQuality(95);
    setExporting(false);
    setDone(false);
    setError('');
    setBrowseOpen(false);
  }, [open, imagePath]);

  if (!open) return null;

  const defaultName = () => {
    const base = (imagePath?.split('/').pop()?.split('\\').pop()?.replace(/\.\w+$/, '') ?? 'panorama');
    return `${base}-edited`;
  };

  const close = () => {
    setDone(false);
    setError('');
    setExporting(false);
    setBrowseOpen(false);
    onClose();
  };

  const openBrowse = async (initialPath?: string) => {
    setBrowseOpen(true);
    try {
      const result = await api.filesystem.browse(initialPath);
      setBrowsePath(result.path);
      setBrowseDirs(result.directories);
      setBrowseParent(result.parent);
    } catch (err: any) {
      setError(err.message);
      setBrowseOpen(false);
    }
  };

  const navigateTo = async (dirPath: string) => {
    try {
      const result = await api.filesystem.browse(dirPath);
      setBrowsePath(result.path);
      setBrowseDirs(result.directories);
      setBrowseParent(result.parent);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const selectDir = () => {
    setOutputDir(browsePath);
    setBrowseOpen(false);
  };

  const fullPath = () => {
    const name = filename.trim() || defaultName();
    const dir = outputDir || homeDir || '/tmp';
    return `${dir}/${name}.${format}`;
  };

  const handleExport = async () => {
    if (!imagePath) return;
    setExporting(true);
    setError('');
    const outputPath = fullPath();
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
    <>
      <div className="modal-overlay">
        <div className="modal-box" style={{ width: 440 }}>
          <h2>Xuất ảnh</h2>

          <div className="modal-row">
            <label>Định dạng:</label>
            <select value={format} onChange={(e) => setFormat(e.target.value as any)}>
              {FORMATS.map((f) => <option key={f} value={f}>{f.toUpperCase()}</option>)}
            </select>
          </div>

          <div className="modal-row">
            <label>Chất lượng: {quality}%</label>
            <input type="range" min={1} max={100} value={quality}
              onChange={(e) => setQuality(Number(e.target.value))} />
          </div>

          <div className="modal-row">
            <label>Lưu vào:</label>
            <input
              value={outputDir}
              onChange={(e) => setOutputDir(e.target.value)}
              placeholder={homeDir || '/tmp'}
              readOnly
              style={{ cursor: 'pointer' }}
              onClick={() => openBrowse(outputDir || undefined)}
            />
            <button className="modal-btn modal-btn-secondary" onClick={() => openBrowse(outputDir || undefined)}>
              📂
            </button>
          </div>

          <div className="modal-row">
            <label>Tên tệp:</label>
            <input
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              placeholder={defaultName()}
            />
            <span style={{ color: '#888', fontSize: 12, whiteSpace: 'nowrap' }}>.{format}</span>
          </div>

          {outputDir && filename.trim() && (
            <p style={{ fontSize: 11, color: '#888', marginTop: -4, marginBottom: 8 }}>
              → {fullPath()}
            </p>
          )}

          {done ? (
            <div style={{ marginTop: 16 }}>
              <p style={{ color: '#4caf50', fontSize: 13, marginBottom: 12 }}>
                ✅ Đã xuất ra {fullPath()}
              </p>
              <div className="modal-actions">
                <button className="modal-btn modal-btn-primary" onClick={close}>Đóng</button>
              </div>
            </div>
          ) : (
            <div className="modal-actions">
              <button className="modal-btn modal-btn-secondary" onClick={close}>Hủy</button>
              <button
                className="modal-btn modal-btn-primary"
                disabled={exporting || !outputDir.trim()}
                onClick={() => void handleExport()}
              >
                {exporting ? '⏳ Đang xuất...' : 'Xuất'}
              </button>
            </div>
          )}

          {error && <p style={{ color: '#ef5350', fontSize: 13, marginTop: 12 }}>{error}</p>}
        </div>
      </div>

      {/* Directory browser modal */}
      {browseOpen && (
        <div className="modal-overlay" style={{ zIndex: 1001 }}>
          <div className="modal-box" style={{ width: 480, maxHeight: '80vh', overflow: 'auto' }}>
            <h2>Chọn thư mục</h2>
            <div style={{ marginBottom: 12 }}>
              <button
                className="modal-btn modal-btn-secondary"
                disabled={!browseParent}
                onClick={() => browseParent && navigateTo(browseParent)}
                style={{ marginRight: 8 }}
              >
                ⬆ Lên
              </button>
              <span style={{ fontSize: 12, color: '#ccc', wordBreak: 'break-all' }}>{browsePath}</span>
            </div>
            <div style={{ maxHeight: 400, overflow: 'auto', marginBottom: 12 }}>
              {browseDirs.map((dir) => (
                <div
                  key={dir.path}
                  onClick={() => navigateTo(dir.path)}
                  style={{
                    padding: '8px 10px',
                    cursor: 'pointer',
                    borderRadius: 4,
                    fontSize: 13,
                    color: '#ccc',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                  onMouseEnter={(e) => { (e.target as HTMLElement).style.background = '#0f3460'; }}
                  onMouseLeave={(e) => { (e.target as HTMLElement).style.background = 'transparent'; }}
                >
                  📁 {dir.name}
                </div>
              ))}
              {browseDirs.length === 0 && (
                <p style={{ color: '#888', fontSize: 12, fontStyle: 'italic', padding: 8 }}>Không có thư mục con</p>
              )}
            </div>
            <div className="modal-actions">
              <button className="modal-btn modal-btn-secondary" onClick={() => setBrowseOpen(false)}>Hủy</button>
              <button className="modal-btn modal-btn-primary" onClick={selectDir}>Chọn "{browsePath.split('/').pop()}"</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

import { useRef, useState } from 'react';
import { api } from '../lib/api';
import { exportBatchToDirectory, pickBatchDirectory } from '../lib/batch-files';
import { useBatchStore, type BatchItem } from '../stores/batch';

interface Props {
  busy: boolean;
  canSave: boolean;
  onSave(): void;
  onAdd(files: File[]): void;
  onEdit(item: BatchItem): void;
  onBeforeExport(action: () => Promise<void>): void;
}

export default function BatchPanel({ busy, canSave, onSave, onAdd, onEdit, onBeforeExport }: Props) {
  const batch = useBatchStore();
  const input = useRef<HTMLInputElement>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [format, setFormat] = useState<'jpg' | 'jpeg' | 'png' | 'webp' | 'avif'>('jpeg');
  const [quality, setQuality] = useState(95);
  const [naming, setNaming] = useState<'original' | 'project'>('original');
  const [exporting, setExporting] = useState(false);
  const [exportDirectory, setExportDirectory] = useState<FileSystemDirectoryHandle | null>(null);
  const [progress, setProgress] = useState('');
  const [results, setResults] = useState<{ id: string; name?: string; error?: string }[]>([]);
  const [error, setError] = useState('');
  const exportLock = useRef(false);

  const runExport = async () => {
    if (exportLock.current) return;
    exportLock.current = true;
    setError('');
    try {
      if (!exportDirectory) throw new Error('Hãy chọn thư mục xuất.');
      const directory = exportDirectory;
      setExporting(true);
      setResults([]);
      const items = useBatchStore.getState().items;
      setProgress(`0 / ${items.length}`);
      const output = await exportBatchToDirectory({ directory, items, format, quality, naming,
        onProgress: (completed, total) => setProgress(`${completed} / ${total}`),
      });
      setResults(output);
    } catch (reason) {
      if (!(reason instanceof Error && reason.name === 'AbortError')) {
        setError(reason instanceof Error ? reason.message : 'Không xuất được batch.');
      }
    } finally {
      setExporting(false);
      exportLock.current = false;
    }
  };

  const chooseExportDirectory = () => {
    void Promise.resolve().then(() => pickBatchDirectory()).then(setExportDirectory).catch((reason) => {
      if (reason?.name !== 'AbortError') setError(reason instanceof Error ? reason.message : 'Không chọn được thư mục.');
    });
  };

  return <>
    <div className="batch-actions">
      <button disabled={busy || !canSave || exporting} title={canSave ? 'Lưu project vào thư mục batch' : 'Apply và quay lại màn hình xem trước khi lưu batch'} onClick={onSave}>Lưu vào batch</button>
      <button disabled={busy || exporting} onClick={() => input.current?.click()}>Thêm project cũ</button>
      <button disabled={busy || exporting || !batch.items.length} onClick={() => {
        setError(''); setResults([]); setProgress(''); setExportOpen(true);
      }}>Xuất batch…</button>
    </div>
    <input ref={input} hidden type="file" accept=".360project" multiple onChange={(event) => {
      const files = Array.from(event.target.files ?? []);
      event.target.value = '';
      if (files.length) onAdd(files);
    }} />
    <p className="batch-hint">Danh sách mất khi đóng app; project đã lưu vẫn còn trên ổ đĩa.</p>
    {batch.directory && <p className="batch-dest" title={batch.directory.name}>📁 {batch.directory.name}</p>}
    <div className="batch-items">
      {!batch.items.length && <p className="batch-empty">Chưa có project. Hãy lưu ảnh đang làm hoặc thêm project cũ.</p>}
      {batch.items.map((item) => <article key={item.id} className={`batch-item ${batch.activeId === item.id ? 'active' : ''}`}>
        <img src={api.image.serveUrl(item.project.imagePath, 160)} alt={`Ảnh gốc ${item.originalName}`} loading="lazy" />
        <div className="batch-item-info">
          <strong title={item.projectName}>{item.projectName}</strong>
          <small>{item.width} × {item.height} · {item.project.layers.length} layer(s){batch.activeId === item.id ? ' · Đang mở' : ''}</small>
        </div>
        <div className="batch-item-actions">
          <button disabled={busy || exporting || batch.activeId === item.id} onClick={() => onEdit(item)}>Edit</button>
          <button disabled={busy || exporting} aria-label={`Xóa ${item.projectName} khỏi batch`} title="Chỉ bỏ khỏi danh sách, không xóa file" onClick={() => batch.remove(item.id)}>×</button>
        </div>
      </article>)}
    </div>
    {exportOpen && <div className="modal-overlay"><div className="modal-box batch-export" role="dialog" aria-modal="true" aria-label="Xuất batch">
      <h2>Xuất batch · {batch.items.length} project</h2>
      <div className="modal-row">
        <label id="batch-dest-label">Thư mục</label>
        <button type="button" className="path-picker" aria-labelledby="batch-dest-label" disabled={busy || exporting}
          title={exportDirectory ? `Thư mục xuất: ${exportDirectory.name}` : 'Chọn thư mục xuất'} onClick={chooseExportDirectory}>
          <span className={`path-value${exportDirectory ? '' : ' empty'}`}>{exportDirectory ? exportDirectory.name : 'Chưa chọn thư mục'}</span>
          <span className="path-action">{exportDirectory ? 'Đổi…' : 'Chọn…'}</span>
        </button>
      </div>
      <p className="modal-help">Trình duyệt chỉ cho biết tên thư mục, không hiện đường dẫn đầy đủ.</p>
      <div className="modal-row"><label htmlFor="batch-format">Định dạng</label><select id="batch-format" disabled={exporting || busy} value={format} onChange={(e) => setFormat(e.target.value as typeof format)}>
        {['jpg', 'jpeg', 'png', 'webp', 'avif'].map((f) => <option key={f} value={f}>{f.toUpperCase()}</option>)}
      </select></div>
      <div className="modal-row"><label htmlFor="batch-quality">Chất lượng</label><input id="batch-quality" type="range" min="1" max="100" disabled={exporting || busy} value={quality} onChange={(e) => setQuality(Number(e.target.value))} />
        <span className="field-value">{quality}%</span></div>
      <div className="modal-row"><label htmlFor="batch-naming">Tên ảnh</label><select id="batch-naming" disabled={exporting || busy} value={naming} onChange={(e) => setNaming(e.target.value as typeof naming)}>
        <option value="original">Theo tên ảnh gốc</option><option value="project">Theo tên project</option>
      </select></div>
      <p className="modal-help">Tên trùng sẽ được thêm hậu tố, không ghi đè.</p>
      {progress && <p className="modal-note" role="status">{exporting ? 'Đang xuất' : 'Đã xử lý'} {progress}</p>}
      {!!results.length && <ul className="batch-results">{results.map((result) => <li key={result.id} className={result.error ? 'error' : ''}>{result.error
        ? `${batch.items.find((item) => item.id === result.id)?.projectName ?? result.id}: ${result.error}`
        : `✓ ${result.name}`}</li>)}</ul>}
      {error && <p className="modal-error" role="alert">{error}</p>}
      <div className="modal-actions"><button className="modal-btn modal-btn-secondary" disabled={exporting || busy} onClick={() => setExportOpen(false)}>Đóng</button>
        <button className="modal-btn modal-btn-primary" disabled={exporting || busy || !batch.items.length || !exportDirectory} onClick={() => onBeforeExport(runExport)}>Xuất tất cả</button></div>
    </div></div>}
  </>;
}

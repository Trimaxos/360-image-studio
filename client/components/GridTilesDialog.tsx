import { useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { buildGridPrompt, gridCells, suggestGrids } from '../../shared/grid-tiles';
import { composeGridTiles, copyPngBlob } from '../lib/canvas-exchange';

interface Props {
  sourceUrl: string;
  getSourceBlob: () => Promise<Blob>;
  width: number;
  height: number;
  onConfirm: (base64: string, filled: number, total: number) => Promise<void>;
  onClose: () => void;
}

interface GridTile { blob: Blob; url: string }

export default function GridTilesDialog({ sourceUrl, getSourceBlob, width, height, onConfirm, onClose }: Props) {
  const { grids, defaultIndex } = useMemo(() => suggestGrids(width, height), [width, height]);
  const [gridIndex, setGridIndex] = useState(defaultIndex);
  const grid = grids[gridIndex] as (typeof grids)[number] | undefined;
  const [prompt, setPrompt] = useState(grid ? buildGridPrompt(grid.cols, grid.rows) : '');
  const [tiles, setTiles] = useState<Array<GridTile | null>>([]);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const objectUrls = useRef(new Set<string>());
  // Mirrors `tiles` synchronously so several drops before a re-render all build on the latest array.
  const tilesRef = useRef<Array<GridTile | null>>([]);
  const cells = useMemo(() => (grid ? gridCells(width, height, grid.cols, grid.rows) : []), [grid, width, height]);
  const filled = tiles.filter(Boolean).length;

  const revoke = (url: string) => {
    URL.revokeObjectURL(url);
    objectUrls.current.delete(url);
  };
  useEffect(() => {
    const urls = objectUrls.current;
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const changeGrid = (index: number) => {
    objectUrls.current.forEach(revoke);
    tilesRef.current = [];
    setTiles([]);
    setGridIndex(index);
    setPrompt(buildGridPrompt(grids[index].cols, grids[index].rows));
    setMessage(null);
  };

  const setTile = (index: number, tile: GridTile | null) => {
    const current = tilesRef.current;
    const old = current[index];
    if (old) revoke(old.url);
    const next = cells.map((_, i) => (i === index ? tile : current[i] ?? null));
    tilesRef.current = next;
    setTiles(next);
  };

  const dropOnCell = (event: DragEvent, index: number) => {
    event.preventDefault();
    setOverIndex(null);
    const file = event.dataTransfer.files[0];
    if (!file) {
      setMessage({ text: 'Hãy tải tile về máy rồi kéo file từ thư mục vào ô.', error: true });
      return;
    }
    if (!file.type.startsWith('image/')) {
      setMessage({ text: 'File tile phải là ảnh.', error: true });
      return;
    }
    const url = URL.createObjectURL(file);
    objectUrls.current.add(url);
    setTile(index, { blob: file, url });
    setMessage(null);
  };

  const copyImage = async () => {
    setMessage(null);
    try {
      await copyPngBlob(await getSourceBlob());
      setMessage({ text: 'Đã copy ảnh vào clipboard.', error: false });
    } catch (reason) {
      setMessage({ text: reason instanceof Error ? reason.message : 'Không thể copy ảnh.', error: true });
    }
  };

  const copyPrompt = async () => {
    setMessage(null);
    try {
      await navigator.clipboard.writeText(prompt);
      setMessage({ text: 'Đã copy prompt.', error: false });
    } catch (reason) {
      setMessage({ text: reason instanceof Error ? reason.message : 'Không thể copy prompt.', error: true });
    }
  };

  const confirm = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const base64 = await composeGridTiles(await getSourceBlob(), width, height, cells, cells.map((_, i) => tiles[i]?.blob ?? null));
      await onConfirm(base64, filled, cells.length);
      onClose();
    } catch (reason) {
      setMessage({ text: reason instanceof Error ? reason.message : 'Không thể ghép tile.', error: true });
      setBusy(false);
    }
  };

  // Dropping a file outside a cell must not make the browser navigate to it and lose the project.
  const swallow = (event: DragEvent) => event.preventDefault();

  return <div className="modal-overlay" onDragOver={swallow} onDrop={swallow}>
    <div className="modal-box grid-tiles-dialog" role="dialog" aria-modal="true" aria-label="Tiles">
      <h2>Tiles (nâng cao)</h2>
      {!grid && <p className="modal-note">Khổ ảnh quá dài để chia lưới.</p>}
      {grid && <>
        <div className="modal-row">
          <label htmlFor="grid-tiles-grid">Lưới</label>
          <select id="grid-tiles-grid" disabled={busy} value={gridIndex} onChange={(e) => changeGrid(Number(e.target.value))}>
            {grids.map((item, i) => <option key={i} value={i}>{item.cols}×{item.rows} · {item.cols * item.rows} tile</option>)}
          </select>
        </div>
        <textarea aria-label="Prompt" rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        <div className="modal-actions grid-tiles-copy">
          <button className="modal-btn modal-btn-secondary" disabled={busy} onClick={() => void copyImage()}>Copy ảnh</button>
          <button className="modal-btn modal-btn-secondary" disabled={busy} onClick={() => void copyPrompt()}>Copy prompt</button>
        </div>
        <p className="modal-note">Dán ảnh + prompt vào ChatGPT, tải các tile về máy, rồi kéo từng file vào đúng ô số bên dưới.</p>
        <div className="grid-tiles-board" style={{ aspectRatio: `${width} / ${height}`, width: `min(100%, ${(55 * width / height).toFixed(2)}vh)` }}>
          <img src={sourceUrl} draggable={false} alt="" />
          {cells.map((cell, i) => {
            const tile = tiles[i];
            return <div
              key={i}
              className={`grid-tiles-cell${tile ? ' filled' : ''}${overIndex === i ? ' over' : ''}`}
              style={{ left: `${cell.x / width * 100}%`, top: `${cell.y / height * 100}%`, width: `${cell.w / width * 100}%`, height: `${cell.h / height * 100}%` }}
              onDragOver={(event) => { event.preventDefault(); setOverIndex(i); }}
              onDragLeave={() => setOverIndex(null)}
              onDrop={(event) => dropOnCell(event, i)}
            >
              {tile
                ? <>
                  <img src={tile.url} draggable={false} alt={`Tile ${i + 1}`} />
                  <button className="grid-tiles-remove" aria-label={`Bỏ tile ${i + 1}`} disabled={busy} onClick={() => { setTile(i, null); setMessage(null); }}>✕</button>
                </>
                : <span className="grid-tiles-empty"><b>{i + 1}</b>＋</span>}
            </div>;
          })}
        </div>
      </>}
      {message && (message.error
        ? <p className="modal-error" role="alert">{message.text}</p>
        : <p className="modal-note" role="status">{message.text}</p>)}
      <div className="modal-actions">
        <button className="modal-btn modal-btn-secondary" disabled={busy} onClick={onClose}>Hủy</button>
        <button className="modal-btn modal-btn-primary" disabled={busy || filled === 0} onClick={() => void confirm()}>Xác nhận</button>
      </div>
    </div>
  </div>;
}

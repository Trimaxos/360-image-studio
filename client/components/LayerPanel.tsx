import { useProjectStore } from '../stores/project';

export default function LayerPanel() {
  const state = useProjectStore();
  const sorted = [...state.layers].sort((a, b) => b.order - a.order);
  const editingLayer = ['canvas-edit', 'generating', 'ai-review'].includes(state.workflow);

  return (
    <>
      {!sorted.length ? <p className="layer-empty">Chưa có chỉnh sửa nào</p> : (
        <div className="layer-list">
          {sorted.map((layer) => {
            const active = state.activeLayerId === layer.id;
            const locked = editingLayer && !active;
            const job = state.generations[layer.id];
            const results = layer.variants?.length ?? 0;
            return (
            <div
              key={layer.id}
              className={`layer-item ${active ? 'active' : ''} ${layer.visible === false ? 'hidden-layer' : ''} ${locked ? 'locked' : ''}`}
              aria-disabled={locked}
              title={locked ? 'Hãy lưu và trở về View trước khi sửa layer này' : undefined}
              onClick={() => { if (!locked) useProjectStore.setState({ activeLayerId: layer.id }); }}
            >
              <div className="layer-thumb">{layer.type === 'perspective' ? '360°' : '2D'}</div>
              <div className="layer-info">
                <div className="layer-name">{layer.name ?? `Layer ${layer.order}`}</div>
                <div className="layer-meta">
                  {layer.status ?? 'draft'} · {layer.tileCoords.w}×{layer.tileCoords.h}
                  {results > 0 && ` · ${results} kết quả`}
                  {job && (
                    <span className={`layer-job ${job.status}`} title={job.error}>
                      {job.status === 'queued' ? '⏳ đang chờ lượt' : job.status === 'running' ? '⏳ đang gen' : '⚠ lỗi'}
                    </span>
                  )}
                </div>
              </div>
              <div className="layer-actions">
                <button disabled={locked} className={layer.visible === false ? 'hidden' : 'visible'} onClick={(event) => { event.stopPropagation(); state.toggleLayerVisibility(layer.id); }} title="Ẩn/hiện">👁</button>
                <button disabled={editingLayer} onClick={(event) => { event.stopPropagation(); state.openLayerEditor(layer.id); }} title={editingLayer ? 'Đang chỉnh sửa layer' : 'Edit'}>✎</button>
                <button disabled={locked} onClick={(event) => {
                  event.stopPropagation();
                  if (confirm(`Xóa Layer ${layer.order}?`)) state.removeLayer(layer.id);
                }} title="Xóa">🗑</button>
              </div>
            </div>
          );})}
        </div>
      )}
    </>
  );
}

import React from 'react';
import { useProjectStore } from '../stores/project';

export default function LayerPanel() {
  const state = useProjectStore();
  const sorted = [...state.layers].sort((a, b) => b.order - a.order);
  return (
    <aside className="layer-panel">
      <div className="panel-header">
        Layers <span className="layer-count">{state.layers.length} layer(s)</span>
      </div>
      {!sorted.length ? <p className="layer-empty">Chưa có chỉnh sửa nào</p> : (
        <div className="layer-list">
          {sorted.map((layer) => (
            <div
              key={layer.id}
              className={`layer-item ${state.activeLayerId === layer.id ? 'active' : ''} ${layer.visible === false ? 'hidden-layer' : ''}`}
              onClick={() => useProjectStore.setState({ activeLayerId: layer.id })}
            >
              <div className="layer-thumb">{layer.type === 'perspective' ? '360°' : '2D'}</div>
              <div className="layer-info">
                <div className="layer-name">{layer.name ?? `Layer ${layer.order}`}</div>
                <div className="layer-meta">{layer.status ?? 'draft'} · {layer.tileCoords.w}×{layer.tileCoords.h}</div>
              </div>
              <div className="layer-actions">
                <button className={layer.visible === false ? 'hidden' : 'visible'} onClick={(event) => { event.stopPropagation(); state.toggleLayerVisibility(layer.id); }} title="Ẩn/hiện">👁</button>
                <button onClick={(event) => { event.stopPropagation(); state.openLayerEditor(layer.id); }} title="Edit">✎</button>
                <button onClick={(event) => {
                  event.stopPropagation();
                  if (confirm(`Xóa Layer ${layer.order}?`)) state.removeLayer(layer.id);
                }} title="Xóa">🗑</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}

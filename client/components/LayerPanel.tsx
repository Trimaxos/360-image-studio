import React from 'react';
import { useProjectStore } from '../stores/project';

export default function LayerPanel() {
  const layers = useProjectStore((s) => s.layers);
  const removeLayer = useProjectStore((s) => s.removeLayer);
  const reorderLayer = useProjectStore((s) => s.reorderLayer);
  const toggleLayerVisibility = useProjectStore((s) => s.toggleLayerVisibility);

  if (!layers.length) {
    return (
      <div className="layer-panel">
        <div className="panel-header">
          Layers <span className="layer-count">0</span>
        </div>
        <p className="layer-empty">Chưa có chỉnh sửa nào</p>
      </div>
    );
  }

  const sorted = [...layers].sort((a, b) => b.order - a.order);

  return (
    <div className="layer-panel">
      <div className="panel-header">
        Layers <span className="layer-count">{layers.length}</span>
      </div>
      <div className="layer-list">
        {sorted.map((layer) => (
          <div key={layer.id} className="layer-item">
            <div className="layer-thumb">{layer.type === 'flat' ? '🗺️' : '🔄'}</div>
            <div className="layer-info">
              <div className="layer-name">Edit #{layer.order} — "{layer.prompt.slice(0, 30)}"</div>
              <div className="layer-meta">{layer.type === 'perspective' ? '360° View' : 'Flat View'} • tile {layer.tileCoords.w}×{layer.tileCoords.h}</div>
            </div>
            <div className="layer-actions">
              <button
                className={`layer-eye ${layer.visible !== false ? 'visible' : 'hidden'}`}
                onClick={() => toggleLayerVisibility(layer.id)}
                title={layer.visible !== false ? 'Ẩn layer' : 'Hiện layer'}
              >
                👁️
              </button>
              <button className="layer-delete" onClick={() => removeLayer(layer.id)} title="Xóa layer">
                🗑️
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

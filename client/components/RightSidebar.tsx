import BatchPanel from './BatchPanel';
import LayerPanel from './LayerPanel';
import MarksPanel from './MarksPanel';
import { useBatchStore } from '../stores/batch';
import { useProjectStore } from '../stores/project';

export type RightTab = 'layers' | 'batch' | 'marks';

export default function RightSidebar(props: {
  tab: RightTab;
  onTab(tab: RightTab): void;
  busy: boolean;
  canSave: boolean;
  onSave(): void;
  onSaveAs(): void;
  onAdd(entries: import('../lib/batch-project').ProjectEntry[]): void;
  onEdit(item: import('../stores/batch').BatchItem): void;
  onBeforeExport(action: () => Promise<void>): void;
  onError(message: string): void;
}) {
  const { tab, onTab: select, ...batchProps } = props;
  const layerCount = useProjectStore((state) => state.layers.length);
  const markCount = useProjectStore((state) => state.marks.length);
  const batchCount = useBatchStore((state) => state.items.length);
  const labelledBy = { layers: 'panel-tab-layers', batch: 'panel-tab-batch', marks: 'panel-tab-marks' }[tab];

  return (
    <aside className="layer-panel">
      <div className="panel-tabs" role="tablist" aria-label="Bảng bên phải">
        <button role="tab" id="panel-tab-layers" aria-selected={tab === 'layers'} aria-controls="panel-body"
          className={tab === 'layers' ? 'active' : ''} onClick={() => select('layers')}>
          Layers <span className="layer-count">{layerCount}</span>
        </button>
        <button role="tab" id="panel-tab-marks" aria-selected={tab === 'marks'} aria-controls="panel-body"
          className={tab === 'marks' ? 'active' : ''} onClick={() => select('marks')}>
          Khung cửa <span className="layer-count">{markCount}</span>
        </button>
        <button role="tab" id="panel-tab-batch" aria-selected={tab === 'batch'} aria-controls="panel-body"
          className={tab === 'batch' ? 'active' : ''} onClick={() => select('batch')}>
          Batch <span className="layer-count">{batchCount}</span>
        </button>
      </div>
      <div className="panel-body" id="panel-body" role="tabpanel" aria-labelledby={labelledBy}>
        {tab === 'marks'
          ? <MarksPanel onCreated={() => select('layers')} />
          : tab === 'layers' ? <LayerPanel /> : <BatchPanel {...batchProps} />}
      </div>
    </aside>
  );
}

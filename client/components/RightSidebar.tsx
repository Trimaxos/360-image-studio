import BatchPanel from './BatchPanel';
import LayerPanel from './LayerPanel';
import { useBatchStore } from '../stores/batch';
import { useProjectStore } from '../stores/project';

export type RightTab = 'layers' | 'batch';

export default function RightSidebar(props: {
  tab: RightTab;
  onTab(tab: RightTab): void;
  busy: boolean;
  canSave: boolean;
  onSave(): void;
  onAdd(files: File[]): void;
  onEdit(item: import('../stores/batch').BatchItem): void;
  onBeforeExport(action: () => Promise<void>): void;
}) {
  const { tab, onTab: select, ...batchProps } = props;
  const layerCount = useProjectStore((state) => state.layers.length);
  const batchCount = useBatchStore((state) => state.items.length);

  return (
    <aside className="layer-panel">
      <div className="panel-tabs" role="tablist" aria-label="Bảng bên phải">
        <button role="tab" id="panel-tab-layers" aria-selected={tab === 'layers'} aria-controls="panel-body"
          className={tab === 'layers' ? 'active' : ''} onClick={() => select('layers')}>
          Layers <span className="layer-count">{layerCount}</span>
        </button>
        <button role="tab" id="panel-tab-batch" aria-selected={tab === 'batch'} aria-controls="panel-body"
          className={tab === 'batch' ? 'active' : ''} onClick={() => select('batch')}>
          Batch <span className="layer-count">{batchCount}</span>
        </button>
      </div>
      <div className="panel-body" id="panel-body" role="tabpanel"
        aria-labelledby={tab === 'layers' ? 'panel-tab-layers' : 'panel-tab-batch'}>
        {tab === 'layers' ? <LayerPanel /> : <BatchPanel {...batchProps} />}
      </div>
    </aside>
  );
}

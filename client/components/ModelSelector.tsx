import { useEffect, useState } from 'react';
import type { ModelCatalogResponse } from '../../shared/types';
import { api } from '../lib/api';
import { useProjectStore } from '../stores/project';
import { hasKeyFor, useSettingsStore } from '../stores/settings';

export default function ModelSelector({ disabled }: { disabled: boolean }) {
  const [catalog, setCatalog] = useState<ModelCatalogResponse | null>(null);
  const [error, setError] = useState('');
  const selected = useProjectStore((state) => state.selectedModel);
  const setSelected = useProjectStore((state) => state.setSelectedModel);

  const load = async () => {
    setError('');
    try {
      const [result] = await Promise.all([api.ai.models(), useSettingsStore.getState().load()]);
      setCatalog(result);
      // The first model whose service already has a key, else the first one (Generate then asks for the key).
      const status = useSettingsStore.getState().status;
      const enabled = result.groups.flatMap((group) => group.models).filter((model) => model.enabled);
      const first = enabled.find((model) => hasKeyFor(status, model.provider)) ?? enabled[0];
      if (!useProjectStore.getState().selectedModel && first) setSelected(first);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không tải được model');
    }
  };
  useEffect(() => { void load(); }, []);

  const models = catalog?.groups.flatMap((group) => group.models) ?? [];
  return (
    <div className="model-selector-wrap">
      <select
        aria-label="Model"
        value={selected ? `${selected.provider}:${selected.id}` : ''}
        disabled={disabled || !catalog}
        onChange={(event) => {
          const model = models.find((item) => `${item.provider}:${item.id}` === event.target.value);
          setSelected(model ?? null);
        }}
      >
        {!selected && <option value="">Model</option>}
        {catalog?.groups.map((group) => (
          <optgroup key={group.provider} label={group.label}>
            {group.models.map((model) => (
              <option key={model.id} value={`${model.provider}:${model.id}`} disabled={!model.enabled}>
                {model.description ? `${model.description}: ` : ''}{model.displayName}
                {model.hasMask === false ? ' (no mask)' : ''}
                {model.disabledReason ? ` — ${model.disabledReason}` : ''}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {(error || catalog?.errors?.fal) && (
        <button className="model-retry" onClick={() => void load()} title={error || catalog?.errors?.fal}>Retry</button>
      )}
    </div>
  );
}

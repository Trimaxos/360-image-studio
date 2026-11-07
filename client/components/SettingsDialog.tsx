import { useEffect, useState } from 'react';
import type { AiProviderName, SettingsUpdate } from '../../shared/types';
import { api } from '../lib/api';
import { useSettingsStore } from '../stores/settings';

const keyPlaceholder = (hint: string | null) => (hint ? `Đã lưu (${hint}) — để trống nếu giữ nguyên` : 'Chưa nhập');

/** The services the prompt bar can offer; only the chosen one shows its models there. */
const AI_PROVIDERS: Array<{ value: AiProviderName; label: string }> = [
  { value: 'chatgpt', label: 'ChatGPT trực tiếp (đăng nhập Codex CLI)' },
  { value: 'ninerouter', label: '9router — GPT-6 Astra' },
  { value: 'fal', label: 'fal.ai — tính tiền theo ảnh' },
];

export default function SettingsDialog() {
  const open = useSettingsStore((s) => s.open);
  const status = useSettingsStore((s) => s.status);
  const [aiProvider, setAiProvider] = useState<AiProviderName>('chatgpt');
  const [url, setUrl] = useState('');
  const [ninerouterKey, setNinerouterKey] = useState('');
  const [falAiKey, setFalAiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setAiProvider(status?.aiProvider ?? 'chatgpt');
    setUrl(status?.ninerouterBaseUrl ?? '');
    setNinerouterKey('');
    setFalAiKey('');
    setSaving(false);
    setError('');
    void useSettingsStore.getState().load();
  }, [open]);

  // The URL and the chosen service arrive with the status when the dialog was opened before it was loaded.
  useEffect(() => {
    if (open && !url && status) {
      setUrl(status.ninerouterBaseUrl);
      setAiProvider(status.aiProvider);
    }
  }, [status]);

  if (!open) return null;
  const close = () => useSettingsStore.getState().setOpen(false);

  const save = async () => {
    const update: SettingsUpdate = {};
    if (aiProvider !== status?.aiProvider) update.aiProvider = aiProvider;
    if (url.trim() !== status?.ninerouterBaseUrl) update.ninerouterBaseUrl = url.trim();
    if (ninerouterKey.trim()) update.ninerouterKey = ninerouterKey.trim();
    if (falAiKey.trim()) update.falAiKey = falAiKey.trim();
    setSaving(true);
    setError('');
    try {
      useSettingsStore.getState().setStatus(await api.settings.save(update));
      close();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không lưu được Settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay">
      <form className="modal-box settings-dialog" role="dialog" aria-modal="true" aria-label="Settings"
        onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <h2>Settings</h2>
        <p className="modal-note">Lưu trên máy đang chạy ứng dụng — mở lại hay cập nhật bản mới không cần nhập lại.</p>
        <fieldset className="settings-providers">
          <legend>Model AI hiện ở ô chọn model</legend>
          {AI_PROVIDERS.map((provider) => (
            <label key={provider.value}>
              <input type="radio" name="ai-provider" value={provider.value} checked={aiProvider === provider.value}
                onChange={() => setAiProvider(provider.value)} />
              {provider.label}
            </label>
          ))}
        </fieldset>
        <h3 className="settings-section">ChatGPT trực tiếp</h3>
        <p className="modal-note">
          {status?.chatgptSignedIn
            ? 'Đã đăng nhập Codex CLI trên máy này.'
            : 'Chưa đăng nhập Codex CLI: cài Codex CLI rồi chạy codex login trên máy này.'}
        </p>
        <h3 className="settings-section">9router</h3>
        <div className="modal-row">
          <label htmlFor="settings-url">URL 9router</label>
          <input id="settings-url" aria-label="URL 9router" value={url} spellCheck={false}
            placeholder="http://localhost:20128/v1" onChange={(e) => setUrl(e.target.value)} />
        </div>
        <div className="modal-row">
          <label htmlFor="settings-ninerouter-key">API key 9router</label>
          <input id="settings-ninerouter-key" aria-label="API key 9router" type="password" autoComplete="off"
            value={ninerouterKey} placeholder={keyPlaceholder(status?.ninerouterKey ?? null)}
            onChange={(e) => setNinerouterKey(e.target.value)} />
        </div>
        <h3 className="settings-section">fal.ai</h3>
        <div className="modal-row">
          <label htmlFor="settings-fal-key">Key fal.ai</label>
          <input id="settings-fal-key" aria-label="Key fal.ai" type="password" autoComplete="off"
            value={falAiKey} placeholder={keyPlaceholder(status?.falAiKey ?? null)}
            onChange={(e) => setFalAiKey(e.target.value)} />
        </div>
        <div className="modal-actions">
          <button type="button" className="modal-btn modal-btn-secondary" onClick={close}>Hủy</button>
          <button type="submit" className="modal-btn modal-btn-primary" disabled={saving}>
            {saving ? 'Đang lưu…' : 'Lưu'}
          </button>
        </div>
        {error && <p className="modal-error" role="alert">{error}</p>}
      </form>
    </div>
  );
}

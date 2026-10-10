import { useEffect, useRef, useState } from 'react';
import { startGeneration } from '../lib/generation';
import { blobToBase64 } from '../lib/mask-utils';
import { permissionsFor } from '../stores/workflow';
import { useProjectStore } from '../stores/project';
import ModelSelector from './ModelSelector';

const MAX_REFERENCE_IMAGES = 3;
const MAX_REFERENCE_BYTES = 10 * 1024 * 1024;
const REFERENCE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

interface ReferenceImage {
  id: string;
  name: string;
  base64Data: string;
  mimeType: typeof REFERENCE_MIME_TYPES[number];
}

export default function PromptBar() {
  const state = useProjectStore();
  const permission = permissionsFor(state.workflow);
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState('');
  const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([]);
  const referenceInputRef = useRef<HTMLInputElement>(null);
  // The generation belongs to the open layer: other layers' generations (running in the background) do not block this one.
  const job = state.activeLayerId ? state.generations[state.activeLayerId] : undefined;
  const waiting = job?.status === 'queued';
  const generating = waiting || job?.status === 'running';
  const failure = job?.status === 'failed' ? job.error ?? 'Generate thất bại' : '';
  const supportsReferenceImages = !!state.selectedModel?.supportsReferenceImages;

  useEffect(() => {
    setPrompt(state.selectionDraft?.prompt ?? '');
  }, [state.activeLayerId]);

  useEffect(() => {
    if (!supportsReferenceImages) setReferenceImages([]);
  }, [supportsReferenceImages]);

  const addReferenceImages = async (files: FileList | null) => {
    if (!files || !supportsReferenceImages) return;
    setError('');
    const availableSlots = MAX_REFERENCE_IMAGES - referenceImages.length;
    const selectedFiles = Array.from(files).slice(0, availableSlots);
    const invalidType = selectedFiles.find((file) => !REFERENCE_MIME_TYPES.includes(file.type as any));
    if (invalidType) {
      setError('Ảnh tham chiếu chỉ hỗ trợ JPG, PNG hoặc WebP.');
      return;
    }
    const oversized = selectedFiles.find((file) => file.size > MAX_REFERENCE_BYTES);
    if (oversized) {
      setError(`Ảnh tham chiếu "${oversized.name}" vượt quá 10 MB.`);
      return;
    }
    const additions = await Promise.all(selectedFiles.map(async (file): Promise<ReferenceImage> => ({
      id: crypto.randomUUID(),
      name: file.name,
      base64Data: await blobToBase64(file),
      mimeType: file.type as ReferenceImage['mimeType'],
    })));
    setReferenceImages((current) => [...current, ...additions].slice(0, MAX_REFERENCE_IMAGES));
  };

  const generate = () => {
    const model = state.selectedModel;
    const layerId = state.activeLayerId;
    if (!layerId || !model || !prompt.trim()) return;
    setError('');
    startGeneration({
      layerId,
      prompt: prompt.trim(),
      model,
      referenceImages: supportsReferenceImages
        ? referenceImages.map(({ base64Data, mimeType }) => ({ base64Data, mimeType }))
        : [],
    });
  };

  return (
    <div className="prompt-bar">
      <ModelSelector disabled={state.workflow === 'generating'} />
      <div className={`reference-upload ${supportsReferenceImages ? 'enabled' : 'disabled'}`}>
        <input
          ref={referenceInputRef}
          className="reference-file-input"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          disabled={!permission.ai || generating || !supportsReferenceImages}
          onChange={(event) => {
            void addReferenceImages(event.target.files);
            event.target.value = '';
          }}
        />
        <button
          type="button"
          className="reference-upload-btn"
          disabled={!permission.ai || generating || !supportsReferenceImages || referenceImages.length >= MAX_REFERENCE_IMAGES}
          title={supportsReferenceImages
            ? 'Upload tối đa 3 ảnh JPG, PNG hoặc WebP để model dùng làm tham chiếu'
            : 'Model này không hỗ trợ nhiều ảnh đầu vào'}
          onClick={() => referenceInputRef.current?.click()}
        >
          + Ảnh tham chiếu{referenceImages.length ? ` (${referenceImages.length}/${MAX_REFERENCE_IMAGES})` : ''}
        </button>
        {referenceImages.length > 0 && (
          <div className="reference-image-list" aria-label="Ảnh tham chiếu đã chọn">
            {referenceImages.map((image, index) => (
              <div className="reference-image-chip" key={image.id} title={`Ảnh ${index + 2}: ${image.name}`}>
                <img src={`data:${image.mimeType};base64,${image.base64Data}`} alt={`Tham chiếu ${index + 1}`} />
                <button
                  type="button"
                  aria-label={`Xóa ảnh tham chiếu ${image.name}`}
                  disabled={generating}
                  onClick={() => setReferenceImages((current) => current.filter((item) => item.id !== image.id))}
                >×</button>
              </div>
            ))}
          </div>
        )}
      </div>
      <input
        value={prompt}
        onChange={(event) => {
          const value = event.target.value;
          setPrompt(value);
          if (state.selectionDraft) {
            state.setSelectionDraft({ ...state.selectionDraft, prompt: value });
          } else {
            state.markDirty();
          }
        }}
        placeholder="Nhập prompt..."
        disabled={!permission.ai || generating}
        onKeyDown={(event) => { if (event.key === 'Enter') void generate(); }}
      />
      <button
        className="prompt-btn prompt-btn-generate"
        disabled={!permission.ai || generating || !prompt.trim() || !state.selectedModel}
        onClick={() => void generate()}
      >
        {waiting ? 'Đang chờ lượt…' : generating ? 'Generating…' : 'Generate'}
      </button>
      {(error || failure) && <span className="prompt-error" title={error || failure}>⚠ {error || failure}</span>}
    </div>
  );
}

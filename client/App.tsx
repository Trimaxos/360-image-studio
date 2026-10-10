import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import BatchSaveConfirm from './components/BatchSaveConfirm';
import ConfirmDialog from './components/ConfirmDialog';
import RightSidebar, { type RightTab } from './components/RightSidebar';
import { useBatchStore } from './stores/batch';
import { addBatchProjects, restoreBatchItem, saveCurrentToBatch } from './lib/batch-project';
import { canPickProjectFiles, pickProjectFiles } from './lib/batch-files';
import { browserSaveDeps, downloadProject, saveProject, saveProjectToFolder, type SaveMode } from './lib/project-save';
import { isAutoMode } from './lib/auto-mode';
import FileMenu, { saveShortcut } from './components/FileMenu';
import CanvasEditor from './components/CanvasEditor';
import ErrorBoundary from './components/ErrorBoundary';
import ExportDialog from './components/ExportDialog';
import ImageDropZone from './components/ImageDropZone';
import PromptBar from './components/PromptBar';
import Toolbar from './components/Toolbar';
import { api } from './lib/api';
import { hasGenerationInFlight } from './lib/generation';
import { resolveImageMode } from './lib/image-mode';
import { useProjectStore } from './stores/project';
import FlatView from './views/FlatView';
import Viewer360 from './views/Viewer360';

function formatFileSize(bytes?: number) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function App() {
  const state = useProjectStore();
  const [activeTab, setActiveTab] = useState<'360' | 'flat'>('360');
  const [exportOpen, setExportOpen] = useState(false);
  const [isSavingProject, setIsSavingProject] = useState(false);
  const [isLoadingProject, setIsLoadingProject] = useState(false);
  const [loadingProjectName, setLoadingProjectName] = useState('');
  const [fileSize, setFileSize] = useState<number>();
  const saveInFlight = useRef(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const batchLock = useRef(false);
  const [pendingAction, setPendingAction] = useState<(() => Promise<void>) | null>(null);
  const [batchError, setBatchError] = useState('');
  const [rightTab, setRightTab] = useState<RightTab>('layers');
  const [saveHint, setSaveHint] = useState('');
  const batch = useBatchStore();
  const imageInput = useRef<HTMLInputElement>(null);
  const projectInput = useRef<HTMLInputElement>(null);
  const fileName = state.imagePath ? (batch.originalName || state.imagePath.split('/').pop()?.split('\\').pop()) : undefined;
  const committed = state.layers.some((layer) => layer.status === 'committed');
  /** Saving needs the viewing screen: canvas work that was not applied yet is not part of the project. */
  const canSave = !!state.imagePath && state.workflow === 'viewing';

  useEffect(() => {
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!useProjectStore.getState().hasUnsavedChanges) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, []);

  const openFile = useCallback(async (file: File) => {
    const meta = await api.image.upload(file);
    useProjectStore.getState().reset();
    useProjectStore.getState().openImage(meta.path, meta.width, meta.height);
    useBatchStore.getState().setCurrent(null, file.name);
    useBatchStore.getState().setCurrentFile(null);
    setFileSize(file.size);
  }, []);

  // The real browser, with the "which folder?" hint shown only while that picker is open. Native confirm dialogs are not
  // used for the save questions: automation (the review browser) dismisses them on its own, which would cancel the save.
  const saveDeps = useMemo(() => browserSaveDeps({ folderPrompt: (message) => setSaveHint(message ?? '') }), []);

  /** Save (write back to the project's file) or Save As (pick a new one). */
  const runSave = useCallback(async (mode: SaveMode) => {
    // Never overlap a save with opening another project or with another save.
    if (saveInFlight.current || batchLock.current) return;
    if (!useProjectStore.getState().imagePath) return;
    saveInFlight.current = true;
    setIsSavingProject(true);
    try {
      await saveProject(mode, { deps: saveDeps });
    } catch (err: any) {
      if (err?.name !== 'AbortError') setBatchError(`Không lưu được: ${err.message}`);
    } finally {
      saveInFlight.current = false;
      setIsSavingProject(false);
    }
  }, [saveDeps]);

  /** File → Download Project: always a browser download (the automation and browsers without file access use it). */
  const downloadProjectFile = useCallback(async () => {
    if (saveInFlight.current || batchLock.current) return;
    if (!useProjectStore.getState().imagePath) return;
    saveInFlight.current = true;
    setIsSavingProject(true);
    try {
      await downloadProject({ deps: saveDeps });
    } catch (err: any) {
      alert(`Save failed: ${err.message}`);    } finally {
      saveInFlight.current = false;
      setIsSavingProject(false);
    }
  }, [saveDeps]);

  /** File → Auto (?auto=1): the server saves into assets/output/projects without a dialog; the hint shows where it went. */
  const autoSaveProject = useCallback(async () => {
    if (saveInFlight.current || batchLock.current) return;
    if (!useProjectStore.getState().imagePath) return;
    saveInFlight.current = true;
    setIsSavingProject(true);
    try {
      const saved = await saveProjectToFolder();
      const hint = `Đã lưu: ${saved.path}`;
      setSaveHint(hint);
      setTimeout(() => setSaveHint((current) => (current === hint ? '' : current)), 8000);
    } catch (err: any) {
      setBatchError(`Không lưu được: ${err.message}`);
    } finally {
      saveInFlight.current = false;
      setIsSavingProject(false);
    }
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mode = saveShortcut(event);
      if (!mode) return;
      event.preventDefault();
      if (useProjectStore.getState().imagePath) void runSave(mode);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [runSave]);

  const loadProject = useCallback(async (file: File, handle?: FileSystemFileHandle) => {
    setIsLoadingProject(true);
    setLoadingProjectName(file.name);
    try {
      const { project } = await api.project.uploadZip(file);
      const meta = await api.image.open(project.imagePath);
      useProjectStore.getState().reset();
      useProjectStore.getState().openImage(project.imagePath, meta.width, meta.height);
      useBatchStore.getState().setCurrent(null, project.originalName || file.name.replace(/\.360project$/i, ''));
      useProjectStore.setState({
        imageMode: resolveImageMode(project.mode, useProjectStore.getState().imageMode),
        layers: project.layers ?? [],
        horizon: project.horizon ?? { yaw: 0, pitch: 0, roll: 0 },
        hasUnsavedChanges: false,
      });
      useBatchStore.getState().setCurrentFile({ handle, name: file.name, size: file.size, lastModified: file.lastModified });
      setFileSize(meta.sizeBytes);
    } catch (err: any) {
      alert(`Load failed: ${err.message}`);
    } finally {
      setIsLoadingProject(false);
      setLoadingProjectName('');
    }
  }, []);

  const runBatchTask = async (action: () => Promise<void>) => {
    if (batchLock.current || saveInFlight.current) return;
    batchLock.current = true;
    setBatchBusy(true);
    setBatchError('');
    try { await action(); }
    catch (reason) {
      if (!(reason instanceof Error && reason.name === 'AbortError')) {
        setBatchError(reason instanceof Error ? reason.message : 'Thao tác batch thất bại.');
      }
    } finally { batchLock.current = false; setBatchBusy(false); }
  };
  const confirmCurrent = (action: () => Promise<void>) => {
    if (batchLock.current || saveInFlight.current || isLoadingProject) return;
    // A generation still queued or running belongs to this project: its result would have nowhere to land after the switch.
    if (useProjectStore.getState().workflow === 'generating' || hasGenerationInFlight(useProjectStore.getState().generations)) {
      setBatchError('Hãy chờ AI xử lý xong trước khi chuyển project.');
      return;
    }
    if (useProjectStore.getState().hasUnsavedChanges) setPendingAction(() => action);
    else void runBatchTask(action);
  };
  const resolvePending = (save: boolean) => {
    const action = pendingAction;
    if (!action) return;
    void runBatchTask(async () => {
      if (save) {
        await saveCurrentToBatch('save', saveDeps);
        if (useProjectStore.getState().hasUnsavedChanges) throw new Error('Project đã thay đổi trong khi lưu. Hãy lưu lại trước khi chuyển.');
      }
      setPendingAction(null);
      await action();
    });
  };

  /** File → Load Project: open with a handle when the browser can (Save then writes back), else the file input. */
  const openProjectPicker = () => {
    if (!canPickProjectFiles()) { projectInput.current?.click(); return; }
    void pickProjectFiles(false).then((picked) => {
      if (picked?.length) confirmCurrent(() => loadProject(picked[0].file, picked[0].handle));
    }).catch((reason) => {
      if (reason?.name !== 'AbortError') setBatchError(reason instanceof Error ? reason.message : 'Không mở được project.');
    });
  };

  const canvasWorkflow = ['canvas-edit', 'generating', 'ai-review'].includes(state.workflow);
  const isFlatImage = state.imageMode === 'flat';
  const modeLabel = isFlatImage ? 'Ảnh thường' : '360°';
  const switchImageMode = () => {
    const current = useProjectStore.getState();
    const next = current.imageMode === '360' ? 'flat' : '360';
    const label = next === 'flat' ? 'Ảnh thường' : '360°';
    if (current.layers.length > 0 && !confirm(`Đổi sang chế độ ${label}? Các layer hiện có có thể hiển thị sai.`)) return;
    current.setImageMode(next);
  };
  return (
    <div className="app-shell">
      <input ref={imageInput} hidden type="file" accept="image/*" onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) confirmCurrent(() => openFile(file));
        event.target.value = '';
      }} />
      <input ref={projectInput} hidden type="file" accept=".360project" onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) confirmCurrent(() => loadProject(file));
        event.target.value = '';
      }} />

      <header className="top-bar">
        <span className="top-bar-logo"><strong>360</strong><span>ImageStudio</span></span>
        <nav className="top-bar-tabs">
          {isFlatImage ? (
            <button className="top-bar-tab active" disabled>🖼 Ảnh thường</button>
          ) : (
            <>
              <button className={`top-bar-tab ${activeTab === '360' ? 'active' : ''}`} disabled={state.workflow !== 'viewing'} onClick={() => setActiveTab('360')}>🌐 360 View</button>
              <button className={`top-bar-tab ${activeTab === 'flat' ? 'active' : ''}`} disabled={state.workflow !== 'viewing'} onClick={() => setActiveTab('flat')}>📐 Flat View</button>
            </>
          )}
          <button
            className="top-bar-tab"
            disabled={state.workflow !== 'viewing'}
            title="Chuyển đổi chế độ ảnh 360 / ảnh thường"
            onClick={switchImageMode}
          >
            ⇄ Chế độ: {modeLabel}
          </button>
        </nav>
        <FileMenu hasImage={!!state.imagePath} canSave={canSave} canExport={committed} isSaving={isSavingProject} isLoading={isLoadingProject}
          onOpenImage={() => imageInput.current?.click()}
          onLoadProject={openProjectPicker}
          onSave={() => void runSave('save')}
          onSaveAs={() => void runSave('saveAs')}
          onAutoSave={isAutoMode() ? () => void autoSaveProject() : undefined}
          onDownload={() => void downloadProjectFile()}
          onExport={() => setExportOpen(true)}
          onNew={() => confirmCurrent(async () => { state.reset(); batch.setCurrent(null, ''); batch.setCurrentFile(null); })} />
        {fileName && <span className="top-bar-file"><strong>{fileName}</strong> · {state.imageWidth} × {state.imageHeight} {fileSize ? `· ${formatFileSize(fileSize)}` : ''}</span>}
        <button className="export-final-btn" disabled={!state.imagePath || !committed} onClick={() => setExportOpen(true)}>Export Final</button>
      </header>

      <ErrorBoundary>
        <main className="workspace">
          <Toolbar onExport={() => setExportOpen(true)} onSave={() => void runSave('save')} isSaving={isSavingProject} />
          <section className="editor-area">
            {state.workflow === 'empty'
              ? <ImageDropZone onOpenFile={openFile} />
              : canvasWorkflow
                ? <CanvasEditor />
                : isFlatImage ? <FlatView /> : activeTab === '360' ? <Viewer360 /> : <FlatView />}
          </section>
          <RightSidebar tab={rightTab} onTab={setRightTab}
            busy={batchBusy || isSavingProject || isLoadingProject || state.workflow === 'generating'}
            canSave={canSave}
            onSave={() => { setRightTab('batch'); void runBatchTask(() => saveCurrentToBatch('save', saveDeps)); }}
            onSaveAs={() => { setRightTab('batch'); void runBatchTask(() => saveCurrentToBatch('saveAs', saveDeps)); }}
            onAdd={(entries) => void runBatchTask(async () => {
              const errors = await addBatchProjects(entries);
              if (errors.length) setBatchError(errors.join('\n'));
            })}
            onEdit={(item) => confirmCurrent(async () => { restoreBatchItem(item); setFileSize(undefined); })}
            onBeforeExport={(action) => {
              if (batch.activeId && state.hasUnsavedChanges) confirmCurrent(action);
              else void runBatchTask(action);
            }}
            onError={setBatchError} />
        </main>
        <PromptBar />
      </ErrorBoundary>
      {batchError && <div className="batch-error" role="alert">{batchError}<button onClick={() => setBatchError('')}>Đóng</button></div>}
      {pendingAction && <BatchSaveConfirm busy={batchBusy || isSavingProject} canSave={canSave}
        onCancel={() => setPendingAction(null)} onContinue={resolvePending} />}
      {batchBusy && <div className="batch-working" role="status"><span className="inline-spinner" /> Đang xử lý batch…</div>}
      {saveHint && <div className="save-hint" role="status">{saveHint}</div>}
      <ConfirmDialog />
      <footer className="status-bar">
        <span>{fileName ? `${fileName} — ${state.layers.length} layer(s)` : 'Chưa mở ảnh'}</span>
        <span>{isFlatImage ? '🖼' : '🌐'} {modeLabel} · {state.workflow}</span>
      </footer>
      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} />
      {isSavingProject && (
        <div className="project-save-progress" role="status" aria-live="polite">
          <span className="inline-spinner" />
          <span><strong>Đang chuẩn bị project…</strong><small>Đang đóng gói ảnh và dữ liệu, vui lòng chờ.</small></span>
        </div>
      )}
      {isLoadingProject && (
        <div className="project-load-overlay" role="status" aria-live="assertive" aria-busy="true">
          <div className="project-load-dialog">
            <span className="inline-spinner" />
            <div>
              <strong>Đang tải project…</strong>
              <small>{loadingProjectName || 'Đang tải lên và giải nén dữ liệu, vui lòng chờ.'}</small>
              <small>Project lớn có thể cần vài phút để xử lý.</small>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { useRef } from 'react';
import type { SaveMode } from '../lib/project-save';

/** Ctrl/Cmd+S → save, Ctrl/Cmd+Shift+S → save as, anything else → null. */
export function saveShortcut(event: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): SaveMode | null {
  if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return null;
  return event.shiftKey ? 'saveAs' : 'save';
}

const WAIT_TO_SAVE = 'Apply và quay lại màn hình xem trước khi lưu';

interface Props {
  hasImage: boolean;
  /** Save and Save As need the viewing screen: canvas work that was not applied yet is not part of the project. */
  canSave: boolean;
  canExport: boolean;
  isSaving: boolean;
  isLoading: boolean;
  onOpenImage(): void;
  onLoadProject(): void;
  onSave(): void;
  onSaveAs(): void;
  /** Auto mode only (?auto=1): the server saves into assets/output/projects without a file dialog. */
  onAutoSave?(): void;
  onDownload(): void;
  onExport(): void;
  onNew(): void;
}

export default function FileMenu(props: Props) {
  const menu = useRef<HTMLDetailsElement>(null);
  const run = (action: () => void) => () => {
    if (menu.current) menu.current.open = false;
    action();
  };
  return (
    <details className="file-menu" ref={menu}>
      <summary>☰ File</summary>
      <div className="file-menu-popover">
        <button onClick={run(props.onOpenImage)}>📂 Open Image</button>
        <button disabled={props.isLoading} onClick={run(props.onLoadProject)}>📋 Load Project</button>
        <button disabled={!props.hasImage || !props.canSave || props.isSaving} title={props.canSave ? 'Ghi đè file project đang mở (Ctrl+S)' : WAIT_TO_SAVE} onClick={run(props.onSave)}>💾 Save Project</button>
        <button disabled={!props.hasImage || !props.canSave || props.isSaving} title={props.canSave ? 'Lưu thành file mới (Ctrl+Shift+S)' : WAIT_TO_SAVE} onClick={run(props.onSaveAs)}>📝 Save Project As…</button>
        {props.onAutoSave && (
          <button disabled={!props.hasImage || !props.canSave || props.isSaving} title={props.canSave ? 'Server lưu thẳng vào assets/output/projects, không mở hộp thoại' : WAIT_TO_SAVE} onClick={run(props.onAutoSave)}>
            🤖 Auto: lưu vào assets/output/projects
          </button>
        )}
        <button disabled={!props.hasImage || props.isSaving} title="Tải file project về máy" onClick={run(props.onDownload)}>
          ⬇ Download Project
        </button>
        <button disabled={!props.hasImage || !props.canExport} onClick={run(props.onExport)}>📤 Export Final</button>
        <button disabled={!props.hasImage} onClick={run(props.onNew)}>↻ New</button>
      </div>
    </details>
  );
}

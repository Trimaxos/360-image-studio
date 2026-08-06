
export default function UnsavedChangesDialog(props: {
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
  saving?: boolean;
}) {
  const saving = props.saving ?? false;
  return (
    <div className="modal-overlay">
      <div className="confirm-dialog">
        <h3>Lưu trạng thái chỉnh sửa?</h3>
        <p>Vùng chọn, mask và prompt đã thay đổi. Các phiên bản AI chưa Apply sẽ được dọn khi quay lại view.</p>
        <div className="dialog-actions">
          <button disabled={saving} onClick={props.onCancel}>Cancel</button>
          <button disabled={saving} onClick={props.onDiscard}>Don&apos;t Save</button>
          <button className="primary" disabled={saving} onClick={props.onSave}>
            {saving ? <><span className="inline-spinner" /> Đang lưu…</> : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

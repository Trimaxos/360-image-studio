
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
          <button disabled={saving} onClick={props.onCancel}>Hủy</button>
          <button disabled={saving} onClick={props.onDiscard}>Không lưu</button>
          <button className="primary" disabled={saving} onClick={props.onSave}>
            {saving ? <><span className="inline-spinner" /> Đang lưu…</> : 'Lưu'}
          </button>
        </div>
      </div>
    </div>
  );
}

interface Props {
  busy: boolean;
  canSave: boolean;
  onCancel(): void;
  onContinue(save: boolean): void;
}

export default function BatchSaveConfirm({ busy, canSave, onCancel, onContinue }: Props) {
  return <div className="modal-overlay batch-confirm"><div className="modal-box" role="dialog" aria-modal="true" aria-label="Lưu project hiện tại?">
    <h2>Lưu project hiện tại?</h2><p>Project đang mở có thay đổi chưa lưu. Bạn muốn lưu vào batch trước khi tiếp tục không?</p>
    {!canSave && <p>Để lưu, hãy Hủy hộp thoại này, Apply và quay lại màn hình xem trước.</p>}
    <div className="modal-actions">
      <button className="modal-btn modal-btn-secondary" disabled={busy} onClick={onCancel}>Hủy</button>
      <button className="modal-btn modal-btn-secondary" disabled={busy} onClick={() => onContinue(false)}>Không lưu và tiếp tục</button>
      <button className="modal-btn modal-btn-primary" disabled={busy || !canSave} onClick={() => onContinue(true)}>Lưu rồi tiếp tục</button>
    </div>
  </div></div>;
}

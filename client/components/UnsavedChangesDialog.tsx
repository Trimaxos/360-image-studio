import React from 'react';

export default function UnsavedChangesDialog(props: {
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="modal-overlay">
      <div className="confirm-dialog">
        <h3>Lưu trạng thái chỉnh sửa?</h3>
        <p>Vùng chọn, mask và prompt đã thay đổi. Các phiên bản AI chưa Apply sẽ được dọn khi quay lại view.</p>
        <div className="dialog-actions">
          <button onClick={props.onCancel}>Cancel</button>
          <button onClick={props.onDiscard}>Don&apos;t Save</button>
          <button className="primary" onClick={props.onSave}>Save</button>
        </div>
      </div>
    </div>
  );
}

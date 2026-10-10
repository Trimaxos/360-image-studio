import { useConfirmStore } from '../lib/confirm-dialog';

export default function ConfirmDialog() {
  const request = useConfirmStore((state) => state.request);
  const answer = useConfirmStore((state) => state.answer);
  if (!request) return null;
  return <div className="modal-overlay batch-confirm"><div className="modal-box" role="dialog" aria-modal="true" aria-label="Xác nhận">
    <p>{request.message}</p>
    <div className="modal-actions">
      <button className="modal-btn modal-btn-secondary" onClick={() => answer(false)}>Không</button>
      <button className="modal-btn modal-btn-primary" autoFocus onClick={() => answer(true)}>Đồng ý</button>
    </div>
  </div></div>;
}

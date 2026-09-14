import { Component, ReactNode } from 'react';

interface Props { children: ReactNode }
interface State { error: Error | null }

// Render errors (including the zustand v5 unstable-selector loop that used to
// blank the whole app) would otherwise unmount the entire React tree, losing
// the in-memory project. This keeps the top bar — and its File menu — alive so
// the user can still save the project before reloading.
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error('[ErrorBoundary]', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="error-boundary-fallback" role="alert">
        <h2>⚠ Có lỗi hiển thị xảy ra</h2>
        <p>
          Project hiện tại vẫn còn trong bộ nhớ trình duyệt. Hãy bấm
          {' '}<strong>☰ File → Download Project</strong>{' '}
          ở thanh trên để lưu lại trước khi thao tác tiếp.
        </p>
        <p className="error-boundary-detail">{this.state.error.message}</p>
        <div className="error-boundary-actions">
          <button onClick={() => this.setState({ error: null })}>Thử lại</button>
          <button onClick={() => window.location.reload()}>Tải lại trang</button>
        </div>
      </div>
    );
  }
}

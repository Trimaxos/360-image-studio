import { createContext, FormEvent, ReactNode, useContext, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

const AuthContext = createContext({ logout: async () => {} });

export function useAuth() {
  return useContext(AuthContext);
}

export default function LoginGate({ children }: { children: ReactNode }) {
  const [authenticated, setAuthenticated] = useState(false);
  const [checking, setChecking] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const usernameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.auth.status()
      .then((result) => setAuthenticated(result.authenticated))
      .catch(() => setAuthenticated(false))
      .finally(() => setChecking(false));
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setError('');
    try {
      await api.auth.login(String(form.get('username') || ''), String(form.get('password') || ''));
      setAuthenticated(true);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'Không thể đăng nhập.');
      usernameRef.current?.focus();
    } finally {
      setSubmitting(false);
    }
  }

  async function logout() {
    try {
      await api.auth.logout();
    } finally {
      setAuthenticated(false);
      setError('');
    }
  }

  if (checking) {
    return <div className="login-loading"><span className="inline-spinner" /> Đang kiểm tra đăng nhập…</div>;
  }

  return (
    <>
      {authenticated && <AuthContext.Provider value={{ logout }}>{children}</AuthContext.Provider>}
      {!authenticated && (
        <div className="login-screen">
          <form className="login-dialog" onSubmit={handleSubmit}>
            <div className="login-brand"><strong>360</strong><span>ImageStudio</span></div>
            <h1>Đăng nhập</h1>
            <p>Nhập tài khoản để sử dụng trình chỉnh sửa ảnh.</p>
            <label>
              Tài khoản
              <input ref={usernameRef} name="username" type="text" autoComplete="username" autoFocus required />
            </label>
            <label>
              Mật khẩu
              <input name="password" type="password" autoComplete="current-password" required />
            </label>
            {error && <div className="login-error" role="alert">{error}</div>}
            <button type="submit" disabled={submitting}>
              {submitting ? 'Đang đăng nhập…' : 'Đăng nhập'}
            </button>
          </form>
        </div>
      )}
    </>
  );
}

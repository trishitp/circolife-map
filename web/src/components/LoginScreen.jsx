import { useEffect, useState } from 'react';
import { fetchAuthStatus, login } from '../lib/api';

export default function LoginScreen({ error: initialError, onSuccess }) {
  const [error, setError] = useState(initialError || null);
  const [zoho, setZoho] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchAuthStatus()
      .then((s) => setZoho(Boolean(s.zohoLogin)))
      .catch((e) => setError(e.message));
  }, []);

  const submitPassword = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const data = await login({ email, password });
      onSuccess?.(data.user || null);
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-brand">
          circo<span>life</span>
          <small>maps</small>
        </div>
        <h1>Sign in</h1>
        <p className="login-copy">
          {zoho
            ? 'Use your Circolife Zoho account. Admin tools are only shown to admins.'
            : 'Use the email and password from Admin → Users.'}
        </p>
        {error && <div className="banner err">{error}</div>}
        {zoho ? (
          <a className="btn login-btn" href="/api/auth/zoho/start">
            Sign in with Zoho
          </a>
        ) : zoho === false ? (
          <form onSubmit={submitPassword}>
            <label className="login-label">
              Email
              <input
                className="input"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <label className="login-label">
              Password
              <input
                className="input"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
            <button className="btn login-btn" type="submit" disabled={loading}>
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        ) : null}
      </div>
    </div>
  );
}

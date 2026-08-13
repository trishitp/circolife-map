import { useEffect, useState } from 'react';
import { fetchAuthStatus, login } from '../lib/api';
import BrandMark from './BrandMark';

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
      setError(err.message || 'Could not sign in. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-screen">
      <div className="login-card">
        <BrandMark className="login-brand" />
        <h1>Welcome back</h1>
        <p className="login-copy">
          {zoho
            ? 'Sign in with your Circolife Zoho account to open Maps.'
            : 'Enter the email and password issued for your Maps account.'}
        </p>
        {error && <div className="banner err">{error}</div>}
        {zoho ? (
          <a className="btn login-btn" href="/api/auth/zoho/start">
            Continue with Zoho
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

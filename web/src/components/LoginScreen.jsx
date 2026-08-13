import { useState } from 'react';
import { login } from '../lib/api';

export default function LoginScreen({ onSuccess }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const data = await login({ email, password });
      onSuccess(data.user || null);
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">
          circo<span>life</span>
          <small>maps</small>
        </div>
        <h1>Sign in</h1>
        <p className="login-copy">
          Use your Circolife Maps email and password. Admin tools are only shown
          to admin accounts. If this is the first sign-in, use your work email
          and the current app password — you become the first admin.
        </p>
        <label className="login-label" htmlFor="app-email">Email</label>
        <input
          id="app-email"
          className="input"
          type="email"
          autoComplete="username"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@circolife.com"
          disabled={loading}
          required
        />
        <label className="login-label" htmlFor="app-password">Password</label>
        <input
          id="app-password"
          className="input"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          disabled={loading}
          required
        />
        {error && <div className="banner err">{error}</div>}
        <button type="submit" className="btn login-btn" disabled={loading}>
          {loading ? 'Signing in…' : 'Enter Circolife Maps'}
        </button>
      </form>
    </div>
  );
}

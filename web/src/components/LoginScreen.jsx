import { useState } from 'react';
import { login } from '../lib/api';

export default function LoginScreen({ onSuccess }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await login(password);
      onSuccess();
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
          Spatial truth hub — map, field activity, location discrepancies, gaps, and admin.
        </p>
        <label className="login-label" htmlFor="app-password">App password</label>
        <input
          id="app-password"
          className="input"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          disabled={loading}
        />
        {error && <div className="banner err">{error}</div>}
        <button type="submit" className="btn login-btn" disabled={loading}>
          {loading ? 'Signing in…' : 'Enter Circolife Maps'}
        </button>
      </form>
    </div>
  );
}

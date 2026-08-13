import { useCallback, useEffect, useState } from 'react';
import {
  fetchAdminUsers, createAdminUser, updateAdminUser,
} from '../lib/api';

function fmtWhen(v) {
  if (!v) return 'Never';
  try {
    return new Date(v).toLocaleString('en-IN', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

export default function UsersAdmin({ me }) {
  const [users, setUsers] = useState([]);
  const [error, setError] = useState(null);
  const [msg, setMsg] = useState(null);
  const [form, setForm] = useState({
    email: '', name: '', password: '', isAdmin: false,
  });
  const [busy, setBusy] = useState(false);
  const [resetId, setResetId] = useState('');
  const [resetPw, setResetPw] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await fetchAdminUsers();
      setUsers(r.users || []);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const add = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await createAdminUser(form);
      setForm({ email: '', name: '', password: '', isAdmin: false });
      setMsg('User created');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const patch = async (id, body) => {
    setError(null);
    setMsg(null);
    try {
      await updateAdminUser(id, body);
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const reset = async (e) => {
    e.preventDefault();
    if (!resetId || !resetPw) return;
    setBusy(true);
    setError(null);
    try {
      await updateAdminUser(resetId, { password: resetPw });
      setResetId('');
      setResetPw('');
      setMsg('Password updated');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="soft-block">
      <h2>Users</h2>
      <p className="muted">
        Everyone signs in with their own email. Only admins see this tab and can
        sync, re-geocode, or change API rates.
      </p>
      {error && <div className="banner err">{error}</div>}
      {msg && <div className="banner ok">{msg}</div>}

      <div className="table-wrap">
        <table className="data-table compact">
          <thead>
            <tr>
              <th>Email</th>
              <th>Name</th>
              <th>Role</th>
              <th>Status</th>
              <th>Last login</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>
                  {u.email}
                  {me?.id === u.id && <span className="badge" style={{ marginLeft: 6 }}>you</span>}
                </td>
                <td>{u.name}</td>
                <td>{u.admin ? 'Admin' : 'User'}</td>
                <td>{u.active ? 'Active' : 'Disabled'}</td>
                <td>{fmtWhen(u.lastLoginAt)}</td>
                <td>
                  <div className="btn-row">
                    <button
                      type="button"
                      className="btn ghost sm"
                      disabled={me?.id === u.id && u.admin}
                      onClick={() => patch(u.id, { isAdmin: !u.admin })}
                    >
                      {u.admin ? 'Make user' : 'Make admin'}
                    </button>
                    <button
                      type="button"
                      className="btn ghost sm"
                      disabled={me?.id === u.id}
                      onClick={() => patch(u.id, { active: !u.active })}
                    >
                      {u.active ? 'Disable' : 'Enable'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!users.length && (
              <tr>
                <td colSpan={6} className="muted">No users yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <form className="users-add" onSubmit={add}>
        <h3 className="users-subhead">Add user</h3>
        <div className="users-add-grid">
          <label className="activity-field">
            Email
            <input
              className="input"
              type="email"
              required
              autoComplete="off"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            />
          </label>
          <label className="activity-field">
            Name
            <input
              className="input"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Optional"
            />
          </label>
          <label className="activity-field">
            Password
            <input
              className="input"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              placeholder="At least 8 characters"
            />
          </label>
        </div>
        <label className="walk-follow" style={{ marginTop: 8 }}>
          <input
            type="checkbox"
            checked={form.isAdmin}
            onChange={(e) => setForm((f) => ({ ...f, isAdmin: e.target.checked }))}
          />
          Admin (can open Admin tab)
        </label>
        <div className="btn-row" style={{ marginTop: 10 }}>
          <button type="submit" className="btn" disabled={busy}>Add user</button>
        </div>
      </form>

      <form className="users-add" onSubmit={reset}>
        <h3 className="users-subhead">Reset password</h3>
        <div className="users-add-grid">
          <label className="activity-field">
            User
            <select
              className="input"
              value={resetId}
              onChange={(e) => setResetId(e.target.value)}
              required
            >
              <option value="">Select…</option>
              {users.filter((u) => u.active).map((u) => (
                <option key={u.id} value={u.id}>{u.email}</option>
              ))}
            </select>
          </label>
          <label className="activity-field">
            New password
            <input
              className="input"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={resetPw}
              onChange={(e) => setResetPw(e.target.value)}
            />
          </label>
        </div>
        <div className="btn-row" style={{ marginTop: 10 }}>
          <button type="submit" className="btn ghost" disabled={busy}>Set password</button>
        </div>
      </form>
    </section>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { fetchAdminUsers, updateAdminUser } from '../lib/api';

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

  const patch = async (id, body) => {
    setError(null);
    try {
      await updateAdminUser(id, body);
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <section className="soft-block">
      <h2>Users</h2>
      <p className="muted">
        People appear here after they sign in with Zoho. Grant Admin to those who
        should see this tab. Emails in <code>ADMIN_EMAILS</code> always stay admin.
      </p>
      {error && <div className="banner err">{error}</div>}

      <div className="table-wrap">
        <table className="data-table compact">
          <thead>
            <tr>
              <th>Email</th>
              <th>Name</th>
              <th>Sign-in</th>
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
                <td>{u.loginProvider === 'zoho' ? 'Zoho' : 'Local'}</td>
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
                <td colSpan={7} className="muted">No one has signed in with Zoho yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

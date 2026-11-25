export default function AccountAssetScopeBar({ scope, onClear }) {
  if (!scope?.label) return null;
  const n = scope.assetCount ?? 0;
  const accN = scope.accountCount ?? scope.accountIds?.length ?? 0;
  const loading = scope.assetCount == null;
  return (
    <div className="account-asset-scope" role="status">
      <p>
        <strong>{scope.label}</strong>
        {scope.rolledUp ? ' · all sites' : ''}
        {' — '}
        {loading ? 'loading ACs…' : (
          <>
            {n.toLocaleString('en-IN')}
            {' AC'}
            {n === 1 ? '' : 's'}
          </>
        )}
        {!loading && accN > 1 ? ` · ${accN} account pins` : ''}
      </p>
      <button type="button" className="btn ghost sm" onClick={onClear}>
        Clear
      </button>
    </div>
  );
}
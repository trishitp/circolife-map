export default function BdmTerritoryHint({ owner, count, onVisitHeat }) {
  if (!owner || !count) return null;
  return (
    <div className="bdm-territory-hint" role="note">
      <p>
        <strong>{owner}</strong>
        {' · '}
        {count}
        {' assigned PIN'}
        {count === 1 ? '' : 's'}
        {' — meeting pins '}
        <span className="bdm-in">blue</span>
        {' in territory, '}
        <span className="bdm-out">red</span>
        {' outside'}
      </p>
      <button type="button" className="btn ghost sm" onClick={onVisitHeat}>
        Show visit heat
      </button>
    </div>
  );
}
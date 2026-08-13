export default function BrandMark({
  product = 'Maps',
  compact = false,
  className = '',
}) {
  const root = ['brand', compact ? 'is-compact' : '', className].filter(Boolean).join(' ');
  return (
    <div className={root}>
      {compact ? (
        <img
          className="brand-mark"
          src="/brand/favicon-180.png"
          width="28"
          height="28"
          alt=""
        />
      ) : (
        <img
          className="brand-logo"
          src="/brand/circolife-logo.svg"
          alt="Circolife"
        />
      )}
      {product ? <span className="brand-product">{product}</span> : null}
    </div>
  );
}

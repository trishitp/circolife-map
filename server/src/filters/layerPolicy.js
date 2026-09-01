/**
 * Map layer visibility — single source of truth for what appears on the map.
 *
 * Accounts: only rows with at least one plottable linked asset.
 * Assets: exclude FSM parent/container rows (referenced via Parent Asset).
 */

/** Accounts layer: only rows with at least one plottable linked asset. */
export function sqlAccountHasAsset(alias = 'map_points') {
  const a = alias;
  return `EXISTS (
    SELECT 1 FROM map_points ast
    WHERE ast.layer = 'assets'
      AND NULLIF(ast.extra->>'accountId', '') IS NOT NULL
      AND ast.extra->>'accountId' = ${a}.source_id
      AND ast.geom IS NOT NULL
  )`;
}

/** Assets layer: exclude parent/container rows other assets point to. */
export function sqlAssetNotParent(alias = 'map_points') {
  const a = alias;
  return `NOT EXISTS (
    SELECT 1 FROM map_points child
    WHERE child.layer = 'assets'
      AND NULLIF(child.extra->>'parentAssetId', '') IS NOT NULL
      AND child.extra->>'parentAssetId' = ${a}.source_id
  )`;
}

/** Layer-specific visibility WHERE fragments (no leading AND). */
export function layerVisibilityClauses(layer, alias = 'map_points') {
  const clauses = [];
  if (layer === 'accounts') clauses.push(sqlAccountHasAsset(alias));
  if (layer === 'assets') clauses.push(sqlAssetNotParent(alias));
  return clauses;
}

/** Stats / badges: which map_points rows count for a given layer. */
export function sqlMapPointVisible(alias = 'map_points') {
  const a = alias;
  return `(
    ${a}.layer NOT IN ('accounts', 'assets')
    OR (${a}.layer = 'accounts' AND ${sqlAccountHasAsset(a)})
    OR (${a}.layer = 'assets' AND ${sqlAssetNotParent(a)})
  )`;
}

/** Nearby / multi-layer: hide filtered accounts and parent assets when those layers are requested. */
export function sqlLayersVisibility() {
  return `(
    layer NOT IN ('accounts', 'assets')
    OR (layer = 'accounts' AND ${sqlAccountHasAsset()})
    OR (layer = 'assets' AND ${sqlAssetNotParent()})
  )`;
}

/** Append visibility clauses for a single map layer query. Mutates wheres. */
export function applyLayerVisibility(wheres, layer, alias = 'map_points') {
  wheres.push(...layerVisibilityClauses(layer, alias));
}

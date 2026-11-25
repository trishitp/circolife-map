/** Selection halo / emphasis colors by geocode precision (trust UX). */
export const SELECTION_COLORS = {
  exact: '#2E1F40',
  geocoded: '#A14996',
  approx: '#5A9B6E',
  inherited: '#7B6A94',
  pincode: '#C98A2E',
  territory: '#B07A28',
  none: '#9A8F88',
};

export function selectionColors(precision) {
  const key = String(precision || '').toLowerCase();
  const stroke = SELECTION_COLORS[key] || '#A14996';
  return { stroke, fill: stroke };
}

export function isAreaPrecision(precision) {
  return precision === 'pincode' || precision === 'territory';
}
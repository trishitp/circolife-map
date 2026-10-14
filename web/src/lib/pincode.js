/** Match server normalizePincode for visit territory checks. */
export function normalizePincode(raw) {
  if (raw == null || raw === '') return null;
  let s = String(raw).trim().replace(/\.0+$/, '');
  s = s.replace(/\D/g, '');
  if (s.length === 5) s = `0${s}`;
  if (!/^\d{6}$/.test(s)) return null;
  return s;
}

export function tagMeetingVisitZone(feature, assignedPincodes) {
  if (!assignedPincodes?.size || !feature?.properties) return feature;
  const pc = normalizePincode(feature.properties.pincode);
  const visitZone = pc && assignedPincodes.has(pc) ? 'in' : 'out';
  return {
    ...feature,
    properties: { ...feature.properties, visitZone },
  };
}

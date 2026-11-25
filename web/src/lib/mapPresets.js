/** Quick map views — layers + insight only (filters unchanged). */
export const MAP_QUICK_PRESETS = [
  {
    id: 'installed',
    label: 'Installed base',
    short: 'ACs',
    layers: ['assets'],
    insight: 'off',
    hint: 'Installed ACs in the map view',
  },
  {
    id: 'field',
    label: 'Field day',
    short: 'Meets',
    layers: ['meetings'],
    insight: 'off',
    hint: 'GPS check-ins for today’s planning',
  },
  {
    id: 'pipeline',
    label: 'Pipeline',
    short: 'Leads',
    layers: ['leads', 'accounts'],
    insight: 'off',
    hint: 'Leads and accounts together',
  },
  {
    id: 'coverage',
    label: 'Coverage',
    short: 'Cover',
    layers: ['leads'],
    insight: 'coverage',
    openOpportunities: true,
    hint: 'Where leads lack recent visits',
  },
  {
    id: 'visits',
    label: 'Visit heat',
    short: 'Heat',
    layers: ['meetings', 'leads'],
    insight: 'heat',
    hint: 'Check-in density vs leads',
  },
];

export function presetMatches(preset, { active, insightMode }) {
  const want = new Set(preset.layers);
  const have = new Set(active);
  if (want.size !== have.size) return false;
  for (const l of want) if (!have.has(l)) return false;
  return (preset.insight || 'off') === insightMode;
}
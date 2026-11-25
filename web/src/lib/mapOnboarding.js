const STORAGE_KEY = 'circo.mapCoach.v1';

export const COACH_STEPS = [
  {
    id: 'layers',
    title: 'Turn on what you need',
    body: 'Use layer pills for ACs, leads, accounts, or meetings. Your filters stay as they are.',
  },
  {
    id: 'legend',
    title: 'Trust the halo',
    body: 'Tap i for the legend. Purple is geocoded; amber is pincode / territory — zoom in before deciding.',
  },
];

export function coachStepIndex() {
  try {
    const n = Number(localStorage.getItem(STORAGE_KEY));
    if (!Number.isFinite(n) || n < 0) return 0;
    if (n >= COACH_STEPS.length) return -1;
    return n;
  } catch {
    return 0;
  }
}

export function advanceCoach() {
  const i = coachStepIndex();
  if (i < 0) return -1;
  const next = i + 1;
  try {
    localStorage.setItem(STORAGE_KEY, String(next));
  } catch { /* */ }
  return next >= COACH_STEPS.length ? -1 : next;
}

export function dismissCoach() {
  try {
    localStorage.setItem(STORAGE_KEY, String(COACH_STEPS.length));
  } catch { /* */ }
}
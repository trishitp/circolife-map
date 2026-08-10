let selected = null;
const listeners = new Set();

export function emitSelection(p) {
  selected = p;
  for (const fn of listeners) fn(p);
}

export function onSelection(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getSelection() {
  return selected;
}

import { FILTERS_KEY, type CalendarFilters } from './view';

const FILTERS_EVENT = 'macroflow:calendar-filters';
let memory: string | null | undefined;

/** Memory remains authoritative when browser storage is blocked or full. */
export function readStoredFilters(): string | null {
  if (memory !== undefined) return memory;
  try { return window.localStorage.getItem(FILTERS_KEY); } catch { return null; }
}

export function subscribeFilters(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== FILTERS_KEY && event.key !== null) return;
    memory = event.newValue;
    onChange();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(FILTERS_EVENT, onChange);
  return () => { window.removeEventListener('storage', onStorage); window.removeEventListener(FILTERS_EVENT, onChange); };
}

export function updateFilters(filters: CalendarFilters) {
  memory = JSON.stringify(filters);
  try { window.localStorage.setItem(FILTERS_KEY, memory); } catch { /* Filters still work for this page session. */ }
  window.dispatchEvent(new Event(FILTERS_EVENT));
}

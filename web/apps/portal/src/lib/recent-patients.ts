/**
 * Patients opened recently in this tab, newest first, per clinic. Only IDs are kept, in session
 * storage (gone when the tab closes); names come from records the app already loaded.
 */
const MAX = 6;
const key = (orgId: string) => `aarogyam.portal.recent-patients.${orgId}`;

export function recentPatientIds(orgId: string): string[] {
  try {
    const raw = globalThis.sessionStorage.getItem(key(orgId));
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string").slice(0, MAX) : [];
  } catch {
    return [];
  }
}

export function rememberPatient(orgId: string, id: string): void {
  try {
    const next = [id, ...recentPatientIds(orgId).filter((other) => other !== id)].slice(0, MAX);
    globalThis.sessionStorage.setItem(key(orgId), JSON.stringify(next));
  } catch {
    // Blocked storage: nothing is remembered.
  }
}

/**
 * "Finish later" in this browser tab: Today stops sending the owner back to the wizard, and shows the
 * "Finish setting up" card instead. Kept in session storage, which can be missing or throw (private
 * windows), so every use is guarded and the page works without it.
 */
const KEY = "aarogyam.setup.later";

export function rememberLater(): void {
  try {
    window.sessionStorage.setItem(KEY, "1");
  } catch {
    // Without storage the owner is simply asked again next time.
  }
}

export function wantsLater(): boolean {
  try {
    return window.sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

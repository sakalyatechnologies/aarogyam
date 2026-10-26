/**
 * The optional alert for a patient who is waiting: a short sound and a desktop notice. Off until the person switches it on in
 * Settings → My profile, and remembered per person in this browser. The text is always generic: it never names a patient.
 */
import { useCallback, useState } from "react";

export const VISIT_ALERT_TITLE = "New patient waiting";

const keyFor = (userId: string) => `aarogyam.visit-alerts.${userId}`;

/** Whether this person switched the alert on here; off when nothing is stored or storage is blocked. */
export function readVisitAlerts(userId: string): boolean {
  try {
    return globalThis.localStorage.getItem(keyFor(userId)) === "1";
  } catch {
    return false;
  }
}

export function writeVisitAlerts(userId: string, on: boolean): void {
  try {
    globalThis.localStorage.setItem(keyFor(userId), on ? "1" : "0");
  } catch {
    // Blocked storage: the choice holds for this visit only.
  }
}

/** Asks the browser for permission to show desktop notices; resolves `"denied"` when it can't. */
export async function askNoticePermission(): Promise<NotificationPermission> {
  try {
    if (typeof Notification === "undefined") return "denied";
    if (Notification.permission !== "default") return Notification.permission;
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}

/** A short two-tone chime. Silent when the browser has no audio or blocks it before a click. */
function chime(): void {
  try {
    if (typeof AudioContext === "undefined") return;
    const audio = new AudioContext();
    const gain = audio.createGain();
    gain.gain.value = 0.08;
    gain.connect(audio.destination);
    [880, 660].forEach((hertz, i) => {
      const tone = audio.createOscillator();
      tone.frequency.value = hertz;
      tone.connect(gain);
      tone.start(audio.currentTime + i * 0.18);
      tone.stop(audio.currentTime + i * 0.18 + 0.15);
    });
    window.setTimeout(() => {
      void audio.close();
    }, 800);
  } catch {
    // No sound is not an error.
  }
}

/** Sounds the chime and shows a desktop notice, if this person turned them on. Generic text only. */
export function alertNewPatient(userId: string): void {
  if (!readVisitAlerts(userId)) return;
  chime();
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.visibilityState === "hidden") {
      new Notification(VISIT_ALERT_TITLE, { tag: "visit-waiting" });
    }
  } catch {
    // A browser that refuses notices still got the chime.
  }
}

/** The switch in My profile: the stored choice and a setter. Switching on asks for notice permission; off never does. */
export function useVisitAlerts(userId: string): { on: boolean; set: (next: boolean) => Promise<void> } {
  const [on, setOn] = useState(() => readVisitAlerts(userId));
  const set = useCallback(
    async (next: boolean) => {
      setOn(next);
      writeVisitAlerts(userId, next);
      if (next) await askNoticePermission();
    },
    [userId],
  );
  return { on, set };
}

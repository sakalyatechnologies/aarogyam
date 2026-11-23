// The 3D smile's performance gate (present-studio-design §6.4): WebGL2, deviceMemory >= 4 where the
// browser reports it, hardwareConcurrency >= 6; then a 2 s fps probe (under 24 fps stops it).
export interface DeviceEnv {
  webgl2: boolean;
  deviceMemory?: number | undefined;
  hardwareConcurrency?: number | undefined;
}

export const MIN_MEMORY_GB = 4;
export const MIN_CORES = 6;
export const MIN_FPS = 24;
export const PROBE_MS = 2000;

/** The line shown when the painted smile stands in for the 3D one. */
export const SMILE3D_FALLBACK_LINE = "3D isn't smooth on this device; showing the painted smile";

/** True when the device may mount the 3D smile. A missing figure is not a failure (deviceMemory is absent in Safari). */
export function smile3dAllowed(env: DeviceEnv): boolean {
  if (!env.webgl2) return false;
  if (env.deviceMemory !== undefined && env.deviceMemory < MIN_MEMORY_GB) return false;
  if (env.hardwareConcurrency !== undefined && env.hardwareConcurrency < MIN_CORES) return false;
  return true;
}

/** Frames counted over the probe window; true when the smile is smooth enough to keep. */
export const probePasses = (frames: number, ms: number): boolean => ms > 0 && (frames * 1000) / ms >= MIN_FPS;

/** Reads the real device. */
export function readDeviceEnv(): DeviceEnv {
  const webgl2 = (() => { try { return document.createElement("canvas").getContext("webgl2") !== null; } catch { return false; } })();
  const mem = "deviceMemory" in navigator && typeof navigator.deviceMemory === "number" ? navigator.deviceMemory : undefined;
  return { webgl2, deviceMemory: mem, hardwareConcurrency: typeof navigator.hardwareConcurrency === "number" ? navigator.hardwareConcurrency : undefined };
}

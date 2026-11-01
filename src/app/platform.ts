/** Runtime platform checks shared by the UI and data layers. */

interface CapacitorGlobal {
  Capacitor?: { isNativePlatform?: () => boolean };
}

/** True inside the Capacitor Android/iOS shell, false in a browser. */
export function isNative(): boolean {
  if (typeof window === 'undefined') return false;
  return !!(window as unknown as CapacitorGlobal).Capacitor?.isNativePlatform?.();
}

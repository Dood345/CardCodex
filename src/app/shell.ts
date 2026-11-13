/**
 * What the web app asks of the native shell around it (android/…/ShellPlugin.java). In a browser every
 * call is a no-op.
 */
import { registerPlugin } from '@capacitor/core';
import { isNative } from './platform';

interface ShellPlugin {
  setScrollbar(options: { shown: boolean }): Promise<void>;
}

const Shell = registerPlugin<ShellPlugin>('Shell');

/**
 * Show or hide the system scrollbar Android draws on the WebView for the scrolling pane. CSS hides the
 * pane's own bar in a browser; on Android the bar is the system's and only the shell can turn it off.
 * An older shell without the plugin rejects the call, which is ignored.
 */
export function setSystemScrollbar(shown: boolean): void {
  if (!isNative()) return;
  void Shell.setScrollbar({ shown }).catch(() => undefined);
}

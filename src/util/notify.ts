import { isNative } from './position';

/** Whether this device can show notifications from the app at all. */
export function canNotify(): boolean {
  return isNative || 'Notification' in window;
}

/** Ask once (the system remembers the answer); true when notifications may be shown. */
export async function askToNotify(): Promise<boolean> {
  if (isNative) {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    return (await LocalNotifications.requestPermissions()).display === 'granted';
  }
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  return (await Notification.requestPermission()) === 'granted';
}

/** Show a notification now. `tag`: one per subject, so a repeat replaces rather than piles up. */
export async function notify(title: string, body: string, tag: string): Promise<void> {
  if (isNative) {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    await LocalNotifications.schedule({ notifications: [{ id: Math.floor(Math.random() * 2 ** 31), title, body }] });
    return;
  }
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const icon = `${import.meta.env.BASE_URL}apple-touch-icon.png`;
  // Phones' browsers show them only through the service worker.
  const reg = await navigator.serviceWorker?.getRegistration().catch(() => undefined);
  if (reg) await reg.showNotification(title, { body, tag, icon });
  else new Notification(title, { body, tag, icon });
}

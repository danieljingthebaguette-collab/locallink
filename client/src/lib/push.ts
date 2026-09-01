// Web push, from the browser's side.
//
// Two things worth knowing before reading this:
//
// 1. iOS only allows push for a site the user has added to their Home Screen.
//    In Safari proper, Notification permission cannot even be requested. That
//    is why isIos()/isStandalone() exist -- the UI has to ask an iPhone user to
//    install first, and there is no way around it.
//
// 2. Permission is one-shot. Once someone picks "Block" the browser will not
//    ask again, so the prompt has to be worth showing the first time.

const API = '/api';

export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** Running as an installed app rather than a browser tab. */
export function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches
    || (window.navigator as any).standalone === true;
}

export function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
    // iPadOS reports as a Mac; the touch points give it away.
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/**
 * Which browser on iOS, which matters more than it sounds.
 *
 * Apple requires every iOS browser to run on WebKit, so Chrome and Firefox on
 * an iPhone are Safari wearing a different coat -- they inherit the same rule
 * that push only works once the site is on the Home Screen. Detecting them is
 * not about capability, then, but about instructions: "tap Share at the bottom"
 * is Safari's layout, and telling a Chrome user that sends them hunting for a
 * button that is somewhere else.
 *
 * Apple's documented path to a push-capable web app is Safari's own
 * Add to Home Screen, so anyone in another iOS browser is pointed there first.
 */
export type IosBrowser = 'safari' | 'chrome' | 'firefox' | 'edge' | 'other';

export function iosBrowser(): IosBrowser {
  const ua = navigator.userAgent;
  if (/CriOS/i.test(ua)) return 'chrome';
  if (/FxiOS/i.test(ua)) return 'firefox';
  if (/EdgiOS/i.test(ua)) return 'edge';
  if (/Safari/i.test(ua)) return 'safari';
  return 'other';
}

/** iPhone in Safari, not installed — push is impossible until they add it. */
export function needsInstallFirst(): boolean {
  return isIos() && !isStandalone();
}

export function permission(): NotificationPermission | 'unsupported' {
  return pushSupported() ? Notification.permission : 'unsupported';
}

/** Already refused. Nothing the page can do brings the prompt back. */
export function isBlocked(): boolean {
  return pushSupported() && Notification.permission === 'denied';
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('locallink_token');
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

/**
 * Asks permission, registers the worker, subscribes, and hands the subscription
 * to the server. Returns why it failed rather than a bare false, so the caller
 * can say something useful instead of "something went wrong".
 */
export async function enablePush(): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!pushSupported()) return { ok: false, reason: 'This browser cannot do notifications.' };
  if (needsInstallFirst()) {
    return { ok: false, reason: 'On iPhone, add LocalLink to your Home Screen first — Safari cannot send notifications otherwise.' };
  }

  const cfg = await fetch(`${API}/push/key`).then(r => r.json()).catch(() => null);
  if (!cfg?.enabled || !cfg.publicKey) return { ok: false, reason: 'Notifications are not configured on the server yet.' };

  // Worth knowing: once someone has picked Block, this resolves to 'denied'
  // immediately and shows them nothing -- measured at 1ms. So a button that
  // just calls this looks broken to exactly the people who most need telling
  // what to do. The caller checks isBlocked() first and explains instead.
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') {
    return { ok: false, reason: perm === 'denied'
      ? 'Notifications are blocked for this site — the browser did not even ask. Reset it in the site settings next to the address bar.'
      : 'Notifications were not enabled.' };
  }

  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;

  // Reuse an existing subscription if there is one; subscribing twice with a
  // different key throws.
  const existing = await reg.pushManager.getSubscription();
  const sub = existing ?? await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(cfg.publicKey),
  });

  const res = await fetch(`${API}/push/subscribe`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({ subscription: sub.toJSON() }),
  });
  if (!res.ok) return { ok: false, reason: 'Could not save the subscription. Try again.' };
  return { ok: true };
}

export async function disablePush(): Promise<void> {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await fetch(`${API}/push/unsubscribe`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({ endpoint: sub.endpoint }),
  }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}

export async function sendTestPush(): Promise<number> {
  const r = await fetch(`${API}/push/test`, { method: 'POST', headers: authHeaders() });
  if (!r.ok) return 0;
  return (await r.json()).delivered ?? 0;
}

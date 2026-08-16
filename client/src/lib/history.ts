/**
 * Whether the visitor has navigated inside the app since arriving.
 *
 * Pages that render without site navigation — a certificate, a shared
 * record — need an explicit way out, and "go back" is only right when there
 * is somewhere inside the app to go back TO. Get it wrong and Escape drops
 * someone onto about:blank, off the site, with no way to return.
 *
 * `window.history.length` cannot answer this. A tab opened straight onto a
 * link already reports 2, because the blank page it replaced still counts,
 * and comparing against a length captured at module-eval time depends on
 * exactly when the bundle happened to evaluate — which is not something to
 * hang navigation on.
 *
 * So count real navigations instead. App.tsx notes each one after the first
 * render. Zero means the visitor landed here directly and should be sent
 * somewhere real; anything above zero means back() returns them to a page
 * of ours, at the scroll position they left it.
 */
let appNavigations = 0;

export function noteAppNavigation(): void {
  appNavigations += 1;
}

export function hasAppHistory(): boolean {
  return appNavigations > 0;
}

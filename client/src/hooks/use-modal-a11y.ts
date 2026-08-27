import { useEffect, useRef } from 'react';

/**
 * The four things every overlay owes a keyboard user, in one place.
 *
 * These kept drifting apart: CreatePostModal handled Escape and locked scroll,
 * ConfirmBubble set a dialog role but ignored Escape, and the post detail modal
 * -- the one opened from every card on the board -- did none of it. Rather than
 * patch each modal, callers now share this.
 *
 *  1. Escape closes, via the caller's own handler so it can guard unsaved work.
 *  2. Background scroll is frozen, so reaching the end of a modal doesn't start
 *     scrolling the page underneath and lose your place.
 *  3. Focus moves into the overlay on open, and returns to whatever opened it
 *     on close -- otherwise a keyboard user is left where they were, behind it.
 *  4. Tab is kept inside while it's open.
 *
 * Returns a ref to spread onto the overlay's own element.
 *
 * ponytail: querySelectorAll on Tab rather than a focus-trap dependency. The
 * list is tiny and recomputed per keypress so it stays correct as the modal's
 * contents change. Swap in a library only if nested dialogs turn up.
 */
const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Which overlays are open, innermost last. Modals nest here -- the post modal
 * raises a ConfirmBubble over itself -- and without this both would answer the
 * same Escape: the bubble would close and the modal underneath would
 * immediately reopen it. Only the top of the stack responds.
 */
const openStack: symbol[] = [];

export function useModalA11y(open: boolean, onEscape: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const idRef = useRef<symbol>(Symbol('modal'));
  // Held in a ref so the effect below doesn't re-run (and re-steal focus)
  // every time the caller passes a fresh closure.
  const escapeRef = useRef(onEscape);
  escapeRef.current = onEscape;

  useEffect(() => {
    if (!open) return;
    const node = ref.current;
    const id = idRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    openStack.push(id);

    // Move focus in. The container itself is the target rather than the first
    // control, so a screen reader reads the dialog from its start instead of
    // dropping the listener onto a stray button.
    if (node) {
      if (!node.hasAttribute('tabindex')) node.setAttribute('tabindex', '-1');
      node.focus({ preventScroll: true });
    }

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKey = (e: KeyboardEvent) => {
      // Anything below the top of the stack sits behind another overlay and
      // must ignore the keyboard entirely until that one closes.
      if (openStack[openStack.length - 1] !== id) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        escapeRef.current();
        return;
      }
      if (e.key !== 'Tab' || !node) return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter(el => el.offsetParent !== null || el === document.activeElement);
      if (items.length === 0) {
        // Nothing focusable inside: keep Tab from walking the page behind.
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === node)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      const at = openStack.lastIndexOf(id);
      if (at !== -1) openStack.splice(at, 1);
      // Only the last overlay standing restores scrolling. Unlocking while a
      // parent modal is still open would let the page scroll behind it.
      if (openStack.length === 0) document.body.style.overflow = prevOverflow;
      // Only pull focus back if it is still inside the closing overlay --
      // if something else has since claimed it, stealing it would be worse.
      if (!node || node.contains(document.activeElement)) {
        previouslyFocused?.focus?.();
      }
    };
  }, [open]);

  return ref;
}

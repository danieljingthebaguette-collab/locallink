import { useEffect, useState } from 'react';

/**
 * True once the page is scrolled past `enter` px, false again below `exit`.
 *
 * The two thresholds are not a nicety. The header this drives gets shorter when
 * it flips true, which shortens the document, which can move scrollY back under
 * a single threshold and flip it straight back — a visible shudder at the
 * boundary. Separate enter/exit points give it somewhere stable to sit.
 *
 * No rAF throttle: the handler only reads window.scrollY (which doesn't force
 * layout), and passing an updater to setScrolled means React bails out of the
 * re-render whenever the value is unchanged — which is almost every event.
 */
export function useScrolled(enter = 32, exit = 8): boolean {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const read = () => {
      const y = window.scrollY;
      setScrolled(prev => (prev ? y > exit : y > enter));
    };

    read(); // correct on mount, e.g. a restored scroll position
    window.addEventListener('scroll', read, { passive: true });
    return () => window.removeEventListener('scroll', read);
  }, [enter, exit]);

  return scrolled;
}

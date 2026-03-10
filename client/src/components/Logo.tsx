import { useId } from 'react';

interface LogoProps {
  size?: number;   // controls height; width is auto-computed from 56:40 aspect ratio
  className?: string;
}

export default function Logo({ size = 32, className = '' }: LogoProps) {
  const clipId = useId();
  // The logo is wider than it is tall (56 × 40 internal grid)
  const w = Math.round(size * 1.4);
  return (
    <svg
      width={w}
      height={size}
      viewBox="0 0 56 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <defs>
        {/* Clips ring-1's front pass to the lower half of the overlap,
            so ring-2 appears in front at the top crossing and
            ring-1 appears in front at the bottom crossing — true interlock */}
        <clipPath id={clipId}>
          <rect x="0" y="19" width="56" height="21" />
        </clipPath>
      </defs>

      {/* Left "L" — thick corner bracket (vertical + bottom horizontal) */}
      <path
        d="M 7 4 L 7 36 L 19 36"
        stroke="currentColor"
        strokeWidth="6.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />

      {/* ── Interlocked chain links ──
          Two oval rings, both rotated –45 ° so their long axes run diagonally.
          Centers are offset along that same axis so they interlock naturally.

          3-pass painter's algorithm:
            1. Ring 1 (lower-left) — full outline behind everything
            2. Ring 2 (upper-right) — background-coloured fill hides the
               section of ring 1 that should pass "behind" ring 2
            3. Ring 1 (lower-left) — re-drawn on top, clipped to y ≥ 19,
               so its lower arc appears in front of ring 2 at the overlap
      */}

      {/* Ring 1 — back pass */}
      <ellipse
        cx="23"
        cy="26"
        rx="10"
        ry="5"
        transform="rotate(-45 23 26)"
        stroke="currentColor"
        strokeWidth="4"
        fill="none"
      />

      {/* Ring 2 — background fill creates the occlusion */}
      <ellipse
        cx="33"
        cy="14"
        rx="10"
        ry="5"
        transform="rotate(-45 33 14)"
        stroke="currentColor"
        strokeWidth="4"
        style={{ fill: 'hsl(var(--background))' }}
      />

      {/* Ring 1 — front pass (only where it should be on top of ring 2) */}
      <ellipse
        cx="23"
        cy="26"
        rx="10"
        ry="5"
        transform="rotate(-45 23 26)"
        stroke="currentColor"
        strokeWidth="4"
        fill="none"
        clipPath={`url(#${clipId})`}
      />

      {/* Right upside-down L ("-|") — thick corner bracket (top horizontal + right vertical) */}
      <path
        d="M 37 4 L 49 4 L 49 36"
        stroke="currentColor"
        strokeWidth="6.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

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
        {/* Clip ring-1's "front pass" to the lower half of the overlap,
            creating the interlocked appearance */}
        <clipPath id={clipId}>
          <rect x="0" y="18" width="56" height="22" />
        </clipPath>
      </defs>

      {/* Left "L": vertical bar going down, horizontal bar at bottom going right */}
      <path
        d="M 7 4 L 7 36 L 19 36"
        stroke="currentColor"
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />

      {/* ── Interlocked chain links ──
          Ring 1 (lower-left oval) and Ring 2 (upper-right oval), both
          rotated –45 ° so their major axes run diagonally. The centres are
          offset exactly along that axis so the rings interlock naturally.

          Drawing order (painter's algorithm):
            1. Ring 1 — back pass (full outline, no fill)
            2. Ring 2 — with a background-coloured fill to occlude ring 1
               where ring 1 passes "behind" ring 2
            3. Ring 1 — front pass, clipped to y ≥ 18, so ring 1's lower
               arc reappears on top of ring 2 at the overlap
      */}

      {/* Ring 1 back pass */}
      <ellipse
        cx="24"
        cy="24"
        rx="7"
        ry="3.5"
        transform="rotate(-45 24 24)"
        stroke="currentColor"
        strokeWidth="2.5"
        fill="none"
      />

      {/* Ring 2 — background fill creates the occlusion of ring 1 */}
      <ellipse
        cx="32"
        cy="16"
        rx="7"
        ry="3.5"
        transform="rotate(-45 32 16)"
        stroke="currentColor"
        strokeWidth="2.5"
        style={{ fill: 'hsl(var(--background))' }}
      />

      {/* Ring 1 front pass — clipped so only the lower arc shows on top */}
      <ellipse
        cx="24"
        cy="24"
        rx="7"
        ry="3.5"
        transform="rotate(-45 24 24)"
        stroke="currentColor"
        strokeWidth="2.5"
        fill="none"
        clipPath={`url(#${clipId})`}
      />

      {/* Right upside-down L ("-|"): horizontal bar at top, vertical bar on right going down */}
      <path
        d="M 37 4 L 49 4 L 49 36"
        stroke="currentColor"
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

import { useId } from 'react';

interface LogoProps {
  size?: number;   // controls both width and height (square)
  className?: string;
}

export default function Logo({ size = 32, className = '' }: LogoProps) {
  const clipId = useId();

  /*
    ── Logo geometry (100 × 100 square viewBox) ──

    Two solid filled L-brackets in primary blue:
      Left  "L"  — vertical bar (left side) + horizontal bar (bottom)
      Right "⌐"  — horizontal bar (top) + vertical bar (right side)
      Both are positioned diagonally: left-L in lower-left, right-⌐ in upper-right.

    Two interlocked chain links in currentColor (dark charcoal):
      Ring 1 centre (36, 63) — lower-left link
      Ring 2 centre (64, 37) — upper-right link
      Both rotated -45 deg; midpoint (50, 50) is the clip boundary.

    Three-pass painter's algorithm for interlock illusion:
      Pass A  Ring 1 full outline  (behind ring 2)
      Pass B  Ring 2 with background fill  (erases ring 1 "behind" it at upper crossing)
      Pass C  Ring 1 clipped to y ≥ 50  (makes ring 1 appear in front at lower crossing)

    L-brackets are drawn LAST so they sit on top of the chain where they overlap.
  */

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <defs>
        <clipPath id={clipId}>
          <rect x="0" y="50" width="100" height="50" />
        </clipPath>
      </defs>

      {/* ── Pass A: Ring 1 — full outline, behind ring 2 ── */}
      <ellipse
        cx="36" cy="63"
        rx="29" ry="11"
        transform="rotate(-45 36 63)"
        stroke="currentColor"
        strokeWidth="5"
        fill="none"
      />

      {/* ── Pass B: Ring 2 — background fill erases ring 1 behind it ── */}
      <ellipse
        cx="64" cy="37"
        rx="29" ry="11"
        transform="rotate(-45 64 37)"
        stroke="currentColor"
        strokeWidth="5"
        style={{ fill: 'hsl(var(--background))' }}
      />

      {/* ── Pass C: Ring 1 — front pass, clipped to lower half (lower crossing) ── */}
      <ellipse
        cx="36" cy="63"
        rx="29" ry="11"
        transform="rotate(-45 36 63)"
        stroke="currentColor"
        strokeWidth="5"
        fill="none"
        clipPath={`url(#${clipId})`}
      />

      {/* ── Left "L" bracket — vertical bar + bottom horizontal bar ── */}
      <rect x="28" y="27" width="13" height="57" rx="3" fill="hsl(var(--primary))" />
      <rect x="28" y="71" width="27" height="13" rx="3" fill="hsl(var(--primary))" />

      {/* ── Right "⌐" bracket — top horizontal bar + right vertical bar ── */}
      <rect x="44" y="16" width="29" height="13" rx="3" fill="hsl(var(--primary))" />
      <rect x="60" y="16" width="13" height="55" rx="3" fill="hsl(var(--primary))" />
    </svg>
  );
}

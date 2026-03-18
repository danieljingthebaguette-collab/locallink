import { useId } from 'react';

interface LogoProps {
  size?: number;   // controls height; width is auto-computed from 56:40 aspect ratio
  className?: string;
}

export default function Logo({ size = 32, className = '' }: LogoProps) {
  const clipId = useId();
  // The logo is wider than it is tall (56 × 40 internal grid)
  const w = Math.round(size * 1.4);

  /*
    ── Chain link geometry ──
    Each link is a highly-elongated ellipse (rx=16, ry=6 → 2.67 : 1 ratio)
    rotated -45° so the long axis runs diagonally — exactly like a chain
    viewed at an angle.

    Ring 1 centre (21, 26)  lower-left tip  ≈ (9.7, 37.3)   → tucks into left  L corner
    Ring 2 centre (35, 14)  upper-right tip ≈ (46.3, 2.7)   → tucks into right L corner
    Mid-point of centres = (28, 20)  → interlock clip boundary

    Three-pass painter's algorithm:
      Pass A  Ring 1 full  (behind everything)
      Pass B  Ring 2 with background fill  (its interior erases the part of
              ring 1 that passes "behind" ring 2 at the upper crossing)
      Pass C  Ring 1 clipped to y ≥ 20  (makes ring 1 appear in front of
              ring 2 at the lower crossing → true interlock)

    L brackets are drawn AFTER the rings with a double stroke:
      1. Thick background-coloured mask stroke   → hides the chain tip that
         tucks behind the L corner (depth / clasping effect)
      2. Thin coloured stroke on top             → the visible L bracket
  */

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
        {/* Reveal ring-1's front pass only below the interlock mid-line */}
        <clipPath id={clipId}>
          <rect x="0" y="20" width="56" height="20" />
        </clipPath>
      </defs>

      {/* ── Pass A: Ring 1 — full outline, drawn first (behind ring 2) ── */}
      <ellipse
        cx="21" cy="26"
        rx="16" ry="6"
        transform="rotate(-45 21 26)"
        stroke="currentColor"
        strokeWidth="5"
        fill="none"
      />

      {/* ── Pass B: Ring 2 — background fill erases ring-1 behind it ── */}
      <ellipse
        cx="35" cy="14"
        rx="16" ry="6"
        transform="rotate(-45 35 14)"
        stroke="currentColor"
        strokeWidth="5"
        style={{ fill: 'hsl(var(--background))' }}
      />

      {/* ── Pass C: Ring 1 — front pass, only below y=20 (lower crossing) ── */}
      <ellipse
        cx="21" cy="26"
        rx="16" ry="6"
        transform="rotate(-45 21 26)"
        stroke="currentColor"
        strokeWidth="5"
        fill="none"
        clipPath={`url(#${clipId})`}
      />

      {/* ── Left "L"  ── mask first, then coloured stroke on top ── */}
      <path
        d="M 7 4 L 7 36 L 19 36"
        style={{ stroke: 'hsl(var(--background))' }}
        strokeWidth="16"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M 7 4 L 7 36 L 19 36"
        stroke="currentColor"
        strokeWidth="8"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />

      {/* ── Right inverted "L"  ── mask first, then coloured stroke on top ── */}
      <path
        d="M 37 4 L 49 4 L 49 36"
        style={{ stroke: 'hsl(var(--background))' }}
        strokeWidth="16"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M 37 4 L 49 4 L 49 36"
        stroke="currentColor"
        strokeWidth="8"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

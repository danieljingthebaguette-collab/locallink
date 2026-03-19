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
      Left  "L"  — vertical bar (left) + horizontal bar (bottom)
      Right "⌐"  — horizontal bar (top) + vertical bar (right)

    Interlocked chain links in currentColor (dark gray):
      Ring 1 centre (35, 63)  — lower-left link
      Ring 2 centre (65, 37)  — upper-right link
      Mid-point = (50, 50)    — clip boundary for interlock

    Three-pass painter's algorithm (same as before):
      Pass A  Ring 1 full outline  (behind ring 2)
      Pass B  Ring 2 with background fill  (erases ring 1 behind it)
      Pass C  Ring 1 clipped to y ≥ 50  (front crossing → true interlock)

    L-brackets drawn AFTER chains so they appear in front,
    using solid filled rects (no masking stroke needed).
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
        {/* Reveal ring-1's front pass only below the interlock mid-line */}
        <clipPath id={clipId}>
          <rect x="0" y="50" width="100" height="50" />
        </clipPath>
      </defs>

      {/* ── Pass A: Ring 1 — full outline, drawn first (behind ring 2) ── */}
      <ellipse
        cx="35" cy="63"
        rx="22" ry="8.5"
        transform="rotate(-45 35 63)"
        stroke="currentColor"
        strokeWidth="6"
        fill="none"
      />

      {/* ── Pass B: Ring 2 — background fill erases ring-1 behind it ── */}
      <ellipse
        cx="65" cy="37"
        rx="22" ry="8.5"
        transform="rotate(-45 65 37)"
        stroke="currentColor"
        strokeWidth="6"
        style={{ fill: 'hsl(var(--background))' }}
      />

      {/* ── Pass C: Ring 1 — front pass, only below y=50 (lower crossing) ── */}
      <ellipse
        cx="35" cy="63"
        rx="22" ry="8.5"
        transform="rotate(-45 35 63)"
        stroke="currentColor"
        strokeWidth="6"
        fill="none"
        clipPath={`url(#${clipId})`}
      />

      {/* ── Left "L" bracket — solid primary-coloured filled rectangles ── */}
      {/* Vertical bar */}
      <rect x="8"  y="20" width="15" height="62" rx="3" fill="hsl(var(--primary))" />
      {/* Horizontal bar */}
      <rect x="8"  y="67" width="40" height="15" rx="3" fill="hsl(var(--primary))" />

      {/* ── Right inverted "L" bracket — solid primary-coloured filled rectangles ── */}
      {/* Horizontal bar */}
      <rect x="52" y="18" width="40" height="15" rx="3" fill="hsl(var(--primary))" />
      {/* Vertical bar */}
      <rect x="77" y="18" width="15" height="62" rx="3" fill="hsl(var(--primary))" />
    </svg>
  );
}

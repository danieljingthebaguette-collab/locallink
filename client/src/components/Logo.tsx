interface LogoProps {
  size?: number;   // controls height; width is auto-computed from 56:40 aspect ratio
  className?: string;
}

export default function Logo({ size = 32, className = '' }: LogoProps) {
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
      {/* Left "L": vertical bar going down, horizontal bar at bottom going right */}
      <path
        d="M 7 4 L 7 36 L 19 36"
        stroke="currentColor"
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />

      {/* Square chain link ring in the centre */}
      <rect
        x="21"
        y="13"
        width="14"
        height="14"
        rx="3"
        stroke="currentColor"
        strokeWidth="4"
        fill="none"
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

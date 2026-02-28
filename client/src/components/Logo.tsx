interface LogoProps {
  size?: number;
  className?: string;
}

export default function Logo({ size = 32, className = '' }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Left chain link ring */}
      <rect
        x="2"
        y="13"
        width="18"
        height="14"
        rx="7"
        stroke="currentColor"
        strokeWidth="3.5"
        fill="none"
      />
      {/* Right chain link ring (overlapping) */}
      <rect
        x="20"
        y="13"
        width="18"
        height="14"
        rx="7"
        stroke="currentColor"
        strokeWidth="3.5"
        fill="none"
      />
      {/* Map pin dot inside right ring */}
      <circle
        cx="29"
        cy="19"
        r="3"
        fill="currentColor"
      />
      {/* Pin tail */}
      <line
        x1="29"
        y1="22"
        x2="29"
        y2="26"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

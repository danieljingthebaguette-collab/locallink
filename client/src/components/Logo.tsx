interface LogoProps {
  size?: number;   // controls both width and height (square)
  className?: string;
}

export default function Logo({ size = 32, className = '' }: LogoProps) {
  return (
    <img
      src="/logo.png"
      alt="LocalLink logo"
      width={size}
      height={size}
      className={className}
      style={{ objectFit: 'contain' }}
    />
  );
}

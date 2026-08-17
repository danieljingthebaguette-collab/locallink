import { cn } from '@/lib/utils';

/**
 * The soft bottom edge under a pinned bar — content dissolves into the bar
 * instead of being cut off by a line.
 *
 * Colour only, no backdrop-filter. The previous version tapered a blur by
 * masking a `backdrop-blur-lg` layer, which was the wrong trade twice over:
 * the bars sit at 95% opacity, so the blur was modulating five percent of a
 * pixel and buying almost nothing, while costing a second full-width filter
 * pass repainting on every scroll frame. What actually read as a hard block
 * was the tint ending in one row, plus a 1px border. Both are fixable with a
 * gradient, so the bars are now fully opaque and this is the entire effect.
 *
 * Opaque is a requirement, not a preference: with no blur, a translucent bar
 * shows sharp legible content straight through itself, and the gradient's top
 * stop has to match the bar exactly or the seam reappears.
 *
 * The stops ease out rather than ramp linearly — a straight alpha ramp has a
 * detectable end, which is the same hard edge one step further down.
 */
const FALLOFF = [
  'hsl(var(--background)) 0%',
  'hsl(var(--background) / 0.85) 22%',
  'hsl(var(--background) / 0.55) 45%',
  'hsl(var(--background) / 0.25) 68%',
  'hsl(var(--background) / 0.08) 84%',
  'hsl(var(--background) / 0) 100%',
].join(', ');

export default function SoftEdge({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn('pointer-events-none h-10', className)}
      style={{ backgroundImage: `linear-gradient(to bottom, ${FALLOFF})` }}
    />
  );
}

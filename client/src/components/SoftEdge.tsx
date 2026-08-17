import { cn } from '@/lib/utils';

/**
 * The soft bottom edge under a pinned bar — content dissolves into the bar
 * instead of being cut off by a line.
 *
 * Colour only, no backdrop-filter. Tapering a blur by masking a
 * `backdrop-blur-lg` layer was the wrong trade twice over: the bars sat at
 * 95% opacity, so the blur was modulating five percent of a pixel and buying
 * almost nothing, while costing a second full-width filter pass repainting on
 * every scroll frame. What read as a hard block was the tint ending in one
 * row, plus a 1px border. Both are fixable with a gradient.
 *
 * Opaque bars are a requirement, not a preference: with no blur, a
 * translucent bar shows sharp legible content straight through itself, and
 * the gradient's top stop has to match the bar exactly or the seam reappears.
 *
 * The curve is the part that actually matters, and the part I got wrong the
 * first time. A gradient with evenly-spaced stops is piecewise LINEAR, so its
 * slope jumps discontinuously where it meets the flat bar above and the
 * untouched page below. The eye resolves a slope discontinuity as an edge —
 * Mach banding — which is why a "soft" fade still drew a visible line right
 * at the bar. Alpha here follows 1 - smoothstep(t), whose slope is zero at
 * BOTH ends, so it leaves the bar and reaches the page with nothing to catch
 * on. Sampled finely enough that the straight segments between stops don't
 * reintroduce the banding the curve exists to remove.
 */
const SMOOTHSTEP = (() => {
  const stops: string[] = [];
  const STEPS = 20;
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    const alpha = 1 - (3 * t * t - 2 * t * t * t);
    stops.push(`hsl(var(--background) / ${alpha.toFixed(3)}) ${(t * 100).toFixed(1)}%`);
  }
  return stops.join(', ');
})();

export default function SoftEdge({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      // 64px, not 40. Distance is the other half of the fix: the same curve
      // over a shorter run is a steeper curve, and steep is what gets seen.
      className={cn('pointer-events-none h-16', className)}
      style={{ backgroundImage: `linear-gradient(to bottom, ${SMOOTHSTEP})` }}
    />
  );
}

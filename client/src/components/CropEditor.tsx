import { useRef, useEffect, type CSSProperties } from 'react';
import { RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Types & helpers ────────────────────────────────────────────────────
export type ImageTransform = { ox: number; oy: number; scale: number };
export const DEFAULT_TRANSFORM: ImageTransform = { ox: 0, oy: 0, scale: 1 };

export function parseImageTransform(raw: string | null | undefined): ImageTransform {
  if (!raw) return DEFAULT_TRANSFORM;
  try {
    const p = JSON.parse(raw);
    if (typeof p.ox === 'number' && typeof p.oy === 'number' && typeof p.scale === 'number') return p;
  } catch { /* fall through */ }
  return DEFAULT_TRANSFORM;
}

export function serializeImageTransform(t: ImageTransform): string {
  return JSON.stringify(t);
}

/** Apply as inline style to any <img> with objectFit:cover for drag+zoom effect */
export function imageTransformStyle(t: ImageTransform): CSSProperties {
  return {
    objectFit:       'cover',
    objectPosition:  `${50 + t.ox}% ${50 + t.oy}%`,
    transform:       `scale(${t.scale})`,
    transformOrigin: 'center',
  };
}

// ── Component ──────────────────────────────────────────────────────────
interface CropEditorProps {
  src: string;
  label: string;
  value: ImageTransform;
  onChange: (t: ImageTransform) => void;
  /** 'dark' = white labels (inside coloured modals), 'light' = normal muted labels */
  variant?: 'dark' | 'light';
}

export default function CropEditor({
  src, label, value, onChange, variant = 'light',
}: CropEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Mutable refs so event listeners don't stale-close over state
  const state = useRef({ isDragging: false, lastX: 0, lastY: 0, pinchDist: 0, pinchScale: 1 });
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

  // Non-passive touch/wheel listeners (must be attached imperatively)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const touchMove = (e: TouchEvent) => {
      e.preventDefault();
      const s = state.current;
      const t = valueRef.current;
      const rect = el.getBoundingClientRect();

      if (e.touches.length === 1 && s.isDragging) {
        const dx = (e.touches[0].clientX - s.lastX) / rect.width  * 100;
        const dy = (e.touches[0].clientY - s.lastY) / rect.height * 100;
        s.lastX = e.touches[0].clientX;
        s.lastY = e.touches[0].clientY;
        onChangeRef.current({ ...t, ox: clamp(t.ox - dx, -50, 50), oy: clamp(t.oy - dy, -50, 50) });
      } else if (e.touches.length === 2) {
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY,
        );
        onChangeRef.current({ ...t, scale: clamp(s.pinchScale * dist / s.pinchDist, 1, 4) });
      }
    };

    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const t = valueRef.current;
      onChangeRef.current({ ...t, scale: clamp(t.scale - e.deltaY / 300, 1, 4) });
    };

    el.addEventListener('touchmove', touchMove, { passive: false });
    el.addEventListener('wheel',     wheel,     { passive: false });
    return () => {
      el.removeEventListener('touchmove', touchMove);
      el.removeEventListener('wheel',     wheel);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mouse handlers (synthetic events are fine)
  const onMouseDown = (e: React.MouseEvent) => {
    state.current.isDragging = true;
    state.current.lastX = e.clientX;
    state.current.lastY = e.clientY;
    e.preventDefault();
  };
  const onMouseMove = (e: React.MouseEvent) => {
    const s = state.current;
    if (!s.isDragging || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const dx = (e.clientX - s.lastX) / rect.width  * 100;
    const dy = (e.clientY - s.lastY) / rect.height * 100;
    s.lastX = e.clientX;
    s.lastY = e.clientY;
    const t = valueRef.current;
    onChangeRef.current({ ...t, ox: clamp(t.ox - dx, -50, 50), oy: clamp(t.oy - dy, -50, 50) });
  };
  const onMouseUp = () => { state.current.isDragging = false; };

  // Touch start / end (touchmove handled imperatively above)
  const onTouchStart = (e: React.TouchEvent) => {
    const s = state.current;
    if (e.touches.length === 1) {
      s.isDragging = true;
      s.lastX = e.touches[0].clientX;
      s.lastY = e.touches[0].clientY;
    } else if (e.touches.length === 2) {
      s.isDragging = false;
      s.pinchDist  = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY,
      );
      s.pinchScale = valueRef.current.scale;
    }
  };
  const onTouchEnd = () => { state.current.isDragging = false; };

  const isDark = variant === 'dark';

  return (
    <div className="space-y-1">
      {/* Label + reset row */}
      <div className="flex items-center justify-between">
        <p className={cn(
          'text-[10px] font-bold uppercase tracking-widest',
          isDark ? 'text-white/70' : 'text-muted-foreground',
        )}>
          {label}
        </p>
        <button
          type="button"
          onClick={() => onChange(DEFAULT_TRANSFORM)}
          className={cn(
            'flex items-center gap-0.5 text-[10px] transition-opacity',
            isDark
              ? 'text-white/50 hover:text-white/90'
              : 'text-muted-foreground/60 hover:text-muted-foreground',
          )}
        >
          <RotateCcw className="w-2.5 h-2.5" /> Reset
        </button>
      </div>

      {/* Interactive preview */}
      <div
        ref={containerRef}
        className="relative overflow-hidden rounded-xl cursor-grab active:cursor-grabbing select-none"
        style={{ height: '100px' }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <img
          src={src}
          alt="Crop preview"
          draggable={false}
          className="absolute inset-0 w-full h-full pointer-events-none"
          style={imageTransformStyle(value)}
        />
        {/* Hint */}
        <div className="absolute inset-0 flex items-end justify-center pb-2 pointer-events-none">
          <span className="text-[9px] text-white bg-black/40 px-2 py-0.5 rounded-full">
            drag to pan · scroll / pinch to zoom
          </span>
        </div>
      </div>
    </div>
  );
}

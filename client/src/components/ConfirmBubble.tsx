import type { ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useModalA11y } from '@/hooks/use-modal-a11y';

interface Props {
  open: boolean;
  icon?: ReactNode;
  title: string;
  message: string;
  /** The red one. Omit it when the choice being confirmed isn't destructive —
   *  an application, for instance, which still deserves a "here's what you're
   *  agreeing to" beat but has nothing to throw away. */
  destructiveLabel?: ReactNode;
  onDestructive?: () => void;
  /** The primary. Either an alternative to destroying the work ("Save draft"),
   *  or, with no destructive pair, the action itself. */
  confirmLabel?: string;
  onConfirm?: () => void;
  cancelLabel: string;
  onCancel: () => void;
}

/**
 * Small centred confirmation bubble, used wherever a click needs a beat of
 * "here's what this does" first — usually because it would throw away work
 * the user can't get back. Replaces window.confirm: same job, but it matches
 * the rest of the site and names a destructive option in red.
 */
export default function ConfirmBubble({
  open, icon, title, message,
  destructiveLabel, onDestructive,
  confirmLabel, onConfirm,
  cancelLabel, onCancel,
}: Props) {
  // Escape cancels -- the safe choice, never the destructive one. This bubble
  // guards work someone can't get back, so the fast way out must not be the
  // way that throws it away.
  const ref = useModalA11y(open, onCancel);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={e => { e.stopPropagation(); onCancel(); }}
          className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/50">
          <motion.div
            role="dialog" aria-modal="true" aria-label={title}
            initial={{ scale: 0.9, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 10 }}
            transition={{ type: 'spring', stiffness: 420, damping: 30 }}
            onClick={e => e.stopPropagation()}
            ref={ref}
            className="w-full max-w-xs rounded-2xl bg-card border border-border shadow-md p-5 space-y-4 focus:outline-none">
            <div className="flex items-start gap-3">
              {icon && (
                <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  {icon}
                </div>
              )}
              <div className="space-y-1">
                <h3 className="font-heading font-bold text-foreground leading-tight">{title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{message}</p>
              </div>
            </div>
            <div className="flex gap-2">
              {destructiveLabel && onDestructive && (
                <button onClick={onDestructive}
                  className="flex-1 min-h-[44px] rounded-xl bg-red-500 hover:bg-red-600 text-white text-xs font-semibold transition-colors cursor-pointer flex items-center justify-center gap-1.5">
                  {destructiveLabel}
                </button>
              )}
              {confirmLabel && onConfirm && (
                <button onClick={onConfirm}
                  className="flex-1 min-h-[44px] rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold transition-colors cursor-pointer">
                  {confirmLabel}
                </button>
              )}
            </div>
            {/* Text-height on its own, so it gets the floor explicitly -- this is
                the way out of the dialog and is tapped on a phone like any other. */}
            <button onClick={onCancel}
              className="w-full min-h-[44px] text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
              {cancelLabel}
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

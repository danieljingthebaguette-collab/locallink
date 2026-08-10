import type { ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface Props {
  open: boolean;
  icon?: ReactNode;
  title: string;
  message: string;
  /** The red one. Always present — this bubble exists to guard a destructive choice. */
  destructiveLabel: ReactNode;
  onDestructive: () => void;
  /** Optional primary alternative to destroying the work, e.g. "Save draft". */
  confirmLabel?: string;
  onConfirm?: () => void;
  cancelLabel: string;
  onCancel: () => void;
}

/**
 * Small centred confirmation bubble, used wherever a click would throw away
 * work the user can't get back. Replaces window.confirm — same job, but it
 * matches the rest of the site and names the destructive option in red.
 */
export default function ConfirmBubble({
  open, icon, title, message,
  destructiveLabel, onDestructive,
  confirmLabel, onConfirm,
  cancelLabel, onCancel,
}: Props) {
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
            className="w-full max-w-xs rounded-2xl bg-card border border-border shadow-2xl p-5 space-y-4">
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
              <button onClick={onDestructive}
                className="flex-1 h-9 rounded-xl bg-red-500 hover:bg-red-600 text-white text-xs font-semibold transition-colors flex items-center justify-center gap-1.5">
                {destructiveLabel}
              </button>
              {confirmLabel && onConfirm && (
                <button onClick={onConfirm}
                  className="flex-1 h-9 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold transition-colors">
                  {confirmLabel}
                </button>
              )}
            </div>
            <button onClick={onCancel}
              className="w-full text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors">
              {cancelLabel}
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

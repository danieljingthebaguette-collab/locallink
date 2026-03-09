import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquarePlus, X, Star, Loader2 } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useAuthStore } from '@/lib/store';
import { cn } from '@/lib/utils';

export default function FeedbackButton() {
  const { toast } = useToast();
  const { currentUser } = useAuthStore();
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!rating || !message.trim()) return;
    setSubmitting(true);
    try {
      const token = localStorage.getItem('locallink_token');
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          rating,
          message: message.trim(),
          userId: currentUser?.id || null,
          username: currentUser?.username || null,
        }),
      });
      if (res.ok) {
        toast({ title: 'Thanks for the feedback! 🙏', description: 'Your input helps us improve LocalLink.' });
        setOpen(false);
        setRating(0);
        setMessage('');
      } else {
        toast({ title: 'Could not submit feedback', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Network error', variant: 'destructive' });
    }
    setSubmitting(false);
  };

  return (
    <>
      {/* Floating trigger button */}
      <motion.button
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.94 }}
        onClick={() => setOpen(true)}
        className="fixed bottom-20 right-4 md:bottom-6 md:right-6 z-50 flex items-center gap-2 bg-primary text-primary-foreground rounded-full shadow-lg px-4 py-2.5 text-sm font-semibold"
        title="Share feedback"
      >
        <MessageSquarePlus className="w-4 h-4" />
        <span className="hidden sm:inline">Feedback</span>
      </motion.button>

      {/* Feedback modal */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[70] flex items-end sm:items-center justify-center p-4"
          >
            <motion.div
              initial={{ opacity: 0, y: 40, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 40, scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 380, damping: 32 }}
              onClick={e => e.stopPropagation()}
              className="w-full max-w-sm bg-card border border-border rounded-3xl shadow-2xl p-6 space-y-5"
            >
              {/* Header */}
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="font-heading font-bold text-lg text-foreground">Share your feedback</h2>
                  <p className="text-sm text-muted-foreground mt-0.5">Help us make LocalLink better</p>
                </div>
                <button onClick={() => setOpen(false)} className="p-1.5 rounded-full hover:bg-secondary transition-colors -mr-1 -mt-1">
                  <X className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>

              {/* Star rating */}
              <div className="space-y-2">
                <p className="text-xs font-bold tracking-widest uppercase text-muted-foreground">Your rating</p>
                <div className="flex gap-1.5">
                  {[1, 2, 3, 4, 5].map(star => (
                    <button
                      key={star}
                      onMouseEnter={() => setHovered(star)}
                      onMouseLeave={() => setHovered(0)}
                      onClick={() => setRating(star)}
                      className="transition-transform hover:scale-110"
                    >
                      <Star
                        className={cn(
                          'w-8 h-8 transition-colors',
                          star <= (hovered || rating)
                            ? 'fill-yellow-400 text-yellow-400'
                            : 'text-muted-foreground/30'
                        )}
                      />
                    </button>
                  ))}
                </div>
              </div>

              {/* Message */}
              <div className="space-y-2">
                <p className="text-xs font-bold tracking-widest uppercase text-muted-foreground">Your message</p>
                <Textarea
                  placeholder="What do you love? What could be better?"
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  className="rounded-xl border-border text-sm resize-none min-h-[90px]"
                />
              </div>

              {/* Submit */}
              <button
                onClick={handleSubmit}
                disabled={!rating || !message.trim() || submitting}
                className="w-full h-11 rounded-2xl bg-primary text-primary-foreground font-semibold text-sm flex items-center justify-center gap-2 transition-opacity disabled:opacity-50 hover:opacity-90"
              >
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                {submitting ? 'Submitting...' : 'Submit Feedback'}
              </button>

              {currentUser ? (
                <p className="text-[11px] text-center text-muted-foreground">
                  Submitting as <span className="font-semibold">{currentUser.username}</span>
                </p>
              ) : (
                <p className="text-[11px] text-center text-muted-foreground">Submitting anonymously</p>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

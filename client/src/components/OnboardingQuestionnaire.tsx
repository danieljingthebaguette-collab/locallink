import { useEffect, useState } from 'react';
import { X, Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useAuthStore } from '@/lib/store';
import { FIELD_TAGS } from '@/lib/mockData';
import { cn } from '@/lib/utils';

// Shown once per browser session to any volunteer who hasn't completed it —
// which covers both cases the same way: a brand-new account (never had the
// chance) and a five-month-old one that skipped it every time before. Both
// just mean onboardingCompletedAt is null; there's only one code path.
//
// "Completed" means they hit Save, not that every field is filled in — the
// form has nothing required. Skip (or Escape, or clicking the backdrop)
// dismisses for this browser session only and leaves onboardingCompletedAt
// untouched, so the prompt is back next time they open the site.
//
// The dismissed flag lives in the auth store, not local state here — the
// Profile reminder card and a bell notification both need to be able to
// force this back open, and a store both already read is simpler than a
// custom event to reach into an already-mounted component from elsewhere.
export default function OnboardingQuestionnaire({ suppressed }: { suppressed?: boolean }) {
  const { toast } = useToast();
  const {
    isLoggedIn, currentUser, submitOnboarding,
    onboardingPromptDismissed: dismissed, hideOnboardingPrompt, requestOnboardingReminder,
  } = useAuthStore();
  const [hoursSoFar, setHoursSoFar] = useState('');
  const [interests, setInterests] = useState<string[]>([]);
  const [majors, setMajors] = useState('');
  const [goalHours, setGoalHours] = useState('');
  const [goalEvents, setGoalEvents] = useState('');
  const [saving, setSaving] = useState(false);

  const open = !suppressed && !dismissed && isLoggedIn
    && currentUser?.accountType === 'volunteer'
    && !currentUser?.onboardingCompletedAt;

  // Leaving via any exit -- Skip, Escape, the backdrop -- both dismisses
  // the modal and leaves the standing reminders (Profile card, bell) in
  // place. The server dedupes the bell entry to one per account, so firing
  // this on every skip is fine, not something worth guarding client-side.
  const skip = () => {
    hideOnboardingPrompt();
    requestOnboardingReminder();
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) skip(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const toggleInterest = (tag: string) => {
    setInterests(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);
  };

  const handleSave = async () => {
    setSaving(true);
    const result = await submitOnboarding({
      hoursSoFar: hoursSoFar.trim() ? Number(hoursSoFar) : null,
      interests,
      majors: majors.trim(),
      goalHours: goalHours.trim() ? Number(goalHours) : null,
      goalEvents: goalEvents.trim() ? Number(goalEvents) : null,
    });
    setSaving(false);
    if (result.success) {
      toast({ title: 'Thanks! We\'ll use this to help you find a good fit.' });
    } else {
      toast({ title: result.error || 'Could not save your answers', variant: 'destructive' });
    }
  };

  return (
    <div
      className="fixed inset-0 z-[75] bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
      onClick={skip}
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
    >
      <div
        className="w-full max-w-lg rounded-3xl bg-card border border-border shadow-2xl p-6 md:p-8 max-h-[85vh] overflow-y-auto relative"
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={skip}
          aria-label="Skip for now"
          className="absolute top-4 right-4 p-2 rounded-full hover:bg-secondary transition-colors"
        >
          <X className="w-4 h-4 text-muted-foreground" />
        </button>

        <div className="w-11 h-11 rounded-full bg-primary/10 flex items-center justify-center mb-4">
          <Sparkles className="w-5 h-5 text-primary" />
        </div>
        <h2 id="onboarding-title" className="font-heading font-bold text-xl text-foreground pr-8">
          Tell us a bit about you
        </h2>
        <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
          Helps us show opportunities that actually fit. Every question here is optional —
          answer what you'd like and skip the rest.
        </p>

        <div className="mt-6 space-y-5">
          <div>
            <label htmlFor="onboarding-hours" className="text-xs font-bold tracking-widest uppercase text-muted-foreground mb-2 block">
              Volunteer hours you've done before
            </label>
            <Input
              id="onboarding-hours"
              type="number"
              min={0}
              placeholder="0"
              value={hoursSoFar}
              onChange={e => setHoursSoFar(e.target.value)}
              className="rounded-xl h-11 w-32"
            />
          </div>

          <div>
            <label className="text-xs font-bold tracking-widest uppercase text-muted-foreground mb-2 block">
              What kinds of things do you enjoy?
            </label>
            <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto pr-1">
              {FIELD_TAGS.map(tag => {
                const active = interests.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleInterest(tag)}
                    className={cn(
                      'px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors',
                      active
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background text-foreground border-border hover:border-primary/50'
                    )}
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label htmlFor="onboarding-majors" className="text-xs font-bold tracking-widest uppercase text-muted-foreground mb-2 block">
              Majors or fields you're considering
            </label>
            <Textarea
              id="onboarding-majors"
              placeholder="e.g. biology, education, undecided..."
              value={majors}
              onChange={e => setMajors(e.target.value)}
              className="rounded-xl min-h-[64px] resize-none"
              maxLength={200}
            />
          </div>

          <div>
            <label className="text-xs font-bold tracking-widest uppercase text-muted-foreground mb-2 block">
              Goals for this year
            </label>
            <div className="flex gap-3">
              <div className="flex-1">
                <Input
                  type="number"
                  min={0}
                  placeholder="Hours"
                  value={goalHours}
                  onChange={e => setGoalHours(e.target.value)}
                  className="rounded-xl h-11"
                  aria-label="Hours goal"
                />
              </div>
              <div className="flex-1">
                <Input
                  type="number"
                  min={0}
                  placeholder="Events"
                  value={goalEvents}
                  onChange={e => setGoalEvents(e.target.value)}
                  className="rounded-xl h-11"
                  aria-label="Events goal"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="mt-7 flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
          <Button variant="outline" onClick={skip} disabled={saving} className="rounded-full">
            Skip for now
          </Button>
          <Button onClick={handleSave} disabled={saving} className="rounded-full">
            {saving && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}

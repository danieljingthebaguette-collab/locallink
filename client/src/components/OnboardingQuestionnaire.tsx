import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Search, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useAuthStore } from '@/lib/store';
import { AVAILABILITY_OPTIONS, FIELD_TAGS, TOWNS } from '@/lib/mockData';
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
//
// Four steps, not one long scroll -- but "every question is optional, skip
// the rest" still has to survive the trip to a wizard. Continue never checks
// whether the current step has anything filled in; it just moves forward,
// same as scrolling past a blank field used to. The only thing a step count
// buys is guided pacing, not gating.
type Step = 0 | 1 | 2 | 3;
const STEP_COUNT = 4;
const STEP_TITLES = ['About you', 'What you enjoy', 'Where & when', 'Your goals'];

export default function OnboardingQuestionnaire({ suppressed }: { suppressed?: boolean }) {
  const { toast } = useToast();
  const {
    isLoggedIn, currentUser, submitOnboarding,
    onboardingPromptDismissed: dismissed, onboardingRequested: requested,
    hideOnboardingPrompt, requestOnboardingReminder,
  } = useAuthStore();
  const [step, setStep] = useState<Step>(0);
  const [hoursSoFar, setHoursSoFar] = useState('');
  const [interests, setInterests] = useState<string[]>([]);
  const [tagSearch, setTagSearch] = useState('');
  const [majors, setMajors] = useState('');
  const [towns, setTowns] = useState<string[]>([]);
  const [availability, setAvailability] = useState<string[]>([]);
  const [goalHours, setGoalHours] = useState('');
  const [goalEvents, setGoalEvents] = useState('');
  const [saving, setSaving] = useState(false);

  // hasSeenWelcome gates the prompt appearing on its own, so a brand-new
  // volunteer meets the "Here's how it works" card before being asked about
  // themselves. Nothing sequenced the two, and this modal is fixed and
  // full-screen, so it simply covered the card and reappeared behind it on
  // skip. Existing accounts are unaffected -- the column was added DEFAULT 1
  // and only new registrations start at 0.
  //
  // onboardingRequested overrides that gate. Someone who taps the bell or
  // follows the link in the nudge email has asked for this outright, and
  // first-run tidiness is no reason to refuse them.
  // The welcome card is only dismissible on the board, so gating purely on
  // hasSeenWelcome would silence the questionnaire forever for anyone who
  // never clicks "Got it" -- the gate is meant to order someone's first
  // minute, not to exclude them. After a day the first run is over either
  // way, so it stops applying.
  const pastFirstRun = currentUser?.createdAt
    ? Date.now() - new Date(currentUser.createdAt).getTime() > 24 * 60 * 60 * 1000
    : true;

  const open = !suppressed && !dismissed && isLoggedIn
    && currentUser?.accountType === 'volunteer'
    && (currentUser?.hasSeenWelcome || requested || pastFirstRun)
    && !currentUser?.onboardingCompletedAt;

  // Always reopens on step 1, with empty fields.
  //
  // Clearing the fields is not tidiness, it is correctness: this component is
  // mounted once at the app root and exits by returning null, so it never
  // unmounts and its state outlives the account that typed it. On a shared
  // computer that meant one volunteer could close a half-filled form, log
  // out, and the next person to log in would find the questionnaire already
  // holding someone else's answers -- and saving would write them to their
  // own account.
  useEffect(() => {
    if (!open) return;
    setStep(0);
    setHoursSoFar('');
    setInterests([]);
    setTagSearch('');
    setMajors('');
    setTowns([]);
    setAvailability([]);
    setGoalHours('');
    setGoalEvents('');
  }, [open, currentUser?.id]);

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
  const toggleTown = (town: string) => {
    setTowns(prev => prev.includes(town) ? prev.filter(t => t !== town) : [...prev, town]);
  };
  const toggleAvailability = (id: string) => {
    setAvailability(prev => prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id]);
  };

  const filteredTags = FIELD_TAGS.filter(t => t.toLowerCase().includes(tagSearch.toLowerCase()));

  // Whether there is anything worth keeping. Save used to live on the last
  // step only, with "Skip for now" sitting beside it the whole way through --
  // so answering step one and leaving threw the answers away without a word,
  // while the intro promised "answer what you'd like and skip the rest".
  const hasAnswers = Boolean(
    hoursSoFar.trim() || majors.trim() || goalHours.trim() || goalEvents.trim() ||
    interests.length || towns.length || availability.length
  );

  const handleSave = async () => {
    setSaving(true);
    const result = await submitOnboarding({
      hoursSoFar: hoursSoFar.trim() ? Number(hoursSoFar) : null,
      interests,
      majors: majors.trim(),
      towns,
      availability,
      goalHours: goalHours.trim() ? Number(goalHours) : null,
      goalEvents: goalEvents.trim() ? Number(goalEvents) : null,
    });
    setSaving(false);
    if (result.success) {
      // No hide needed: submitOnboarding merges onboardingCompletedAt into
      // currentUser, and that is what `open` is gated on.
      toast({ title: 'Thanks! We\'ll use this to help you find a good fit.' });
    } else {
      toast({ title: result.error || 'Could not save your answers', variant: 'destructive' });
    }
  };

  const chipClass = (active: boolean) => cn(
    'px-3 py-1.5 rounded-md text-xs font-semibold border transition-colors',
    active
      ? 'bg-primary text-primary-foreground border-primary'
      : 'bg-background text-foreground border-border hover:border-primary/50'
  );

  return (
    <div
      className="fixed inset-0 z-[75] bg-black/50 flex items-end sm:items-center justify-center p-4"
      onClick={skip}
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
    >
      <div
        className="w-full max-w-lg rounded-3xl bg-card border border-border shadow-md p-6 md:p-8 max-h-[85vh] overflow-y-auto relative flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={skip}
          aria-label={hasAnswers ? 'Close without saving' : 'Skip for now'}
          className="absolute top-4 right-4 p-2 rounded-md hover:bg-secondary transition-colors"
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

        {/* Step indicator -- same "Step X of Y" + dot-progress convention the
            post-creation form already uses, so this doesn't introduce a third
            way of showing progress in the app. */}
        <div className="mt-5 flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            {Array.from({ length: STEP_COUNT }, (_, i) => (
              <div key={i} className={cn('h-1.5 rounded-full transition-all duration-300',
                i === step ? 'w-6 bg-primary' : 'w-3 bg-border')} />
            ))}
          </div>
          <span className="text-xs font-bold tracking-widest uppercase text-muted-foreground">
            Step {step + 1} of {STEP_COUNT} — {STEP_TITLES[step]}
          </span>
        </div>

        <div className="mt-5 space-y-5 flex-1">
          {step === 0 && (
            <>
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
            </>
          )}

          {step === 1 && (
            <div>
              <label className="text-xs font-bold tracking-widest uppercase text-muted-foreground mb-2 block">
                What kinds of things do you enjoy?
              </label>
              <div className="relative mb-2">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search..."
                  value={tagSearch}
                  onChange={e => setTagSearch(e.target.value)}
                  className="rounded-xl h-9 pl-8 text-sm"
                />
              </div>
              <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto pr-1">
                {filteredTags.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 w-full text-center">No matches for "{tagSearch}"</p>
                ) : filteredTags.map(tag => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleInterest(tag)}
                    className={chipClass(interests.includes(tag))}
                  >
                    {tag}
                  </button>
                ))}
              </div>
              {interests.length > 0 && (
                <p className="text-xs text-muted-foreground mt-2">{interests.length} selected</p>
              )}
            </div>
          )}

          {step === 2 && (
            <>
              <div>
                <label className="text-xs font-bold tracking-widest uppercase text-muted-foreground mb-2 block">
                  Towns that work for you
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {TOWNS.map(town => (
                    <button
                      key={town}
                      type="button"
                      onClick={() => toggleTown(town)}
                      className={chipClass(towns.includes(town))}
                    >
                      {town}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-bold tracking-widest uppercase text-muted-foreground mb-2 block">
                  When you're usually free
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {AVAILABILITY_OPTIONS.map(opt => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => toggleAvailability(opt.id)}
                      className={chipClass(availability.includes(opt.id))}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {step === 3 && (
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
          )}
        </div>

        {/* Four bordered buttons never fit this panel: at 375px the old
            single row needed 351px of button in 293px of room and pushed
            Continue clean off the screen, and even at desktop width the
            panel is 512px against ~521px of controls. Leaving is also not a
            peer of Back/Save/Continue, so it stops pretending to be one --
            the three actions keep one row at every width, and the way out
            sits under them as quiet text. */}
        <div className="mt-7 flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-end gap-2">
          {step > 0 && (
            <Button variant="outline" onClick={() => setStep(s => (s - 1) as Step)} disabled={saving} className="rounded-md">
              <ChevronLeft className="w-4 h-4 mr-1" /> Back
            </Button>
          )}
          {step < STEP_COUNT - 1 && hasAnswers && (
            <Button variant="outline" onClick={handleSave} disabled={saving} className="rounded-md">
              {saving && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
              Save &amp; finish
            </Button>
          )}
          {step < STEP_COUNT - 1 ? (
            <Button onClick={() => setStep(s => (s + 1) as Step)} disabled={saving} className="rounded-md">
              Continue <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          ) : (
            <Button onClick={handleSave} disabled={saving} className="rounded-md">
              {saving && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
              Save
            </Button>
          )}
          </div>
          {/* Says what it actually does once there is something to lose. "Skip
              for now" reads like "ask me later" -- fine on an empty form, but
              a lie next to half-filled answers it is about to throw away. */}
          <button
            type="button"
            onClick={skip}
            disabled={saving}
            className="self-start text-sm font-medium text-muted-foreground hover:text-foreground underline underline-offset-4 disabled:opacity-50 cursor-pointer"
          >
            {hasAnswers ? 'Close without saving' : 'Skip for now'}
          </button>
        </div>
      </div>
    </div>
  );
}

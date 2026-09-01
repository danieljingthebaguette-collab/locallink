import { useEffect, useState } from 'react';
import { Bell, Share, Plus, X, Check, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useAuthStore } from '@/lib/store';
import {
  pushSupported, isIos, isStandalone, needsInstallFirst, permission, enablePush, iosBrowser,
} from '@/lib/push';

const SEEN_KEY = 'locallink_loop_prompt_seen';

/**
 * Shown once to a signed-in person who hasn't been asked yet, offering the two
 * ways to hear from LocalLink when they're not looking at it.
 *
 * Which of the two it offers depends on the device, because on iPhone the
 * choice isn't a choice: Safari cannot request notification permission at all
 * until the site is on the Home Screen. So an iPhone gets install instructions
 * and no notification button, and everyone else gets the button.
 *
 * Dismissal is remembered in localStorage rather than sessionStorage -- being
 * asked this on every visit would be worse than never asking. Declining is
 * final from the app's side; the Profile page is where someone changes their
 * mind later.
 */
export default function StayInTheLoop({ suppressed }: { suppressed?: boolean }) {
  const { toast } = useToast();
  const { isLoggedIn, currentUser, onboardingPromptDismissed } = useAuthStore();

  // The questionnaire gets the first word. It is showing whenever a volunteer
  // hasn't finished it and hasn't waved it away this session, and stacking this
  // on top of it would bury both.
  const questionnaireShowing = !suppressed
    && currentUser?.accountType === 'volunteer'
    && !currentUser?.onboardingCompletedAt
    && !onboardingPromptDismissed;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isLoggedIn || suppressed || questionnaireShowing) return;
    if (localStorage.getItem(SEEN_KEY)) return;
    // Nothing to offer: already installed AND already granted.
    if (isStandalone() && permission() === 'granted') return;
    // Already granted in a normal browser tab, and not an iPhone: also nothing to ask.
    if (!isIos() && permission() === 'granted') return;
    if (!pushSupported() && !isIos()) return;
    const t = setTimeout(() => setOpen(true), 1200); // let the board paint first
    return () => clearTimeout(t);
  }, [isLoggedIn, suppressed, questionnaireShowing]);

  const close = (remember = true) => {
    if (remember) localStorage.setItem(SEEN_KEY, '1');
    setOpen(false);
  };

  const turnOn = async () => {
    setBusy(true);
    const r = await enablePush();
    setBusy(false);
    if (r.ok) {
      toast({ title: 'Notifications are on', description: "We'll let you know when something matters." });
      close();
    } else {
      toast({ title: "Couldn't turn them on", description: r.reason, variant: 'destructive' });
    }
  };

  if (!open) return null;

  const iosNeedsInstall = needsInstallFirst();
  // Every iOS browser is WebKit underneath, so they all share Safari's
  // restriction — but not Safari's toolbar. Sending a Chrome user to "Share at
  // the bottom" points at a button that isn't there.
  const inSafari = iosBrowser() === 'safari';

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-[2px]">
      <div className="w-full max-w-md rounded-2xl bg-card border border-border shadow-lg p-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-md bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
              {iosNeedsInstall ? <Smartphone className="w-5 h-5" /> : <Bell className="w-5 h-5" />}
            </div>
            <h2 className="font-heading font-bold text-lg text-foreground leading-tight">
              Don't miss an opportunity
            </h2>
          </div>
          <button onClick={() => close()} aria-label="Not now"
            className="p-1.5 rounded-md text-muted-foreground hover:bg-secondary flex-shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        {iosNeedsInstall ? (
          <>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Add LocalLink to your Home Screen and it opens like an app — and it's the only
              way iPhone can send you notifications when a spot opens up.
            </p>
            <ol className="text-sm text-foreground space-y-2.5">
              {!inSafari && (
                <li className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-secondary text-[11px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">1</span>
                  <span>Open localnetlink.com in <strong className="font-semibold">Safari</strong> — only Safari can do this on iPhone</span>
                </li>
              )}
              <li className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-secondary text-[11px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{inSafari ? 1 : 2}</span>
                <span>Tap <Share className="w-4 h-4 inline mx-0.5 text-primary" /> Share at the bottom</span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-secondary text-[11px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{inSafari ? 2 : 3}</span>
                <span>Choose <Plus className="w-4 h-4 inline mx-0.5 text-primary" /> Add to Home Screen</span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-secondary text-[11px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{inSafari ? 3 : 4}</span>
                <span>Open LocalLink from your Home Screen and turn on notifications</span>
              </li>
            </ol>
            <Button onClick={() => close()} className="w-full rounded-md">Got it</Button>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Turn on notifications and we'll tell you when an organization replies, when a post
              you're interested in changes, or when a weekly event opens again. Nothing else.
            </p>
            <div className="flex flex-col gap-2">
              <Button onClick={turnOn} disabled={busy} className="w-full rounded-md">
                {busy ? 'Turning on…' : <><Check className="w-4 h-4 mr-1.5" /> Turn on notifications</>}
              </Button>
              <Button variant="ghost" onClick={() => close()} className="w-full rounded-md text-muted-foreground">
                Not now
              </Button>
            </div>
            {!isStandalone() && (
              <p className="text-xs text-muted-foreground text-center">
                You can also add LocalLink to your home screen to open it like an app.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

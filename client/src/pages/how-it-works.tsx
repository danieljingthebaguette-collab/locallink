import { useState } from 'react';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/lib/store';
import {
  Search, Check, QrCode, Award, Plus, Users, Play, Download, Trophy,
  HelpCircle, Clock, Pause, ShieldCheck,
} from 'lucide-react';

type Role = 'volunteer' | 'organization';

interface Step {
  n: number;
  title: string;
  body: string;
  Icon: typeof Search;
}

const VOLUNTEER_STEPS: Step[] = [
  { n: 1, Icon: Search, title: 'Find something you want to do',
    body: 'Browse the board or filter by cause and town. Tap “I’m Interested” on anything you might go to — it’s just a bookmark, and you can change your mind.' },
  { n: 2, Icon: Check, title: 'Commit when you know you’re going',
    body: 'Open the event and press “I’m Committing.” This is what puts you on the organization’s list, so they know to expect you. You can undo it any time.' },
  { n: 3, Icon: QrCode, title: 'Scan the code when you arrive — and again when you leave',
    body: 'The organization will have a QR code on a screen or printed out. Point your phone camera at it to start your hours, and scan the same code again on your way out to stop them.' },
  { n: 4, Icon: Award, title: 'Your hours land on your profile',
    body: 'Verified by the organization, counted automatically. Check the Hours Verified tile on your Profile any time.' },
  { n: 5, Icon: Trophy, title: 'Ask for a certificate at 10, 25, 50 and 100 hours',
    body: 'Those are hours with a single organization. When you pass one we\u2019ll tell you, and an Apply link appears on your profile. That organization confirms it \u2014 the certificate carries their name \u2014 and then LocalLink issues it as a printable document. Your total across every organization is also recognised, at 50, 100, 250 and 500 hours, automatically.' },
];

const ORG_STEPS: Step[] = [
  { n: 1, Icon: Plus, title: 'Post your opportunity',
    body: 'Create it from My Events or the + button. An admin reviews new posts before they go live on the board.' },
  { n: 2, Icon: Users, title: 'Watch who commits',
    body: 'Interested means someone is considering it. Committed means they’re telling you they’ll be there — only committed volunteers appear on your attendance list.' },
  { n: 3, Icon: Play, title: 'Start the event when it begins',
    body: 'Open Attendance on your event and press Start. Set the time it should stop on its own, so nobody’s hours run overnight if you forget. You can also schedule it to start by itself.' },
  { n: 4, Icon: QrCode, title: 'Show the QR code',
    body: 'Print it, or pull it up on a phone or laptop at the door. Volunteers scan it to check in and out. That’s the only thing you have to do during the event.' },
  { n: 5, Icon: Download, title: 'Download the spreadsheet',
    body: 'When the event ends, everyone’s hours are already recorded. Fix anything that’s wrong, then export the list as a spreadsheet.' },
  { n: 6, Icon: Trophy, title: 'Confirm certificate requests',
    body: 'Volunteers who pass 10, 25, 50 or 100 hours with you can request a certificate. It carries your organization’s name, so you confirm it in My Events before LocalLink issues it.' },
];

const VOLUNTEER_FAQ = [
  { q: 'My phone died and I couldn’t scan.', a: 'Open the event’s check-in page after it ends and press “I was there.” The organization gets a request and confirms your hours. It doesn’t give you hours on its own — they have to approve it.' },
  { q: 'Where do I find the check-in link on the day?', a: 'We email it to you the morning of the event, if you committed. You can also scan the QR code the organization has there — it goes to the same place.' },
  { q: 'It’s asking for a code.', a: 'Some organizations turn on a short code that only appears on their own screen at the event. Ask whoever is running it — that’s how they make sure only people who actually showed up can check in.' },
  { q: 'I have to leave and come back.', a: 'Scan out when you go and scan in again when you return. Your hours add up across both, and any time the organization pauses the event isn’t counted.' },
  { q: 'I forgot to scan out.', a: 'Nothing breaks. Your hours close automatically when the organization ends the event. If you actually stayed longer, ask them to adjust it.' },
  { q: 'Can I enter my own hours?', a: 'No — and that’s the point. Every hour on your profile was confirmed by the organization you did it with, which is what makes them worth showing to a school.' },
  { q: 'My certificate request was declined.', a: 'You can apply again once whatever the organization asked about is sorted out — a decline isn’t permanent. The reason they gave shows on your profile.' },
  { q: 'My certificate stopped working.', a: 'A certificate is only valid while the hours behind it stand. If the organization later adjusts those hours below the milestone, it retires itself — and comes back on its own if the hours are restored.' },
];

const ORG_FAQ = [
  { q: 'Someone came but couldn’t scan.', a: 'Find them on the list and press “Mark as came.” If they’re not on the list at all, they can press “I was there” on their end and you’ll get a request to confirm.' },
  { q: 'We took a lunch break.', a: 'Press Pause. Everyone’s clock stops and picks back up when you press Resume — nobody gets credit for the break, and you don’t have to fix anything afterward.' },
  { q: 'I forgot to press Stop.', a: 'The auto-stop time you set when starting closes everyone out for you. Hours never run past it, even if you don’t open the page until the next day.' },
  { q: 'Someone stayed longer than the event was listed for.', a: 'The list flags them. Press “Set hours” on their row and type the real number — that sticks and won’t be recalculated.' },
  { q: 'We have volunteers who don’t come from LocalLink.', a: 'The list only covers people who found you here. It’s meant to sit alongside however you already track everyone else, not replace it.' },
  { q: 'What if there’s no signal at our venue?', a: 'Nothing has to happen live. Start the event, and if scanning doesn’t work, mark people present from your own device afterward — hours can be entered and corrected any time.' },
  { q: 'Why am I being asked to confirm a certificate?', a: 'Because it will say the volunteer served with your organization. You already verified the hours — this is a last check before LocalLink issues something carrying your name.' },
  { q: 'Can I delete an old event?', a: 'Only if nobody earned hours at it. Once volunteers have hours from an event, those are on their profiles and possibly behind a certificate, so close it instead — that stops sign-ups and keeps the record intact.' },
];

/** Plain instructions for the attendance tracker, split by who's reading.
 * Reachable from the main nav rather than buried in About: an organization
 * about to run its first event needs something to read beforehand, and a
 * volunteer standing at a door needs an answer in one tap. */
export default function HowItWorks() {
  const [, navigate] = useLocation();
  const { currentUser } = useAuthStore();
  // Default to whichever role the reader actually is, but let anyone flip —
  // volunteers are curious what the organization sees, and organizations
  // need to know what they're asking volunteers to do.
  const [role, setRole] = useState<Role>(
    currentUser?.accountType === 'organization' ? 'organization' : 'volunteer'
  );

  const steps = role === 'volunteer' ? VOLUNTEER_STEPS : ORG_STEPS;
  const faq = role === 'volunteer' ? VOLUNTEER_FAQ : ORG_FAQ;

  return (
    <div className="min-h-screen bg-background pb-24 font-sans">
      <main className="container mx-auto px-4 py-10 max-w-2xl">
        <h1 className="text-3xl md:text-4xl font-heading font-bold text-foreground">How It Works</h1>
        <p className="text-muted-foreground mt-2 mb-6">
          Signing up, showing up, and getting your hours counted.
        </p>

        {/* Role switch */}
        <div className="inline-flex rounded-full border border-border p-1 mb-8" role="tablist" aria-label="Who are you?">
          {(['volunteer', 'organization'] as Role[]).map(r => (
            <button
              key={r}
              role="tab"
              aria-selected={role === r}
              onClick={() => setRole(r)}
              className={cn(
                'px-4 py-1.5 rounded-full text-sm font-semibold transition-colors',
                role === r ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {r === 'volunteer' ? "I'm a volunteer" : "I'm an organization"}
            </button>
          ))}
        </div>

        {/* Steps */}
        <ol className="space-y-5 mb-10">
          {steps.map(s => (
            <li key={s.n} className="flex items-start gap-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-2xl bg-primary/10 text-primary flex items-center justify-center">
                <s.Icon className="w-5 h-5" />
              </div>
              <div className="min-w-0 pt-0.5">
                <p className="font-heading font-bold text-foreground">
                  <span className="text-muted-foreground tabular-nums mr-2">{s.n}</span>
                  {s.title}
                </p>
                <p className="text-sm text-muted-foreground leading-relaxed mt-1">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>

        {/* The one promise worth stating outright, to both audiences. */}
        <div className="rounded-2xl border border-border bg-secondary/30 p-5 mb-10 flex items-start gap-3.5">
          <ShieldCheck className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-sm text-foreground">Hours are never self-reported</p>
            <p className="text-sm text-muted-foreground leading-relaxed mt-1">
              {role === 'volunteer'
                ? 'You can’t type in your own hours, and neither can anyone else. Every hour on your profile came from scanning at a real event or from the organization confirming it — that’s what makes them count.'
                : 'Volunteers can’t enter their own hours. Everything on your list came from a scan at your event or from you confirming it, so the numbers you export are ones you stand behind.'}
            </p>
          </div>
        </div>

        {/* Quick reference for the states people will actually see */}
        {role === 'organization' && (
          <section className="mb-10">
            <h2 className="text-lg font-heading font-bold text-foreground mb-3">What the list is telling you</h2>
            <ul className="rounded-2xl border border-border divide-y divide-border overflow-hidden">
              {[
                ['Coming', 'Committed to the event, hasn’t checked in yet.'],
                ['Here now', 'Checked in and currently on site — their hours are counting up.'],
                ['Left', 'Checked out. Their hours are final.'],
                ['Says they came', 'Missed the scan and is asking you to confirm. Needs a yes or no from you.'],
                ['Didn’t come', 'You ran the event and they never checked in.'],
                ['Removed', 'You took their hours back.'],
              ].map(([label, meaning]) => (
                <li key={label} className="flex items-start gap-3 px-4 py-3">
                  <span className="text-xs font-bold text-foreground w-28 flex-shrink-0">{label}</span>
                  <span className="text-sm text-muted-foreground">{meaning}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* FAQ */}
        <section className="mb-10">
          <h2 className="text-lg font-heading font-bold text-foreground mb-3 flex items-center gap-2">
            <HelpCircle className="w-5 h-5 text-primary" /> If something goes wrong
          </h2>
          <div className="space-y-3">
            {faq.map(({ q, a }) => (
              <details key={q} className="rounded-2xl border border-border bg-card px-4 py-3 group">
                <summary className="font-semibold text-sm text-foreground cursor-pointer list-none flex items-center justify-between gap-3">
                  {q}
                  <span className="text-muted-foreground text-xs flex-shrink-0 group-open:rotate-180 transition-transform">▾</span>
                </summary>
                <p className="text-sm text-muted-foreground leading-relaxed mt-2">{a}</p>
              </details>
            ))}
          </div>
        </section>

        <div className="flex flex-wrap gap-3">
          <Button onClick={() => navigate('/')} className="rounded-full px-6">
            {role === 'volunteer' ? 'Browse opportunities' : 'Go to the board'}
          </Button>
          <Button onClick={() => navigate('/my-events')} variant="outline" className="rounded-full px-6">
            {role === 'volunteer' ? 'My events' : 'My events & attendance'}
          </Button>
        </div>
      </main>
    </div>
  );
}

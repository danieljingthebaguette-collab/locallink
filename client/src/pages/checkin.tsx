import { useEffect, useState } from 'react';
import { useParams, useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/lib/store';
import { Loader2, MapPin, CheckCircle2, Clock, PauseCircle } from 'lucide-react';

type SessionStatus = 'none' | 'scheduled' | 'running' | 'paused' | 'stopped';

interface StatusResponse {
  sessionStatus: SessionStatus;
  autoStopAt: string | null;
  autoStartAt: string | null;
  startedAt: string | null;
  pinRequired: boolean;
  checkedIn: boolean;
  openSince: string | null;
  segments: number;
  hoursSoFar: number;
  hoursLocked: boolean;
  signedUp: boolean;
  committed: boolean;
  attendance: { hoursVerified: number | null; status: 'credited' | 'rejected' | 'requested' } | null;
}

interface OppSummary {
  id: string;
  title: string;
  location: string;
  hostName: string;
  duration: number;
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('locallink_token');
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

/** Reads "1h 24m" from a millisecond span. Minutes only under an hour —
 * seconds tick too fast to be anything but noise on a volunteer's screen. */
function formatElapsed(ms: number): string {
  const mins = Math.max(0, Math.floor(ms / 60_000));
  const h = Math.floor(mins / 60);
  return h ? `${h}h ${mins % 60}m` : `${mins}m`;
}

/** What a volunteer lands on after scanning the event's code, or tapping it
 * from a pre-event email. No nav entry — reached only via that link, same as
 * /org/:id.
 *
 * The same code does both scans: pointing a camera at it checks you in, and
 * pointing at it again checks you out. Leaving and coming back is allowed
 * for as long as the organization's session is running, so the page is a
 * toggle, not a one-shot. */
export default function CheckIn() {
  const params = useParams<{ opportunityId: string }>();
  const [, navigate] = useLocation();
  const { isLoggedIn, currentUser } = useAuthStore();

  const [opp, setOpp] = useState<OppSummary | null>(null);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [now, setNow] = useState(Date.now());
  // When the displayed hoursSoFar was measured. The clock below counts up
  // from that instant rather than from check-in, because hoursSoFar already
  // has paused time subtracted and raw elapsed does not — counting from
  // check-in would quietly promise a volunteer time they won't be credited.
  const [fetchedAt, setFetchedAt] = useState(Date.now());
  const [pin, setPin] = useState('');

  const loadStatus = async (): Promise<StatusResponse | null> => {
    const res = await fetch(`/api/checkin/${params.opportunityId}/status`, { headers: authHeaders() });
    if (!res.ok) return null;
    const json: StatusResponse = await res.json();
    setStatus(json);
    setFetchedAt(Date.now());
    setNow(Date.now());
    return json;
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const oppRes = await fetch(`/api/opportunities/${params.opportunityId}`);
      if (cancelled) return;
      if (!oppRes.ok) { setError('Event not found'); setLoading(false); return; }
      setOpp(await oppRes.json());
      if (isLoggedIn && !cancelled) await loadStatus();
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.opportunityId, isLoggedIn]);

  // Tick the local clock while running, and re-sync with the server
  // periodically so a pause or stop by the organizer shows up here without
  // the volunteer having to reload the page.
  useEffect(() => {
    if (!status?.checkedIn || status.sessionStatus !== 'running') return;
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    const resync = setInterval(() => { loadStatus(); }, 60_000);
    setNow(Date.now());
    return () => { clearInterval(tick); clearInterval(resync); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.checkedIn, status?.sessionStatus]);

  const scan = async () => {
    setActing(true);
    setError(null);
    try {
      const res = await fetch(`/api/checkin/${params.opportunityId}`, {
        method: 'POST', headers: authHeaders(), body: JSON.stringify({ pin }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error || 'Could not check in');
      else setPin('');
      await loadStatus();
    } finally {
      setActing(false);
    }
  };

  const requestHours = async () => {
    setActing(true);
    setError(null);
    try {
      const res = await fetch(`/api/opportunities/${params.opportunityId}/request-hours`, {
        method: 'POST', headers: authHeaders(), body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error || 'Could not send that request');
      await loadStatus();
    } finally {
      setActing(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error && !opp) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <p className="text-muted-foreground">This check-in link isn't valid.</p>
      </div>
    );
  }
  if (!opp) return null;

  if (!isLoggedIn || !currentUser) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4 text-center">
        <div>
          <p className="font-heading font-bold text-xl text-foreground mb-2">Log in to check in</p>
          <p className="text-muted-foreground text-sm mb-6">You need an account to check in to "{opp.title}."</p>
          <Button onClick={() => navigate('/account')} className="rounded-full px-8">Log In</Button>
        </div>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  // Server-measured hours (already net of any pauses) plus whatever has
  // elapsed since that measurement. Never raw check-in-to-now, which would
  // count paused time the volunteer will not actually be credited for.
  const liveMs = status.hoursSoFar * 3_600_000
    + (status.sessionStatus === 'running' && status.checkedIn ? Math.max(0, now - fetchedAt) : 0);
  const finished = status.sessionStatus === 'stopped';

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="rounded-3xl border border-primary/20 bg-gradient-to-br from-primary/[0.08] to-transparent p-6 mb-5">
          <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{opp.hostName}</p>
          <h1 className="font-heading font-bold text-xl text-foreground mt-1">{opp.title}</h1>
          <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-2">
            <MapPin className="w-3.5 h-3.5" /> {opp.location}
          </p>
        </div>

        {/* No session at all yet — scanning still works, the first scan opens
            one, so this is information, not a wall. */}
        {status.sessionStatus === 'none' && !status.checkedIn && (
          <p className="text-sm text-muted-foreground text-center mb-3">
            {opp.hostName} hasn't started this event yet. Checking in will start your hours.
          </p>
        )}

        {/* The org scheduled a specific start time — unlike 'none', scanning
            early does NOT open it. The organizer controls exactly when
            volunteers' hours can start; this is a wall, not a hint. */}
        {status.sessionStatus === 'scheduled' && !status.checkedIn && (
          <p className="text-sm text-muted-foreground text-center mb-3">
            {opp.hostName} has this scheduled to start
            {status.autoStartAt && ` at ${new Date(status.autoStartAt).toLocaleString(undefined, { hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' })}`}.
          </p>
        )}

        {status.sessionStatus === 'paused' && (
          <div className="rounded-2xl border border-border bg-secondary/40 px-4 py-3 mb-4 flex items-start gap-3">
            <PauseCircle className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-0.5" />
            <p className="text-sm text-muted-foreground">
              {opp.hostName} paused the event. Your hours are on hold and will pick back up when they resume.
            </p>
          </div>
        )}

        {/* Checked in and the clock is live. When the organizer has already
            set this person's hours by hand, the clock is replaced by that
            fixed figure — running a timer against a number that can no
            longer change would promise time they'll never be credited. */}
        {status.checkedIn && !finished && (
          <div className="text-center py-5 mb-2">
            <div className="w-12 h-12 rounded-full bg-emerald-500/15 flex items-center justify-center mx-auto mb-3">
              <Clock className="w-6 h-6 text-emerald-500" />
            </div>
            <p className="font-heading font-bold text-2xl text-foreground tabular-nums">
              {status.hoursLocked ? `${status.hoursSoFar} hrs` : formatElapsed(liveMs)}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              {status.hoursLocked
                ? `Set by ${opp.hostName}`
                : status.sessionStatus === 'paused' ? 'Paused' : "You're checked in"}
            </p>
          </div>
        )}

        {/* Checked out mid-event — they can come back. */}
        {!status.checkedIn && status.segments > 0 && !finished && (
          <div className="text-center py-5 mb-2">
            <p className="font-heading font-bold text-2xl text-foreground tabular-nums">{status.hoursSoFar} hrs</p>
            <p className="text-sm text-muted-foreground mt-1">Checked out — scan again if you come back.</p>
          </div>
        )}

        {/* Only on the way in, and only when the organizer turned it on. The
            code lives on their screen at the event, so having it is what
            stands in for being there. */}
        {status.pinRequired && !finished && (
          <div className="mb-3">
            <label htmlFor="checkin-pin" className="block text-sm text-muted-foreground text-center mb-2">
              Enter the code {opp.hostName} is showing
            </label>
            <input
              id="checkin-pin"
              value={pin}
              onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="4-digit code"
              className="w-full rounded-2xl border border-border bg-background px-4 h-12 text-center text-xl tracking-[0.4em] tabular-nums text-foreground"
            />
          </div>
        )}

        {error && <p className="text-sm text-red-500 text-center mb-3">{error}</p>}

        {!finished && (
          <Button onClick={scan}
                  disabled={acting || status.sessionStatus === 'paused' || (status.pinRequired && pin.length < 4)}
                  className="w-full rounded-full h-12 font-semibold">
            {acting && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
            {status.checkedIn ? 'Check Out' : status.segments > 0 ? 'Check Back In' : 'Check In'}
          </Button>
        )}

        {finished && status.attendance?.status === 'credited' && (
          <div className="text-center py-6">
            <div className="w-12 h-12 rounded-full bg-emerald-500/15 flex items-center justify-center mx-auto mb-3">
              <CheckCircle2 className="w-6 h-6 text-emerald-500" />
            </div>
            <p className="font-heading font-bold text-foreground">All done</p>
            <p className="text-sm text-muted-foreground mt-1 tabular-nums">
              {status.attendance.hoursVerified} hrs credited — verified by {opp.hostName}.
            </p>
          </div>
        )}

        {/* Ended with no record of them. Usually a flat battery or no signal
            rather than an absence, so there's a way to say so that doesn't
            require knowing who to email. It grants nothing on its own. */}
        {finished && !status.attendance && (
          <div className="text-center py-6">
            <p className="font-heading font-bold text-foreground">This event has ended</p>
            <p className="text-sm text-muted-foreground mt-1 mb-4">
              You weren't checked in, so no hours were recorded.
            </p>
            {status.committed && (
              <>
                {error && <p className="text-sm text-red-500 mb-3">{error}</p>}
                <Button onClick={requestHours} disabled={acting} variant="outline" className="rounded-full px-6">
                  {acting && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                  I was there — ask {opp.hostName} to confirm
                </Button>
              </>
            )}
          </div>
        )}

        {status.attendance?.status === 'requested' && (
          <div className="text-center py-6">
            <div className="w-12 h-12 rounded-full bg-amber-500/15 flex items-center justify-center mx-auto mb-3">
              <Clock className="w-6 h-6 text-amber-500" />
            </div>
            <p className="font-heading font-bold text-foreground">Waiting on {opp.hostName}</p>
            <p className="text-sm text-muted-foreground mt-1">
              They'll see your request on their attendance list and confirm your hours.
            </p>
          </div>
        )}

        {status.attendance?.status === 'rejected' && (
          <div className="text-center py-6">
            <p className="font-heading font-bold text-foreground">Not credited</p>
            <p className="text-sm text-muted-foreground mt-1">Check your Profile for details, or contact {opp.hostName}.</p>
          </div>
        )}
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useParams, useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useAuthStore } from '@/lib/store';
import { Loader2, MapPin, Clock as ClockIcon, CheckCircle2, Lock } from 'lucide-react';

interface Attendance {
  id: string;
  checkInAt: string;
  checkOutAt: string | null;
  hoursClaimed: number | null;
  hoursVerified: number | null;
  status: 'checked_in' | 'credited' | 'auto_closed' | 'rejected';
}

interface StatusResponse {
  gateOpensAt: string;
  gateEndsAt: string;
  signedUp: boolean;
  attendance: Attendance | null;
}

interface OppSummary {
  id: string;
  title: string;
  location: string;
  hostName: string;
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('locallink_token');
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

/** What a volunteer lands on after scanning the event's QR/link, or tapping
 * it from the pre-event email. No nav entry — reached only via that link,
 * same as /org/:id. One scan starts the clock, the same link scanned again
 * stops it and credits hours immediately; there's no review screen in
 * between, so the number a volunteer sees is exactly what lands on their
 * profile — nothing to edit here closes the self-report inflation gap that
 * an editable field would reopen. */
export default function CheckIn() {
  const params = useParams<{ opportunityId: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { isLoggedIn, currentUser } = useAuthStore();

  const [opp, setOpp] = useState<OppSummary | null>(null);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [elapsedLabel, setElapsedLabel] = useState('00:00');
  const [now, setNow] = useState(Date.now());

  const loadStatus = async () => {
    const res = await fetch(`/api/checkin/${params.opportunityId}/status`, { headers: authHeaders() });
    if (res.ok) setStatus(await res.json());
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const oppRes = await fetch(`/api/opportunities/${params.opportunityId}`);
      if (cancelled) return;
      if (!oppRes.ok) { setError('Event not found'); setLoading(false); return; }
      setOpp(await oppRes.json());
      if (isLoggedIn) await loadStatus();
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.opportunityId, isLoggedIn]);

  // Live elapsed-time display while checked in — cosmetic only; the server
  // computes the real hours from timestamps at checkout regardless of
  // whether this tab stayed open. Also drives the "past listed end, still
  // running" ticker used to decide when to show the reassurance note below.
  useEffect(() => {
    if (status?.attendance?.status !== 'checked_in') return;
    const start = new Date(status.attendance.checkInAt).getTime();
    const tick = () => {
      const t = Date.now();
      setNow(t);
      const s = Math.max(0, Math.floor((t - start) / 1000));
      const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
      setElapsedLabel(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [status]);

  const handleCheckIn = async () => {
    setActing(true);
    try {
      const res = await fetch(`/api/checkin/${params.opportunityId}`, { method: 'POST', headers: authHeaders() });
      const data = await res.json();
      if (res.ok) await loadStatus();
      else toast({ title: data.error || 'Could not check in', variant: 'destructive' });
    } finally {
      setActing(false);
    }
  };

  const handleCheckOut = async () => {
    setActing(true);
    try {
      const res = await fetch(`/api/checkout/${params.opportunityId}`, { method: 'POST', headers: authHeaders() });
      const data = await res.json();
      if (res.ok) { await loadStatus(); toast({ title: 'Checked out' }); }
      else toast({ title: data.error || 'Could not check out', variant: 'destructive' });
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

  if (error || !opp) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <p className="text-muted-foreground">This check-in link isn't valid.</p>
      </div>
    );
  }

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

  const gateNotYetOpen = now < new Date(status.gateOpensAt).getTime() && !status.attendance;
  const gateClosed = now > new Date(status.gateEndsAt).getTime() && !status.attendance;
  const attendance = status.attendance;

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

        {gateNotYetOpen && (
          <div className="text-center py-6">
            <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center mx-auto mb-3">
              <Lock className="w-5 h-5 text-muted-foreground" />
            </div>
            <p className="font-heading font-bold text-foreground">Check-in isn't open yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Opens at {new Date(status.gateOpensAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}.
            </p>
          </div>
        )}

        {gateClosed && (
          <div className="text-center py-6">
            <p className="font-heading font-bold text-foreground">This session has ended</p>
            <p className="text-sm text-muted-foreground mt-1">Check-in is only open during the event.</p>
          </div>
        )}

        {!gateNotYetOpen && !gateClosed && !attendance && (
          <>
            <p className="text-sm text-muted-foreground text-center mb-5">
              {status.signedUp
                ? "You're signed up for this event. Check in when you arrive to start tracking your hours."
                : "You're not signed up for this yet — checking in adds you to the list and starts your clock together."}
            </p>
            <Button onClick={handleCheckIn} disabled={acting} className="w-full rounded-full h-12 font-semibold">
              {acting && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              {status.signedUp ? 'Check In' : 'Join & Check In'}
            </Button>
          </>
        )}

        {attendance?.status === 'checked_in' && (
          <>
            <div className="flex items-center justify-center gap-2 mb-4">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">Checked in</span>
            </div>
            <div className="text-center mb-1">
              <span className="font-heading font-bold text-4xl text-foreground tabular-nums">{elapsedLabel}</span>
            </div>
            <p className="text-xs text-muted-foreground text-center mb-6 flex items-center justify-center gap-1">
              <ClockIcon className="w-3.5 h-3.5" /> elapsed since check-in
            </p>
            <Button onClick={handleCheckOut} disabled={acting} className="w-full rounded-full h-12 font-semibold">
              {acting && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Check Out
            </Button>
            {now > new Date(status.gateEndsAt).getTime() && (
              <p className="text-xs text-amber-600 dark:text-amber-400 text-center mt-4">
                This session's listed end has passed — check out now, or we'll close it out automatically in a couple hours.
              </p>
            )}
          </>
        )}

        {attendance?.status === 'credited' && (
          <div className="text-center py-6">
            <div className="w-12 h-12 rounded-full bg-emerald-500/15 flex items-center justify-center mx-auto mb-3">
              <CheckCircle2 className="w-6 h-6 text-emerald-500" />
            </div>
            <p className="font-heading font-bold text-foreground">Checked out</p>
            <p className="text-sm text-muted-foreground mt-1 tabular-nums">
              {attendance.hoursVerified} hrs credited — verified by {opp.hostName}.
            </p>
          </div>
        )}

        {attendance?.status === 'auto_closed' && (
          <div className="text-center py-6">
            <div className="w-12 h-12 rounded-full bg-amber-500/15 flex items-center justify-center mx-auto mb-3">
              <ClockIcon className="w-6 h-6 text-amber-500" />
            </div>
            <p className="font-heading font-bold text-foreground">Checked out automatically</p>
            <p className="text-sm text-muted-foreground mt-1 tabular-nums">
              You didn't check out, so we assumed {attendance.hoursVerified} hrs (the listed length). Contact {opp.hostName} if that's not right.
            </p>
          </div>
        )}

        {attendance?.status === 'rejected' && (
          <div className="text-center py-6">
            <p className="font-heading font-bold text-foreground">Not credited</p>
            <p className="text-sm text-muted-foreground mt-1">Check your Profile for details, or contact {opp.hostName}.</p>
          </div>
        )}
      </div>
    </div>
  );
}

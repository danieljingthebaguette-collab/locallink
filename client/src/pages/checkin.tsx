import { useEffect, useState } from 'react';
import { useParams, useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useAuthStore } from '@/lib/store';
import { Loader2, MapPin, Clock as ClockIcon, CheckCircle2 } from 'lucide-react';

interface AttendanceState {
  id: string;
  checkInAt: string;
  checkOutAt: string | null;
  hoursClaimed: number | null;
  status: 'checked_in' | 'pending' | 'verified' | 'rejected';
}

interface OppSummary {
  id: string;
  title: string;
  location: string;
  hostName: string;
  date: string;
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('locallink_token');
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

/** What a volunteer lands on after scanning the event's QR/link. No nav entry
 * — reached only via that link, same as /org/:id. */
export default function CheckIn() {
  const params = useParams<{ opportunityId: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { isLoggedIn, currentUser } = useAuthStore();

  const [opp, setOpp] = useState<OppSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attendance, setAttendance] = useState<AttendanceState | null>(null);
  const [acting, setActing] = useState(false);
  const [hoursInput, setHoursInput] = useState('');
  const [elapsedLabel, setElapsedLabel] = useState('00:00');
  // Server has no separate "reviewing before submit" state — checkout sets
  // status='pending' immediately with the computed hours. This is purely a
  // client-side phase so the volunteer gets one screen to adjust the number
  // before it's treated as final, without inventing a server-side status
  // that would complicate the org's side for no reason.
  const [finalized, setFinalized] = useState(false);

  useEffect(() => {
    fetch(`/api/opportunities/${params.opportunityId}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => setOpp(data))
      .catch(() => setError('Event not found'))
      .finally(() => setLoading(false));
  }, [params.opportunityId]);

  // Live elapsed-time display while checked in — cosmetic only; the server
  // computes the real hours from timestamps at checkout regardless of
  // whether this tab stayed open.
  useEffect(() => {
    if (!attendance || attendance.status !== 'checked_in') return;
    const start = new Date(attendance.checkInAt).getTime();
    const tick = () => {
      const s = Math.max(0, Math.floor((Date.now() - start) / 1000));
      const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
      setElapsedLabel(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [attendance]);

  const handleCheckIn = async () => {
    setActing(true);
    try {
      const res = await fetch(`/api/checkin/${params.opportunityId}`, { method: 'POST', headers: authHeaders() });
      const data = await res.json();
      if (res.ok) setAttendance(data);
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
      if (res.ok) { setAttendance(data); setHoursInput(String(data.hoursClaimed ?? '')); }
      else toast({ title: data.error || 'Could not check out', variant: 'destructive' });
    } finally {
      setActing(false);
    }
  };

  const handleSubmitHours = async () => {
    const hours = parseFloat(hoursInput);
    if (isNaN(hours) || hours < 0) { toast({ title: 'Enter a valid number of hours', variant: 'destructive' }); return; }
    setActing(true);
    try {
      // Re-checkout with the (possibly edited) hours — checkout is idempotent
      // server-side and just updates hoursClaimed on the existing row.
      const res = await fetch(`/api/checkout/${params.opportunityId}`, {
        method: 'POST', headers: authHeaders(), body: JSON.stringify({ hoursClaimed: hours }),
      });
      const data = await res.json();
      if (res.ok) { setAttendance(data); setFinalized(true); toast({ title: 'Submitted for review' }); }
      else toast({ title: data.error || 'Could not submit', variant: 'destructive' });
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

        {!attendance && (
          <>
            <p className="text-sm text-muted-foreground text-center mb-5">
              You're signed up for this event. Check in when you arrive to start tracking your hours.
            </p>
            <Button onClick={handleCheckIn} disabled={acting} className="w-full rounded-full h-12 font-semibold">
              {acting && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Check In
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
          </>
        )}

        {attendance?.status === 'pending' && !finalized && (
          <>
            <p className="text-sm font-semibold text-foreground mb-1">Checked out</p>
            <p className="text-xs text-muted-foreground mb-4">We calculated your time. Adjust it if it's not quite right, then submit.</p>
            <label className="text-xs font-bold text-muted-foreground uppercase tracking-wide block mb-1.5">Hours worked</label>
            <input
              type="text" inputMode="decimal" value={hoursInput}
              onChange={e => setHoursInput(e.target.value)}
              className="w-full text-2xl font-heading font-bold rounded-2xl border border-border bg-secondary/40 px-4 py-3 mb-4 text-foreground"
            />
            <Button onClick={handleSubmitHours} disabled={acting} className="w-full rounded-full h-12 font-semibold">
              {acting && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Submit for verification
            </Button>
          </>
        )}

        {attendance?.status === 'pending' && finalized && (
          <div className="text-center py-6">
            <div className="w-12 h-12 rounded-full bg-amber-500/15 flex items-center justify-center mx-auto mb-3">
              <CheckCircle2 className="w-6 h-6 text-amber-500" />
            </div>
            <p className="font-heading font-bold text-foreground">Submitted — pending review</p>
            <p className="text-sm text-muted-foreground mt-1 tabular-nums">
              {attendance.hoursClaimed} hrs sent to {opp.hostName} for verification.
            </p>
          </div>
        )}

        {(attendance?.status === 'verified' || attendance?.status === 'rejected') && (
          <div className="text-center py-6">
            <p className="font-heading font-bold text-foreground">
              {attendance.status === 'verified' ? 'Hours verified' : 'Not approved'}
            </p>
            <p className="text-sm text-muted-foreground mt-1">Check your Profile for details.</p>
          </div>
        )}
      </div>
    </div>
  );
}

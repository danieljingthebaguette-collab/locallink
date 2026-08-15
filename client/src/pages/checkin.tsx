import { useEffect, useState } from 'react';
import { useParams, useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/lib/store';
import { Loader2, MapPin, CheckCircle2, Lock } from 'lucide-react';

interface Attendance {
  hoursVerified: number | null;
  status: 'credited' | 'rejected';
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
  duration: number;
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('locallink_token');
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

/** What a volunteer lands on after scanning the event's QR/link, or tapping
 * it from the pre-event email. No nav entry — reached only via that link,
 * same as /org/:id. One tap credits the full listed duration immediately;
 * there's nothing to edit afterward, so the number a volunteer sees here is
 * exactly what lands on their profile. */
export default function CheckIn() {
  const params = useParams<{ opportunityId: string }>();
  const [, navigate] = useLocation();
  const { isLoggedIn, currentUser } = useAuthStore();

  const [opp, setOpp] = useState<OppSummary | null>(null);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [now] = useState(Date.now());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const oppRes = await fetch(`/api/opportunities/${params.opportunityId}`);
      if (cancelled) return;
      if (!oppRes.ok) { setError('Event not found'); setLoading(false); return; }
      setOpp(await oppRes.json());
      if (isLoggedIn) {
        const statusRes = await fetch(`/api/checkin/${params.opportunityId}/status`, { headers: authHeaders() });
        if (!cancelled && statusRes.ok) setStatus(await statusRes.json());
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.opportunityId, isLoggedIn]);

  const handleCheckIn = async () => {
    setActing(true);
    try {
      const res = await fetch(`/api/checkin/${params.opportunityId}`, { method: 'POST', headers: authHeaders() });
      const data = await res.json();
      if (res.ok) {
        const statusRes = await fetch(`/api/checkin/${params.opportunityId}/status`, { headers: authHeaders() });
        if (statusRes.ok) setStatus(await statusRes.json());
      } else {
        setError(data.error || 'Could not check in');
      }
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

  const gateNotYetOpen = now < new Date(status.gateOpensAt).getTime() && !status.attendance;
  const gateClosed = now > new Date(status.gateEndsAt).getTime() && !status.attendance;

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

        {!gateNotYetOpen && !gateClosed && !status.attendance && (
          <>
            <p className="text-sm text-muted-foreground text-center mb-2">
              {status.signedUp
                ? `Check in and ${opp.duration} hrs go straight to your profile.`
                : "You're not signed up yet — checking in adds you to the list and credits your hours together."}
            </p>
            {error && <p className="text-sm text-red-500 text-center mb-3">{error}</p>}
            <Button onClick={handleCheckIn} disabled={acting} className="w-full rounded-full h-12 font-semibold">
              {acting && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              {status.signedUp ? 'Check In' : 'Join & Check In'}
            </Button>
          </>
        )}

        {status.attendance?.status === 'credited' && (
          <div className="text-center py-6">
            <div className="w-12 h-12 rounded-full bg-emerald-500/15 flex items-center justify-center mx-auto mb-3">
              <CheckCircle2 className="w-6 h-6 text-emerald-500" />
            </div>
            <p className="font-heading font-bold text-foreground">Checked in</p>
            <p className="text-sm text-muted-foreground mt-1 tabular-nums">
              {status.attendance.hoursVerified} hrs credited — verified by {opp.hostName}.
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

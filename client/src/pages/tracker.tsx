import { useEffect, useState } from 'react';
import { useParams, useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useAuthStore } from '@/lib/store';
import { ClipboardList, Loader2, Download, ArrowLeft, Copy, Check } from 'lucide-react';

interface RosterRow {
  userId: string;
  username: string;
  email: string;
  attendanceId: string | null;
  checkInAt: string | null;
  hoursClaimed: number | null;
  hoursVerified: number | null;
  status: 'pending' | 'no_show' | 'credited' | 'rejected';
}

interface RosterResponse {
  occurrenceDate: string;
  eventEnded: boolean;
  roster: RosterRow[];
  reliability: Record<string, { noShows: number; total: number }>;
  availableDates: string[];
}

interface OppSummary {
  id: string;
  title: string;
  duration: number;
  hostId: string;
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('locallink_token');
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// Four states, in the host's words rather than the database's. "Coming" and
// "Didn't come" aren't stored anywhere — they're what it means for someone to
// be on the interest list with no scan, before vs. after the event.
const STATUS_META: Record<RosterRow['status'], { label: string; cls: string }> = {
  pending:  { label: 'Coming',      cls: 'bg-secondary text-muted-foreground' },
  credited: { label: 'Came',        cls: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' },
  no_show:  { label: "Didn't come", cls: 'bg-secondary text-muted-foreground' },
  rejected: { label: 'Removed',     cls: 'bg-red-500/10 text-red-500' },
};

/** Reached by tapping Tracker on a hosted event in My Events. One list:
 * everyone who tapped Interested, plus anyone who walked in and scanned.
 * A scan credits the event's full listed duration on the spot, so the host's
 * only job here is spotting the exceptions — someone who came but couldn't
 * scan, or someone credited who shouldn't have been. */
export default function Tracker() {
  const params = useParams<{ opportunityId: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { isLoggedIn, currentUser } = useAuthStore();

  const [opp, setOpp] = useState<OppSummary | null>(null);
  const [data, setData] = useState<RosterResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [copied, setCopied] = useState(false);

  const loadRoster = async (date?: string | null) => {
    const url = `/api/opportunities/${params.opportunityId}/attendance${date ? `?date=${date}` : ''}`;
    const res = await fetch(url, { headers: authHeaders() });
    if (res.ok) {
      const json: RosterResponse = await res.json();
      setData(json);
      setSelectedDate(json.occurrenceDate);
    } else {
      toast({ title: 'Could not load the list', variant: 'destructive' });
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const oppRes = await fetch(`/api/opportunities/${params.opportunityId}`);
      if (!cancelled && oppRes.ok) setOpp(await oppRes.json());
      await loadRoster();
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.opportunityId]);

  if (!isLoggedIn || !currentUser) {
    return (
      <div className="min-h-screen bg-background pb-24 font-sans">
        <main className="container mx-auto px-4 py-16 text-center">
          <ClipboardList className="w-16 h-16 text-muted-foreground mx-auto opacity-50 mb-4" />
          <h2 className="text-2xl font-heading font-bold text-foreground mb-2">Please Login</h2>
          <Button onClick={() => navigate('/account')} className="rounded-full px-8">Login / Sign Up</Button>
        </main>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!opp || !data) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4 text-center">
        <p className="text-muted-foreground">Could not load this event's list.</p>
      </div>
    );
  }

  if (opp.hostId !== currentUser.id && !currentUser.isAdmin) {
    return (
      <div className="min-h-screen bg-background pb-24 font-sans">
        <main className="container mx-auto px-4 py-16 text-center max-w-md">
          <ClipboardList className="w-16 h-16 text-muted-foreground mx-auto opacity-50 mb-4" />
          <h2 className="text-2xl font-heading font-bold text-foreground mb-2">Only the host can see this</h2>
          <Button onClick={() => navigate('/my-events')} variant="outline" className="rounded-full px-8">Back to My Events</Button>
        </main>
      </div>
    );
  }

  const markCame = async (row: RosterRow) => {
    setActingId(row.userId);
    try {
      const res = await fetch(`/api/opportunities/${params.opportunityId}/attendance/mark-present`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ userId: row.userId, occurrenceDate: selectedDate }),
      });
      if (res.ok) { await loadRoster(selectedDate); toast({ title: `${row.username} credited ${opp.duration} hrs` }); }
      else { const d = await res.json().catch(() => ({})); toast({ title: d.error || 'Could not update', variant: 'destructive' }); }
    } finally {
      setActingId(null);
    }
  };

  const removeCredit = async (row: RosterRow) => {
    if (!row.attendanceId) return;
    setActingId(row.userId);
    try {
      const res = await fetch(`/api/attendance/${row.attendanceId}`, {
        method: 'PUT', headers: authHeaders(), body: JSON.stringify({ status: 'rejected' }),
      });
      if (res.ok) { await loadRoster(selectedDate); toast({ title: `${row.username}'s hours removed` }); }
      else { const d = await res.json().catch(() => ({})); toast({ title: d.error || 'Could not update', variant: 'destructive' }); }
    } finally {
      setActingId(null);
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/checkin/${opp.id}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: 'Could not copy — select the link and copy it manually', variant: 'destructive' });
    }
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const token = localStorage.getItem('locallink_token');
      const url = `/api/opportunities/${params.opportunityId}/attendance/export${selectedDate ? `?date=${selectedDate}` : ''}`;
      const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) { toast({ title: 'Export failed', variant: 'destructive' }); return; }
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `${opp.title.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}_${selectedDate}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(blobUrl);
    } finally {
      setExporting(false);
    }
  };

  const cameCount = data.roster.filter(r => r.status === 'credited').length;

  return (
    <div className="min-h-screen bg-background pb-24 font-sans">
      <main className="container mx-auto px-4 py-8 max-w-2xl">
        <button onClick={() => navigate('/my-events')} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6">
          <ArrowLeft className="w-4 h-4" /> Back to My Events
        </button>

        <h1 className="text-2xl font-heading font-bold text-foreground">{opp.title}</h1>
        <div className="flex flex-wrap items-center gap-3 mt-2 mb-6">
          {data.availableDates.length > 1 ? (
            <select
              value={selectedDate ?? ''}
              onChange={e => loadRoster(e.target.value)}
              aria-label="Which session"
              className="text-sm font-semibold bg-secondary rounded-full px-3 py-1 text-foreground"
            >
              {data.availableDates.map(d => (
                <option key={d} value={d}>{new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</option>
              ))}
            </select>
          ) : (
            <p className="text-sm text-muted-foreground">{new Date((selectedDate ?? data.occurrenceDate) + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</p>
          )}
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground tabular-nums">{cameCount}</span> of {data.roster.length} came
          </p>
        </div>

        {/* The link comes first: before the event it's the only thing the host
            actually needs from this page. */}
        <div className="rounded-2xl border border-border bg-secondary/30 p-4 mb-6">
          <p className="text-sm font-semibold text-foreground mb-1">Check-in link</p>
          <p className="text-xs text-muted-foreground mb-3">
            Show this at the event as a QR code or send it to your volunteers. Whoever opens it gets {opp.duration} hrs.
          </p>
          <Button onClick={copyLink} variant="outline" size="sm" className="rounded-full text-xs">
            {copied ? <Check className="w-3.5 h-3.5 mr-1.5" /> : <Copy className="w-3.5 h-3.5 mr-1.5" />}
            {copied ? 'Copied' : 'Copy link'}
          </Button>
        </div>

        <div className="rounded-2xl border border-border overflow-hidden mb-4">
          {data.roster.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-10">Nobody's signed up for this one yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {data.roster.map(r => {
                const meta = STATUS_META[r.status];
                const rel = data.reliability[r.userId];
                // Only flag a repeated pattern — one missed session is life,
                // not a signal, and calling it out reads as punishment.
                const showFlag = rel && rel.noShows >= 2;
                const busy = actingId === r.userId;
                return (
                  <li key={r.userId} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-foreground truncate">{r.username}</p>
                      <p className="text-xs text-muted-foreground">
                        {r.status === 'credited' && `${r.hoursVerified ?? r.hoursClaimed} hrs · checked in ${fmtTime(r.checkInAt)}`}
                        {r.status === 'pending' && 'Hasn’t checked in yet'}
                        {r.status === 'no_show' && 'Never checked in'}
                        {r.status === 'rejected' && 'Hours removed'}
                        {showFlag && <span className="text-muted-foreground"> · missed {rel.noShows} of {rel.total} with you</span>}
                      </p>
                    </div>
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${meta.cls}`}>{meta.label}</span>
                    <div className="flex-shrink-0 w-[104px] text-right">
                      {busy ? (
                        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground inline-block" />
                      ) : (r.status === 'pending' || r.status === 'no_show') ? (
                        <button
                          onClick={() => markCame(r)}
                          className="text-xs font-semibold text-primary hover:underline"
                        >
                          Mark as came
                        </button>
                      ) : r.status === 'credited' ? (
                        <button
                          onClick={() => removeCredit(r)}
                          className="text-xs font-semibold text-muted-foreground hover:text-red-500 transition-colors"
                        >
                          Remove hours
                        </button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <Button variant="outline" size="sm" onClick={exportCsv} disabled={exporting} className="rounded-full text-xs">
          {exporting ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Download className="w-3.5 h-3.5 mr-1.5" />}
          Download as spreadsheet
        </Button>
      </main>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useParams, useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useAuthStore } from '@/lib/store';
import {
  ClipboardList, Loader2, Download, ArrowLeft, Check, X as XIcon,
  UserPlus, AlertTriangle, Building2,
} from 'lucide-react';

interface RosterRow {
  userId: string;
  username: string;
  email: string;
  signedUpAt: string;
  attendanceId: string | null;
  checkInAt: string | null;
  checkOutAt: string | null;
  hoursClaimed: number | null;
  hoursVerified: number | null;
  status: 'pending' | 'no_show' | 'checked_in' | 'credited' | 'auto_closed' | 'rejected';
  note: string | null;
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
  date: string;
  isRecurring?: boolean;
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

function fmtHours(n: number | null): string {
  if (n === null || n === undefined) return '—';
  return (Math.round(n * 100) / 100).toString();
}

const STATUS_META: Record<RosterRow['status'], { label: string; cls: string }> = {
  pending: { label: 'pending', cls: 'bg-secondary text-muted-foreground' },
  no_show: { label: 'no-show', cls: 'bg-red-500/10 text-red-500' },
  checked_in: { label: 'checked in', cls: 'bg-blue-500/15 text-blue-600 dark:text-blue-400' },
  credited: { label: 'credited', cls: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' },
  auto_closed: { label: 'auto-closed ⚑', cls: 'bg-amber-500/15 text-amber-600 dark:text-amber-400' },
  rejected: { label: 'rejected', cls: 'bg-red-500/15 text-red-500' },
};

/** Reached by tapping the Tracker icon on a hosted event in My Events — not
 * a standalone nav tab, since it's an action on one event, not its own
 * section. Merges the interest list and the attendance list into one: a
 * signup with no scan shows as Pending (or No-show once the session's
 * over), a scan credits instantly, and the host can adjust after the fact
 * rather than approving beforehand. */
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
  const [markPresentFor, setMarkPresentFor] = useState<RosterRow | null>(null);
  const [markHours, setMarkHours] = useState('');

  const loadRoster = async (date?: string | null) => {
    const url = `/api/opportunities/${params.opportunityId}/attendance${date ? `?date=${date}` : ''}`;
    const res = await fetch(url, { headers: authHeaders() });
    if (res.ok) {
      const json: RosterResponse = await res.json();
      setData(json);
      setSelectedDate(json.occurrenceDate);
    } else {
      toast({ title: 'Could not load roster', variant: 'destructive' });
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
        <p className="text-muted-foreground">Could not load this event's tracker.</p>
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

  const adjust = async (row: RosterRow, status: 'credited' | 'rejected', hoursVerified?: number) => {
    if (!row.attendanceId) return;
    setActingId(row.attendanceId);
    try {
      const res = await fetch(`/api/attendance/${row.attendanceId}`, {
        method: 'PUT', headers: authHeaders(), body: JSON.stringify({ status, hoursVerified }),
      });
      if (res.ok) { await loadRoster(selectedDate); toast({ title: status === 'credited' ? 'Hours adjusted' : 'Credit revoked' }); }
      else { const d = await res.json().catch(() => ({})); toast({ title: d.error || 'Could not update', variant: 'destructive' }); }
    } finally {
      setActingId(null);
    }
  };

  const submitMarkPresent = async () => {
    if (!markPresentFor) return;
    const hours = markHours.trim() === '' ? undefined : parseFloat(markHours);
    if (hours !== undefined && (isNaN(hours) || hours < 0)) { toast({ title: 'Enter a valid number of hours', variant: 'destructive' }); return; }
    setActingId(markPresentFor.userId);
    try {
      const res = await fetch(`/api/opportunities/${params.opportunityId}/attendance/mark-present`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ userId: markPresentFor.userId, hours, occurrenceDate: selectedDate }),
      });
      if (res.ok) { await loadRoster(selectedDate); toast({ title: `Marked ${markPresentFor.username} present` }); setMarkPresentFor(null); }
      else { const d = await res.json().catch(() => ({})); toast({ title: d.error || 'Could not mark present', variant: 'destructive' }); }
    } finally {
      setActingId(null);
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
      a.download = `${opp.title.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}_${selectedDate}_attendance.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(blobUrl);
    } finally {
      setExporting(false);
    }
  };

  const checkInUrl = `${window.location.origin}/checkin/${opp.id}`;
  const pendingCount = data.roster.filter(r => r.status === 'pending').length;
  const creditedCount = data.roster.filter(r => r.status === 'credited' || r.status === 'auto_closed').length;
  const noShowCount = data.roster.filter(r => r.status === 'no_show').length;

  return (
    <div className="min-h-screen bg-background pb-24 font-sans">
      <main className="container mx-auto px-4 py-8 max-w-3xl">
        <button onClick={() => navigate('/my-events')} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6">
          <ArrowLeft className="w-4 h-4" /> Back to My Events
        </button>

        <div className="mb-6">
          <h1 className="text-2xl font-heading font-bold text-foreground flex items-center gap-2">
            <ClipboardList className="w-6 h-6 text-primary" />
            {opp.title}
          </h1>
          <div className="flex flex-wrap items-center gap-3 mt-2">
            {data.availableDates.length > 1 ? (
              <select
                value={selectedDate ?? ''}
                onChange={e => loadRoster(e.target.value)}
                className="text-sm font-semibold bg-secondary rounded-full px-3 py-1 text-foreground"
              >
                {data.availableDates.map(d => (
                  <option key={d} value={d}>{new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</option>
                ))}
              </select>
            ) : (
              <p className="text-sm text-muted-foreground">{new Date((selectedDate ?? data.occurrenceDate) + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</p>
            )}
            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">{pendingCount} pending</span>
            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">{creditedCount} credited</span>
            {noShowCount > 0 && <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-red-500/10 text-red-500">{noShowCount} no-show</span>}
          </div>
        </div>

        <div className="rounded-2xl border border-border overflow-hidden mb-5">
          {data.roster.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-10">Nobody's tapped Interested for this session yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[600px]">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-muted-foreground bg-secondary/40">
                    <th className="text-left font-semibold py-2.5 pl-4 pr-4">Volunteer</th>
                    <th className="text-left font-semibold py-2.5 pr-4">In</th>
                    <th className="text-left font-semibold py-2.5 pr-4">Out</th>
                    <th className="text-right font-semibold py-2.5 pr-4">Hours</th>
                    <th className="text-left font-semibold py-2.5 pr-4">Status</th>
                    <th className="py-2.5 pr-4"></th>
                  </tr>
                </thead>
                <tbody>
                  {data.roster.map(r => {
                    const meta = STATUS_META[r.status];
                    const rel = data.reliability[r.userId];
                    return (
                      <tr key={r.userId} className="border-t border-border/60">
                        <td className="py-2.5 pl-4 pr-4">
                          <span className="font-medium text-foreground">{r.username}</span>
                          {rel && rel.noShows > 0 && (
                            <span title={`No-showed ${rel.noShows} of their last ${rel.total} sessions with you`} className="ml-1.5 inline-flex items-center gap-0.5 text-[10px] font-bold text-amber-600 dark:text-amber-400">
                              <AlertTriangle className="w-3 h-3" />{rel.noShows}/{rel.total}
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 pr-4 text-muted-foreground">{fmtTime(r.checkInAt)}</td>
                        <td className="py-2.5 pr-4 text-muted-foreground">{fmtTime(r.checkOutAt)}</td>
                        <td className="py-2.5 pr-4 text-right tabular-nums">{fmtHours(r.hoursVerified ?? r.hoursClaimed)}</td>
                        <td className="py-2.5 pr-4">
                          <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${meta.cls}`}>{meta.label}</span>
                        </td>
                        <td className="py-2.5 pr-4">
                          <div className="flex gap-1.5 justify-end">
                            {(r.status === 'credited' || r.status === 'auto_closed') && (
                              <button
                                onClick={() => adjust(r, 'rejected')}
                                disabled={actingId === r.attendanceId}
                                aria-label={`Revoke ${r.username}'s credited hours`}
                                title="Revoke"
                                className="w-7 h-7 flex items-center justify-center rounded-full bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors disabled:opacity-50"
                              >
                                {actingId === r.attendanceId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XIcon className="w-3.5 h-3.5" />}
                              </button>
                            )}
                            {r.status === 'rejected' && (
                              <button
                                onClick={() => adjust(r, 'credited')}
                                disabled={actingId === r.attendanceId}
                                aria-label={`Restore ${r.username}'s credit`}
                                title="Restore"
                                className="w-7 h-7 flex items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/25 transition-colors disabled:opacity-50"
                              >
                                {actingId === r.attendanceId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                              </button>
                            )}
                            {(r.status === 'pending' || r.status === 'no_show') && (
                              <button
                                onClick={() => { setMarkPresentFor(r); setMarkHours(''); }}
                                aria-label={`Mark ${r.username} present`}
                                title="Mark present"
                                className="w-7 h-7 flex items-center justify-center rounded-full bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                              >
                                <UserPlus className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-5">
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={exporting} className="rounded-full text-xs">
            {exporting ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Download className="w-3.5 h-3.5 mr-1.5" />}
            Export CSV
          </Button>
        </div>

        <div className="rounded-2xl border border-dashed border-border p-4 flex items-start gap-3">
          <Building2 className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
          <div className="min-w-0">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">Check-in link</p>
            <p className="text-xs text-muted-foreground mb-1">Print this as a QR at the event, or share it directly — either way it only works during the session.</p>
            <a href={checkInUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary underline break-all">{checkInUrl}</a>
          </div>
        </div>
      </main>

      {/* Mark present — the kiosk substitute for a dead phone or an unscannable poster */}
      {markPresentFor && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/50" onClick={() => setMarkPresentFor(null)}>
          <div onClick={e => e.stopPropagation()} className="w-full max-w-xs rounded-2xl bg-card border border-border shadow-2xl p-5 space-y-4">
            <div>
              <h3 className="font-heading font-bold text-foreground">Mark {markPresentFor.username} present</h3>
              <p className="text-xs text-muted-foreground mt-1">For someone who was actually here but couldn't scan — a dead phone, an unreadable poster.</p>
            </div>
            <div>
              <label className="text-xs font-bold text-muted-foreground uppercase tracking-wide block mb-1.5">Hours (optional)</label>
              <input
                type="text" inputMode="decimal" placeholder={`Default: listed duration`} value={markHours}
                onChange={e => setMarkHours(e.target.value)}
                className="w-full rounded-xl border border-border bg-secondary/40 px-3 py-2 text-sm text-foreground"
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={submitMarkPresent} disabled={actingId === markPresentFor.userId} className="flex-1 rounded-full text-sm">
                {actingId === markPresentFor.userId && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />}
                Confirm
              </Button>
              <Button variant="outline" onClick={() => setMarkPresentFor(null)} className="flex-1 rounded-full text-sm">Cancel</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

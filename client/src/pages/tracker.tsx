import { useEffect, useState } from 'react';
import { useParams, useLocation } from 'wouter';
import { QRCodeSVG } from 'qrcode.react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useAuthStore } from '@/lib/store';
import { ClipboardList, Loader2, Download, ArrowLeft, Copy, Check, Play, Pause, Square, X } from 'lucide-react';

type RowStatus = 'coming' | 'here' | 'left' | 'no_show' | 'rejected' | 'requested';
type SessionStatus = 'none' | 'scheduled' | 'running' | 'paused' | 'stopped';

interface RosterRow {
  userId: string;
  username: string;
  email: string;
  attendanceId: string | null;
  checkInAt: string | null;
  checkOutAt: string | null;
  hoursClaimed: number | null;
  hoursVerified: number | null;
  hoursNow: number;
  cutShort: boolean;
  overListed: boolean;
  isMinor: boolean | null;
  stepsAcknowledgedAt: string | null;
  status: RowStatus;
}

interface SessionInfo {
  status: SessionStatus;
  autoStartAt: string | null;
  startedAt: string | null;
  autoStopAt: string;
  stoppedAt: string | null;
  checkinPin: string | null;
  pauses: { pausedAt: string; resumedAt: string | null }[];
}

interface RosterResponse {
  occurrenceDate: string;
  roster: RosterRow[];
  reliability: Record<string, { noShows: number; total: number }>;
  availableDates: string[];
  session: SessionInfo | null;
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

/** "2026-08-15T14:30", the format <input type="datetime-local"> reads and
 * writes, in the BROWSER'S OWN local time — no timezone math here, because
 * that's exactly what makes the round trip through `new Date(value)` later
 * come out correct: the browser parses a bare local string as local time,
 * same zone the organizer is standing in. */
function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const STATUS_META: Record<RowStatus, { label: string; cls: string }> = {
  coming:   { label: 'Coming',      cls: 'bg-secondary text-muted-foreground' },
  here:     { label: 'Here now',    cls: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' },
  left:     { label: 'Left',        cls: 'bg-blue-500/10 text-blue-600 dark:text-blue-400' },
  no_show:  { label: "Didn't come", cls: 'bg-secondary text-muted-foreground' },
  rejected: { label: 'Removed',     cls: 'bg-red-500/10 text-red-500' },
  requested:{ label: 'Says they came', cls: 'bg-amber-500/15 text-amber-600 dark:text-amber-400' },
};

const SESSION_META: Record<SessionStatus, { label: string; cls: string }> = {
  none:      { label: 'Not started',    cls: 'bg-secondary text-muted-foreground' },
  scheduled: { label: 'Scheduled',      cls: 'bg-blue-500/10 text-blue-600 dark:text-blue-400' },
  running:   { label: 'Live',           cls: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' },
  paused:    { label: 'Paused',         cls: 'bg-amber-500/15 text-amber-600 dark:text-amber-400' },
  stopped:   { label: 'Ended',          cls: 'bg-secondary text-muted-foreground' },
};

/** Reached by tapping Tracker on a hosted event in My Events. The organizer
 * runs a real clock here — Start, Pause, Resume, Stop — because a posted
 * end time is often a guess and this is what makes the volunteers' hours
 * trustworthy instead. The roster below only ever shows people who took the
 * extra step of committing, not everyone who's merely Interested. */
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
  const [sessionActing, setSessionActing] = useState(false);
  const [showStartForm, setShowStartForm] = useState(false);
  const [startAt, setStartAt] = useState('');
  const [stopAt, setStopAt] = useState('');
  const [requirePin, setRequirePin] = useState(false);
  const [editHoursFor, setEditHoursFor] = useState<string | null>(null);
  const [hoursDraft, setHoursDraft] = useState('');

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

  // A running/scheduled session's own status flips over time purely from
  // the clock (autoStartAt or autoStopAt passing) with nobody clicking
  // anything — poll gently so the host doesn't have to refresh the page to
  // see "Scheduled" become "Live" or "Live" become "Ended".
  useEffect(() => {
    const status = data?.session?.status;
    if (status !== 'scheduled' && status !== 'running') return;
    const t = setInterval(() => loadRoster(selectedDate), 20_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.session?.status, selectedDate]);

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
        <div className="max-w-sm">
          <p className="font-heading font-bold text-xl text-foreground mb-2">Could not load this list</p>
          <p className="text-muted-foreground text-sm mb-6">
            The event may have been removed, or the connection dropped.
          </p>
          <div className="flex flex-wrap gap-2 justify-center">
            <Button onClick={() => window.location.reload()} className="rounded-full px-6">Try again</Button>
            <Button onClick={() => navigate('/my-events')} variant="outline" className="rounded-full px-6">
              Back to My Events
            </Button>
          </div>
        </div>
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

  const openStartForm = () => {
    const now = new Date();
    setStartAt(toLocalInputValue(now));
    setStopAt(toLocalInputValue(new Date(now.getTime() + opp!.duration * 3_600_000)));
    setRequirePin(!!data?.session?.checkinPin);
    setShowStartForm(true);
  };

  /** The organizer's correction for anything the scans got wrong — someone
   * who kept working past auto-stop, or a stand-in entry with the wrong
   * number. Setting a figure here locks it against later scan activity. */
  const saveHours = async (row: RosterRow) => {
    if (!row.attendanceId) return;
    const hours = Number(hoursDraft);
    if (!Number.isFinite(hours) || hours < 0) {
      toast({ title: 'Enter a number of hours', variant: 'destructive' });
      return;
    }
    setActingId(row.userId);
    try {
      const res = await fetch(`/api/attendance/${row.attendanceId}`, {
        method: 'PUT', headers: authHeaders(),
        body: JSON.stringify({ status: 'credited', hoursVerified: hours }),
      });
      if (res.ok) {
        setEditHoursFor(null);
        await loadRoster(selectedDate);
        toast({ title: `${row.username} set to ${hours} hrs` });
      } else {
        const d = await res.json().catch(() => ({}));
        toast({ title: d.error || 'Could not update', variant: 'destructive' });
      }
    } finally {
      setActingId(null);
    }
  };

  const submitStart = async () => {
    if (!startAt || !stopAt) return;
    setSessionActing(true);
    try {
      const res = await fetch(`/api/opportunities/${params.opportunityId}/session/start`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({
          autoStartAt: new Date(startAt).toISOString(),
          autoStopAt: new Date(stopAt).toISOString(),
          requirePin,
        }),
      });
      const d = await res.json();
      if (res.ok) { setShowStartForm(false); await loadRoster(selectedDate); toast({ title: 'Event started' }); }
      else toast({ title: d.error || 'Could not start', variant: 'destructive' });
    } finally {
      setSessionActing(false);
    }
  };

  const sessionAction = async (action: 'pause' | 'resume' | 'stop') => {
    setSessionActing(true);
    try {
      const res = await fetch(`/api/opportunities/${params.opportunityId}/session/${action}`, { method: 'POST', headers: authHeaders() });
      const d = await res.json();
      if (res.ok) {
        await loadRoster(selectedDate);
        if (action === 'stop') toast({ title: `Event ended — ${d.credited} volunteer${d.credited === 1 ? '' : 's'} credited` });
      } else {
        toast({ title: d.error || 'Could not update', variant: 'destructive' });
      }
    } finally {
      setSessionActing(false);
    }
  };

  const markCame = async (row: RosterRow) => {
    setActingId(row.userId);
    try {
      const res = await fetch(`/api/opportunities/${params.opportunityId}/attendance/mark-present`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ userId: row.userId, occurrenceDate: selectedDate }),
      });
      if (res.ok) { await loadRoster(selectedDate); toast({ title: `${row.username} credited ${opp!.duration} hrs` }); }
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
      await navigator.clipboard.writeText(`${window.location.origin}/checkin/${opp!.id}`);
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
      a.download = `${opp!.title.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}_${selectedDate}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(blobUrl);
    } finally {
      setExporting(false);
    }
  };

  const session = data.session;
  const sMeta = SESSION_META[session?.status ?? 'none'];
  const hereCount = data.roster.filter(r => r.status === 'here').length;
  const cameCount = data.roster.filter(r => r.status === 'here' || r.status === 'left').length;
  const checkinUrl = `${window.location.origin}/checkin/${opp.id}`;

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
          <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${sMeta.cls}`}>{sMeta.label}</span>
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground tabular-nums">{cameCount}</span> of {data.roster.length} came
            {hereCount > 0 && <span className="text-emerald-600 dark:text-emerald-400"> · {hereCount} here now</span>}
          </p>
        </div>

        {/* The session panel: what the organizer actually runs the event
            with. QR code is always visible once a session exists, so it can
            be printed or projected ahead of time — scanning just won't
            succeed until the session is actually running. */}
        <div className="rounded-2xl border border-border bg-secondary/30 p-5 mb-6">
          {(!session || session.status === 'none') && !showStartForm && (
            <>
              <p className="text-sm font-semibold text-foreground mb-1">This event hasn't started</p>
              <p className="text-xs text-muted-foreground mb-4">
                Start it when you're ready, or schedule it to start on its own — a volunteer's first scan will also start it automatically if you forget.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={openStartForm} size="sm" className="rounded-full text-xs">
                  <Play className="w-3.5 h-3.5 mr-1.5" /> Start Event
                </Button>
                {/* First-time organizers land here with no idea what happens
                    next; this is the one page where that question is urgent. */}
                <button
                  onClick={() => navigate('/how-it-works')}
                  className="text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
                >
                  How does this work?
                </button>
              </div>
            </>
          )}

          {showStartForm && (
            <div>
              <p className="text-sm font-semibold text-foreground mb-3">
                {session && session.status !== 'none' ? 'Update timing' : 'Start Event'}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                <label htmlFor="tracker-field" className="text-xs text-muted-foreground">
                  Start time
                  <input id="tracker-field" type="datetime-local" value={startAt} onChange={e => setStartAt(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground" />
                </label>
                <label htmlFor="tracker-field-2" className="text-xs text-muted-foreground">
                  Auto-stop time
                  <input id="tracker-field-2" type="datetime-local" value={stopAt} onChange={e => setStopAt(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground" />
                </label>
              </div>
              <p className="text-[11px] text-muted-foreground mb-3">
                A future start time lets you set this up remotely — it opens on its own, no one needs to be there to press the button. Auto-stop closes everyone's hours automatically if you don't stop it yourself.
              </p>
              {/* The QR is just a link, so anyone sent it could check in from
                  anywhere while the event runs. A code shown only on your
                  screen means they have to actually be there. */}
              <label htmlFor="tracker-field-3" className="flex items-start gap-2.5 mb-3 cursor-pointer">
                <input id="tracker-field-3" type="checkbox" checked={requirePin} onChange={e => setRequirePin(e.target.checked)} className="mt-0.5" />
                <span className="text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">Require a code to check in</span> — we'll show a 4-digit code on this page. Volunteers type it when they scan, so only people actually at the event can check in.
                </span>
              </label>
              <div className="flex gap-2">
                <Button onClick={submitStart} disabled={sessionActing} size="sm" className="rounded-full text-xs">
                  {sessionActing && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
                  {new Date(startAt) > new Date(Date.now() + 60_000) ? 'Schedule' : 'Start Now'}
                </Button>
                <Button onClick={() => setShowStartForm(false)} disabled={sessionActing} size="sm" variant="outline" className="rounded-full text-xs">
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {session && session.status !== 'none' && !showStartForm && (
            <div className="flex flex-col sm:flex-row gap-5">
              <div className="bg-white p-3 rounded-xl w-fit mx-auto sm:mx-0 flex-shrink-0">
                <QRCodeSVG value={checkinUrl} size={128} />
              </div>
              <div className="flex-1 min-w-0">
                {session.status === 'scheduled' && (
                  <p className="text-sm text-foreground">Starts {new Date(session.autoStartAt!).toLocaleString(undefined, { hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' })}</p>
                )}
                {/* An auto-started session never writes startedAt — it just
                    becomes running once autoStartAt passes — so fall back to
                    that rather than rendering an em dash. */}
                {session.status === 'running' && <p className="text-sm text-foreground">Started {fmtTime(session.startedAt ?? session.autoStartAt)} · auto-stops {fmtTime(session.autoStopAt)}</p>}
                {session.status === 'paused' && <p className="text-sm text-foreground">Paused — volunteers' clocks are on hold</p>}
                {/* Same fallback as the running line above: a session that ends by
                    auto-stop never writes stoppedAt, which is the COMMON case since
                    most organizers never press Stop. Without this it rendered
                    "Ended —" — a sentence that looks cut off. */}
                {session.status === 'stopped' && <p className="text-sm text-foreground">Ended {fmtTime(session.stoppedAt ?? session.autoStopAt)}</p>}
                <p className="text-xs text-muted-foreground mt-1">Volunteers scan this to check in and out. Print it or pull it up on a screen at the event.</p>

                {/* Shown here and nowhere else — that's the whole mechanism. */}
                {session.checkinPin && session.status !== 'stopped' && (
                  <div className="mt-3 rounded-xl border border-border bg-background px-3 py-2 inline-flex items-center gap-3">
                    <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Check-in code</span>
                    <span className="font-heading font-bold text-xl tracking-[0.3em] tabular-nums text-foreground">{session.checkinPin}</span>
                  </div>
                )}

                <div className="flex flex-wrap gap-2 mt-3">
                  <Button onClick={copyLink} variant="outline" size="sm" className="rounded-full text-xs">
                    {copied ? <Check className="w-3.5 h-3.5 mr-1.5" /> : <Copy className="w-3.5 h-3.5 mr-1.5" />}
                    {copied ? 'Copied' : 'Copy link'}
                  </Button>
                  {session.status === 'running' && (
                    <Button onClick={() => sessionAction('pause')} disabled={sessionActing} size="sm" variant="outline" className="rounded-full text-xs">
                      <Pause className="w-3.5 h-3.5 mr-1.5" /> Pause
                    </Button>
                  )}
                  {session.status === 'paused' && (
                    <Button onClick={() => sessionAction('resume')} disabled={sessionActing} size="sm" variant="outline" className="rounded-full text-xs">
                      <Play className="w-3.5 h-3.5 mr-1.5" /> Resume
                    </Button>
                  )}
                  {(session.status === 'running' || session.status === 'paused' || session.status === 'scheduled') && (
                    <Button onClick={() => sessionAction('stop')} disabled={sessionActing} size="sm" variant="outline" className="rounded-full text-xs text-red-500 hover:text-red-500">
                      <Square className="w-3.5 h-3.5 mr-1.5" /> End Event
                    </Button>
                  )}
                  {session.status === 'stopped' && (
                    <Button onClick={openStartForm} disabled={sessionActing} size="sm" variant="outline" className="rounded-full text-xs">
                      <Play className="w-3.5 h-3.5 mr-1.5" /> Reopen
                    </Button>
                  )}
                  {(session.status === 'scheduled' || session.status === 'running' || session.status === 'paused') && (
                    <button onClick={openStartForm} className="text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors px-1">
                      Edit timing
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-border overflow-hidden mb-4">
          {data.roster.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-10">
              Nobody's committed to this one yet — Interested isn't enough to land here, they need to take the next step.
            </p>
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
                      <p className="font-medium text-foreground truncate flex items-center gap-1.5">
                        {r.username}
                        {/* Only shown to organizations this volunteer committed
                            to, and never on anything they share outward. */}
                        {r.isMinor === true && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 flex-shrink-0">
                            Under 18
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {r.status === 'here' && `${r.hoursNow} hrs so far · in at ${fmtTime(r.checkInAt)}`}
                        {r.status === 'left' && `${r.hoursVerified ?? r.hoursClaimed ?? 0} hrs · ${fmtTime(r.checkInAt)}–${fmtTime(r.checkOutAt)}`}
                        {r.status === 'coming' && (r.stepsAcknowledgedAt
                          ? 'Confirmed your sign-up steps · hasn’t checked in yet'
                          : 'Hasn’t checked in yet')}
                        {r.status === 'no_show' && 'Never checked in'}
                        {r.status === 'rejected' && 'Hours removed'}
                        {r.status === 'requested' && `Didn’t scan — asking you to confirm ${opp.duration} hrs`}
                        {showFlag && <span className="text-muted-foreground"> · missed {rel.noShows} of {rel.total} with you</span>}
                      </p>
                      {/* Still checked in when the clock ran out — their real
                          hours may be higher, and only you can know. */}
                      {r.cutShort && (
                        <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                          Still checked in when the event ended — adjust if they stayed longer
                        </p>
                      )}
                      {r.overListed && !r.cutShort && (
                        <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                          More than the {opp.duration} hrs this event was listed for
                        </p>
                      )}
                    </div>
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${meta.cls}`}>{meta.label}</span>
                    <div className="flex-shrink-0 w-[120px] text-right">
                      {busy ? (
                        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground inline-block" />
                      ) : editHoursFor === r.userId ? (
                        <div className="flex items-center justify-end gap-1.5">
                          <input
                            value={hoursDraft}
                            onChange={e => setHoursDraft(e.target.value)}
                            inputMode="decimal"
                            aria-label={`Hours for ${r.username}`}
                            className="w-14 rounded-lg border border-border bg-background px-2 py-1 text-xs text-right tabular-nums text-foreground"
                          />
                          <button onClick={() => saveHours(r)} className="text-xs font-semibold text-primary hover:underline">Save</button>
                          <button onClick={() => setEditHoursFor(null)} aria-label="Cancel" className="text-muted-foreground hover:text-foreground">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : r.status === 'requested' ? (
                        // The one row type that's a task. Two plain verbs,
                        // no dialog — the claim is small and reversible
                        // either way.
                        <div className="flex flex-col items-end gap-0.5">
                          <button onClick={() => markCame(r)} className="text-xs font-semibold text-primary hover:underline">
                            Confirm hours
                          </button>
                          <button onClick={() => removeCredit(r)} className="text-xs font-semibold text-muted-foreground hover:text-red-500 transition-colors">
                            Decline
                          </button>
                        </div>
                      ) : (r.status === 'coming' || r.status === 'no_show') ? (
                        <button
                          onClick={() => markCame(r)}
                          className="text-xs font-semibold text-primary hover:underline"
                        >
                          Mark as came
                        </button>
                      ) : (r.status === 'here' || r.status === 'left') ? (
                        <div className="flex flex-col items-end gap-0.5">
                          <button
                            onClick={() => { setEditHoursFor(r.userId); setHoursDraft(String(r.hoursVerified ?? r.hoursNow ?? 0)); }}
                            className="text-xs font-semibold text-primary hover:underline"
                          >
                            Set hours
                          </button>
                          <button
                            onClick={() => removeCredit(r)}
                            className="text-xs font-semibold text-muted-foreground hover:text-red-500 transition-colors"
                          >
                            Remove hours
                          </button>
                        </div>
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

        {/* This page is open on the organizer's phone AT the event. If something
            is going wrong, it is going wrong here — so the way to reach us
            belongs on this screen, not only in the instructions. */}
        <p className="text-xs text-muted-foreground mt-6">
          Something wrong with this event?{' '}
          <a href="mailto:linklocal2@gmail.com" className="font-semibold text-primary hover:underline">
            linklocal2@gmail.com
          </a>
        </p>
      </main>
    </div>
  );
}

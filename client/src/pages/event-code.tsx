import { useEffect, useState } from 'react';
import { useRoute, useLocation } from 'wouter';
import { QRCodeSVG } from 'qrcode.react';
import { Printer, Loader2, Users, QrCode, Clock, AlertTriangle, UserX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/lib/store';
import { formatDay } from '@/lib/utils';

interface Person {
  id: string; name: string; startedAt: string | null; endedAt: string | null;
  hours: number; committed: boolean; expected: boolean; returning: boolean;
}
interface Roster {
  postedHours: number;
  hereNow: Person[]; finished: Person[]; neverScannedOut: Person[]; walkedUp: Person[];
  notArrived: { id: number; name: string; committed: boolean }[];
  totalHours: number;
}

interface Codes {
  eventTitle: string;
  serviceDate: string;
  hours: number;
  printedCode: string;
  liveCode: string;
  secondsLeft: number;
  running: number;
}

async function call<T>(path: string): Promise<T> {
  const token = localStorage.getItem('locallink_token');
  const res = await fetch(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data as T;
}

/**
 * The organizer's screen. Two codes, and the difference between them is the
 * whole security model.
 *
 * The printed sheet goes on a table and only lets people START. The live code
 * redraws every thirty seconds and is the only way to FINISH — so a screenshot
 * texted to someone at home has expired long before they open it.
 */
export default function EventCodePage() {
  const [, params] = useRoute('/event-code/:id');
  const id = params?.id ?? '';
  const { isLoggedIn } = useAuthStore();
  const [, navigate] = useLocation();

  const [data, setData] = useState<Codes | null>(null);
  const [roster, setRoster] = useState<Roster | null>(null);
  const [tab, setTab] = useState<'codes' | 'roster'>('codes');
  const [error, setError] = useState('');
  const [left, setLeft] = useState(30);

  useEffect(() => {
    if (!isLoggedIn) { navigate('/account'); return; }
    let alive = true;
    const pull = () =>
      call<Codes>(`/api/events/${id}/codes`)
        .then(d => { if (alive) { setData(d); setLeft(d.secondsLeft); } })
        .catch((e: Error) => alive && setError(e.message));
    pull();
    // Re-fetch just after the code is due to turn over. The server is the only
    // thing that knows the secret, so the phone never computes a code itself.
    const tick = setInterval(() => {
      setLeft(s => {
        if (s <= 1) { pull(); return 30; }
        return s - 1;
      });
    }, 1000);
    // The roster is refreshed on its own, slower clock. People arrive over
    // twenty minutes, not every second, and a list that reshuffles under a
    // thumb is worse than one that is a few seconds stale.
    const pullRoster = () =>
      call<Roster>(`/api/events/${id}/roster`).then(r => alive && setRoster(r)).catch(() => {});
    pullRoster();
    const rosterTick = setInterval(pullRoster, 15000);
    return () => { alive = false; clearInterval(tick); clearInterval(rosterTick); };
  }, [id, isLoggedIn, navigate]);

  if (!isLoggedIn) return null;
  if (error) {
    return (
      <div className="max-w-md mx-auto px-4 py-16 pb-24 text-center">
        <h1 className="font-heading text-xl font-bold text-foreground">Cannot show those codes</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }
  if (!data) {
    return <div className="flex justify-center py-24"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>;
  }

  const origin = window.location.origin;
  const printedUrl = `${origin}/scan/${data.printedCode}`;
  const liveUrl = `${printedUrl}?k=${data.liveCode}`;

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 pb-24">
      <div className="no-print">
        <h1 className="font-heading text-2xl font-bold text-foreground">{data.eventTitle}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {formatDay(data.serviceDate)} · posted as {data.hours}h
          {data.running > 0 && (
            <> · <span className="text-foreground font-medium">
              <Users className="inline w-3.5 h-3.5 mr-1" />{data.running} still running
            </span></>
          )}
        </p>
      </div>

      {/* Two jobs, one screen: hand out codes, and see who is actually here.
          Both happen standing up in the same ten minutes. */}
      <div className="no-print mt-5 flex gap-0 border border-border rounded-xl overflow-hidden">
        {(['codes', 'roster'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            aria-pressed={tab === t}
            className={`flex-1 py-2.5 text-sm font-semibold transition-colors cursor-pointer ${
              tab === t ? 'bg-foreground text-background' : 'bg-card text-muted-foreground hover:bg-accent'
            }`}>
            {t === 'codes' ? <><QrCode className="inline w-4 h-4 mr-1.5" />Codes</>
                           : <><Users className="inline w-4 h-4 mr-1.5" />Who came
                               {roster && roster.hereNow.length > 0 && (
                                 <span className="ml-1.5 text-xs">({roster.hereNow.length} here)</span>
                               )}</>}
          </button>
        ))}
      </div>

      {tab === 'roster' && (
        <div className="no-print mt-4 space-y-4">
          {!roster ? (
            <div className="flex justify-center py-12"><Loader2 className="w-7 h-7 animate-spin text-muted-foreground" /></div>
          ) : (
            <>
              <RosterGroup
                title="Here now" tone="live" icon={<Clock className="w-4 h-4" />}
                blurb="Clocked in and not finished yet."
                people={roster.hereNow} showElapsed />

              <RosterGroup
                title="Finished" tone="good" icon={<Users className="w-4 h-4" />}
                blurb={`${roster.totalHours}h recorded so far.`}
                people={roster.finished} />

              <RosterGroup
                title="Never scanned out" tone="warn" icon={<AlertTriangle className="w-4 h-4" />}
                blurb={`We gave each of them the ${roster.postedHours}h this was posted for. We will email you if any were not really here.`}
                people={roster.neverScannedOut} />

              {/* No separate "walked up" group. Walking up is not a state, it
                  is something true about a person who is already in one of the
                  groups above — listing them twice showed the same name in two
                  places, the second time with a meaningless 0h because their
                  clock was still running. The tag beside the name says it. */}

              {roster.notArrived.length > 0 && (
                <div className="rounded-2xl border border-border bg-card p-4">
                  <p className="flex items-center gap-1.5 font-heading font-semibold text-foreground">
                    <UserX className="w-4 h-4" /> Said they were coming, no scan
                  </p>
                  <p className="mt-0.5 mb-2.5 text-xs text-muted-foreground">
                    Either they did not come, or their phone let them down. You can add them from the
                    email we send after the event.
                  </p>
                  <div className="space-y-1.5">
                    {roster.notArrived.map(p => (
                      <div key={p.id} className="flex items-center justify-between text-sm">
                        <span className="text-foreground">{p.name}</span>
                        {p.committed && <span className="text-xs text-muted-foreground">committed</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                Names only. We do not show you anyone's email address, age or phone number.
              </p>
            </>
          )}
        </div>
      )}

      {tab === 'codes' && (<>
      {/* Finishing. First, because it is the one that needs a person holding the
          phone up while volunteers leave. */}
      <div className="no-print mt-6 rounded-2xl border border-border bg-card p-6 text-center">
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
          Hold this up when people leave
        </p>
        <div className="mt-4 mx-auto w-full max-w-[232px] rounded-xl bg-white p-4">
          <QRCodeSVG value={liveUrl} size={200} level="M" style={{ width: '100%', height: 'auto' }} />
        </div>
        <p className="mt-4 font-heading text-3xl font-bold tracking-[0.2em] text-foreground tabular-nums">
          {data.liveCode}
        </p>
        <div className="mt-3 mx-auto h-1.5 w-40 overflow-hidden rounded-full bg-border">
          <div
            className="h-full bg-primary transition-[width] duration-1000 ease-linear"
            style={{ width: `${(left / 30) * 100}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {/* {left} counts down to the NEXT code. Phrasing it as "a new code
              every {left}s" read as though the interval itself were shrinking. */}
          Next code in {left}s. Each one keeps working for two minutes after it appears, so nobody
          has to rush. This is the only code that can finish someone's time.
        </p>
      </div>

      {/* Starting. Print once, tape it up, forget it. */}
      <div className="mt-4 rounded-2xl border border-border bg-card p-6">
        <div className="no-print flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-heading font-semibold text-foreground">The sheet to print</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Tape it where people arrive. It can only start someone's time, so it does not matter if
              it is photographed.
            </p>
          </div>
          <Button variant="outline" className="rounded-md" onClick={() => window.print()}>
            <Printer className="w-4 h-4 mr-1.5" /> Print
          </Button>
        </div>

        {/* What actually comes out of the printer. */}
        <div className="mt-5 rounded-xl border border-border p-8 text-center">
          <p className="font-heading text-sm font-bold uppercase tracking-widest text-muted-foreground">
            LocalLink
          </p>
          <h2 className="mt-2 font-heading text-2xl font-bold text-foreground">{data.eventTitle}</h2>
          <p className="mt-1 text-sm text-muted-foreground">Scan to start your volunteer time</p>
          <div className="mt-5 mx-auto w-full max-w-[272px] rounded-xl bg-white p-4">
            <QRCodeSVG value={printedUrl} size={240} level="M" style={{ width: '100%', height: 'auto' }} />
          </div>
          <p className="mt-5 text-sm text-foreground">
            Point your phone camera at this square.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            When you leave, ask {`the organizer`} to show the finishing code on their phone.
          </p>
        </div>
      </div>
      </>)}
    </div>
  );
}

/** One group on the roster. Empty groups are hidden rather than shown empty --
 *  a coordinator scanning this on a phone should see only what is true. */
function RosterGroup({ title, blurb, people, tone, icon, showElapsed }: {
  title: string; blurb: string; people: Person[];
  tone: 'live' | 'good' | 'warn' | 'plain'; icon: React.ReactNode; showElapsed?: boolean;
}) {
  if (people.length === 0) return null;
  const ring = tone === 'live' ? 'border-primary/40 bg-primary/5'
             : tone === 'warn' ? 'border-amber-500/40 bg-amber-500/5'
             : 'border-border bg-card';
  const since = (iso: string | null) => {
    if (!iso) return '';
    const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
    return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
  };
  const at = (iso: string | null) =>
    iso ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';

  return (
    <div className={`rounded-2xl border p-4 ${ring}`}>
      <p className="flex items-center gap-1.5 font-heading font-semibold text-foreground">
        {icon} {title} <span className="font-normal text-muted-foreground">({people.length})</span>
      </p>
      <p className="mt-0.5 mb-3 text-xs text-muted-foreground">{blurb}</p>
      <div className="space-y-2">
        {people.map(p => (
          <div key={p.id} className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <span className="text-sm text-foreground">{p.name}</span>
              {p.returning && (
                <span className="ml-2 text-[11px] text-muted-foreground">been before</span>
              )}
              {!p.expected && (
                <span className="ml-2 text-[11px] text-muted-foreground">walked up</span>
              )}
            </div>
            <div className="shrink-0 text-right">
              <div className="text-sm font-semibold tabular-nums text-foreground">
                {showElapsed ? since(p.startedAt) : `${p.hours}h`}
              </div>
              {!showElapsed && p.endedAt && (
                <div className="text-[11px] tabular-nums text-muted-foreground">
                  {at(p.startedAt)} – {at(p.endedAt)}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

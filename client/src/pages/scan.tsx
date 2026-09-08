import { useEffect, useState } from 'react';
import { useRoute, useLocation } from 'wouter';
import { Clock, Check, Loader2, QrCode } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/lib/store';
import { formatDay } from '@/lib/utils';

interface Scan {
  eventTitle: string;
  orgName: string;
  postedHours: number;
  serviceDate: string;
  state: 'none' | 'running' | 'done';
  startedAt: string | null;
  hours: number | null;
}

async function call<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body) headers['content-type'] = 'application/json';
  const token = localStorage.getItem('locallink_token');
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { ...opts, headers });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong'), { code: data.code });
  return data as T;
}

/** mm:ss since they scanned in. */
function elapsed(fromIso: string, nowMs: number): string {
  const mins = Math.max(0, Math.floor((nowMs - new Date(fromIso).getTime()) / 60000));
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
}

/**
 * Where a volunteer lands after scanning either code.
 *
 * The printed sheet can only start their time. Finishing needs the code on the
 * organizer's phone, which is redrawn every thirty seconds — so a screenshot
 * texted to someone at home is dead long before they can use it.
 */
export default function ScanPage() {
  const [, params] = useRoute('/scan/:code');
  const code = params?.code ?? '';
  const { isLoggedIn } = useAuthStore();
  const [, navigate] = useLocation();

  const [info, setInfo] = useState<Scan | null>(null);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());

  // The live code rides in the query string of the organizer's QR, so scanning
  // their phone lands here already carrying proof of being in front of it.
  const liveCode = new URLSearchParams(window.location.search).get('k') ?? '';

  useEffect(() => {
    if (!isLoggedIn) {
      // Keep where they were going. Scanning a code is the worst possible
      // moment to lose someone to a sign-in page.
      sessionStorage.setItem('locallink_after_login', window.location.pathname + window.location.search);
      navigate('/account');
      return;
    }
    call<Scan>(`/api/scan/${code}`).then(setInfo).catch((e: Error) => setLoadError(e.message));
  }, [code, isLoggedIn, navigate]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  async function press() {
    setError(''); setBusy(true);
    try {
      const r = await call<{ state: string; hours?: number; startedAt?: string }>(`/api/scan/${code}`, {
        method: 'POST',
        body: JSON.stringify({ liveCode }),
      });
      setInfo(i => i && ({ ...i, state: r.state as any, hours: r.hours ?? i.hours, startedAt: r.startedAt ?? i.startedAt }));
    } catch (e: any) {
      setError(e.message);
    } finally { setBusy(false); }
  }

  if (!isLoggedIn) return null;

  if (loadError) {
    return (
      <div className="max-w-md mx-auto px-4 py-16 pb-24 text-center">
        <h1 className="font-heading text-xl font-bold text-foreground">That code did not work</h1>
        <p className="mt-2 text-sm text-muted-foreground">{loadError}</p>
      </div>
    );
  }
  if (!info) {
    return <div className="flex justify-center py-24"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="max-w-md mx-auto px-4 py-10 pb-24">
      <div className="rounded-2xl bg-card border border-border p-6 text-center">
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{info.orgName}</p>
        <h1 className="mt-1 font-heading text-2xl font-bold text-foreground">{info.eventTitle}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {formatDay(info.serviceDate)} · posted as {info.postedHours}h
        </p>

        {info.state === 'none' && (
          <>
            <p className="mt-6 text-sm text-muted-foreground">
              Start your time when you arrive. To finish, scan the code on the organizer's phone.
            </p>
            <Button onClick={press} disabled={busy} className="mt-5 h-12 w-full text-base">
              {busy ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Starting…</>
                    : <><Clock className="w-4 h-4 mr-2" /> Start my time</>}
            </Button>
          </>
        )}

        {info.state === 'running' && (
          <>
            <div className="mt-6 rounded-xl bg-primary/5 border border-primary/20 py-6">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Running</p>
              <p className="mt-1 font-heading text-4xl font-bold text-foreground tabular-nums">
                {info.startedAt ? elapsed(info.startedAt, now) : '—'}
              </p>
            </div>
            {liveCode ? (
              <Button onClick={press} disabled={busy} className="mt-5 h-12 w-full text-base">
                {busy ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Finishing…</>
                      : <><Check className="w-4 h-4 mr-2" /> Finish my time</>}
              </Button>
            ) : (
              <div className="mt-5 rounded-xl border border-border bg-background p-4">
                <QrCode className="w-6 h-6 mx-auto text-muted-foreground" />
                <p className="mt-2 text-sm text-foreground font-medium">Scan the organizer's phone to finish</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  The printed sheet can only start your time. Ask the organizer to show their code when
                  you leave — it changes every 30 seconds, so it has to be scanned there and then.
                </p>
              </div>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              If you cannot scan out, we will record the {info.postedHours} hours the event was posted
              for and tell {info.orgName}, who can correct it.
            </p>
          </>
        )}

        {info.state === 'done' && (
          <>
            <div className="mt-6 mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-500/10">
              <Check className="h-6 w-6 text-green-600" />
            </div>
            <p className="mt-3 font-heading text-2xl font-bold text-foreground tabular-nums">{info.hours}h</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Recorded and confirmed. It already counts toward your certificate.
            </p>
            <Button variant="outline" onClick={() => navigate('/hours')} className="mt-5 rounded-md">
              See my hours
            </Button>
          </>
        )}

        {error && (
          <div role="alert" className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useRoute } from 'wouter';
import { Check, Users, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatDay } from '@/lib/utils';
import { cn } from '@/lib/utils';

interface Person { id: string; name: string }
interface Ask {
  eventTitle: string;
  serviceDate: string;
  hours: number;
  hostName: string;
  alreadyAnswered: boolean;
  roster: Person[];
}

/**
 * The organization's whole job, on one page, with no account.
 *
 * A Saturday event with twelve students used to be twelve separate emails to
 * the same coordinator. This is one: tick who came, press the button, done.
 * If this page is not finishable in under a minute on a phone, the tracker
 * does not work, because the organization is the side that can simply stop
 * replying.
 */
export default function AttendancePage() {
  const [, params] = useRoute('/attendance/:token');
  const token = params?.token ?? '';

  const [ask, setAsk] = useState<Ask | null>(null);
  const [loadError, setLoadError] = useState('');
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [hours, setHours] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<number | null>(null);

  useEffect(() => {
    fetch(`/api/attendance/${token}`)
      .then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; })
      .then((d: Ask) => {
        setAsk(d);
        // Everyone starts ticked. Far more people turn up than do not, so the
        // common case should be one press, and unticking a no-show is the
        // exception rather than the work.
        const all: Record<string, boolean> = {};
        const hrs: Record<string, string> = {};
        for (const p of d.roster) { all[p.id] = true; hrs[p.id] = String(d.hours); }
        setPicked(all); setHours(hrs);
      })
      .catch((e: Error) => setLoadError(e.message));
  }, [token]);

  const chosen = ask ? ask.roster.filter(p => picked[p.id]) : [];

  async function submit() {
    setError(''); setBusy(true);
    try {
      const res = await fetch(`/api/attendance/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          present: chosen.map(p => ({ userId: p.id, hours: Number(hours[p.id]) || ask!.hours })),
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      setDone(d.confirmed);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-background pb-24 font-sans">
        <div className="container mx-auto max-w-lg px-4 py-12">
          <div className="rounded-2xl border border-border bg-card p-6">
            <h1 className="font-heading text-xl font-bold text-foreground">This link does not work</h1>
            <p className="mt-2 text-sm text-muted-foreground">{loadError}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!ask) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (done !== null || ask.alreadyAnswered) {
    return (
      <div className="min-h-screen bg-background pb-24 font-sans">
        <div className="container mx-auto max-w-lg px-4 py-12">
          <div className="rounded-2xl border border-border bg-card p-6 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-500/10">
              <Check className="h-6 w-6 text-green-600" />
            </div>
            <h1 className="font-heading text-xl font-bold text-foreground">
              {done ? 'Thank you — that is recorded' : 'This has already been answered'}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {done
                ? `${done} ${done === 1 ? 'person has' : 'people have'} had their hours confirmed, and they have been told.`
                : 'Someone has already confirmed who came to this event.'}
            </p>
            <p className="mt-4 text-xs text-muted-foreground">
              Nothing else is needed from you, and we will not email you about this event again.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-24 font-sans">
      <div className="container mx-auto max-w-lg px-4 py-8">
        <h1 className="font-heading text-2xl font-bold text-foreground">Who came?</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{ask.eventTitle}</span> ·{' '}
          {formatDay(ask.serviceDate)}
        </p>
        <p className="mt-3 text-sm text-muted-foreground">
          Everyone below signed up. Untick anyone who did not turn up, then press the button.
          You do not need an account.
        </p>

        {error && (
          <div role="alert" className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="mt-5 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
          {ask.roster.map(p => {
            const on = !!picked[p.id];
            return (
              <div key={p.id} className="flex items-center gap-3 p-3">
                {/* The whole row is the target, not just the box -- this is used
                    one-handed on a phone. */}
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  onClick={() => setPicked(v => ({ ...v, [p.id]: !on }))}
                  className="flex min-h-[44px] flex-1 cursor-pointer items-center gap-3 text-left"
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 transition-colors',
                      on ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background'
                    )}
                  >
                    {on && <Check className="h-4 w-4" strokeWidth={3} />}
                  </span>
                  <span className={cn('text-[15px]', on ? 'text-foreground' : 'text-muted-foreground line-through')}>
                    {p.name}
                  </span>
                </button>

                <div className="flex shrink-0 items-center gap-1.5">
                  <label htmlFor={`hours-${p.id}`} className="sr-only">
                    Hours for {p.name}
                  </label>
                  <Input
                    id={`hours-${p.id}`}
                    value={hours[p.id] ?? ''}
                    onChange={e => setHours(v => ({ ...v, [p.id]: e.target.value }))}
                    disabled={!on}
                    inputMode="decimal"
                    className="h-11 w-16 text-center tabular-nums"
                  />
                  <span className="text-sm text-muted-foreground">h</span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-5">
          <Button onClick={submit} disabled={busy || chosen.length === 0} className="h-12 w-full text-base">
            {busy ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Recording…</>
            ) : chosen.length === 0 ? (
              'Nobody came'
            ) : (
              <><Users className="mr-2 h-4 w-4" /> Confirm {chosen.length} {chosen.length === 1 ? 'person' : 'people'}</>
            )}
          </Button>
          {chosen.length === 0 && (
            <p className="mt-2 text-center text-xs text-muted-foreground">
              If nobody turned up, you can simply close this — nothing is recorded either way.
            </p>
          )}
        </div>

        <p className="mt-6 text-xs text-muted-foreground">
          This confirms their hours toward a service record their school can check. It is the only
          email we will send you about this event.
        </p>
      </div>
    </div>
  );
}

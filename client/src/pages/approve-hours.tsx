import { useEffect, useState } from 'react';
import { useRoute } from 'wouter';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatDay } from '@/lib/utils';

interface Ask {
  volunteerName: string; orgName: string; activity: string;
  serviceDate: string; hours: number; approverName: string | null;
}

/**
 * Where a supervisor lands from their email. No account, nothing to learn.
 * The whole tracker depends on this being a ten-second job for someone who has
 * never heard of LocalLink.
 */
export default function ApproveHoursPage() {
  const [, params] = useRoute('/approve-hours/:token');
  const token = params?.token ?? '';
  const [ask, setAsk] = useState<Ask | null>(null);
  const [loadError, setLoadError] = useState('');
  const [mode, setMode] = useState<'choose' | 'adjust' | 'reject'>('choose');
  const [hours, setHours] = useState('');
  const [note, setNote] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ status: string; hours: number } | null>(null);

  useEffect(() => {
    fetch(`/api/approve-hours/${token}`)
      .then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; })
      .then((d: Ask) => {
        setAsk(d); setHours(String(d.hours)); setName(d.approverName ?? '');
        const wanted = new URLSearchParams(window.location.search).get('decision');
        if (wanted === 'adjust') setMode('adjust');
        if (wanted === 'reject') setMode('reject');
      })
      .catch((e: Error) => setLoadError(e.message));
  }, [token]);

  async function decide(decision: 'approve' | 'adjust' | 'reject') {
    setError(''); setBusy(true);
    try {
      const res = await fetch(`/api/approve-hours/${token}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision, hours: Number(hours), note, approverName: name }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      setDone(d);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  if (loadError) {
    return (
      <div className="max-w-lg mx-auto px-4 py-16">
        <div className="rounded-2xl bg-card border border-border p-6">
          <h1 className="font-heading text-xl font-bold text-foreground">This link does not work</h1>
          <p className="mt-2 text-sm text-muted-foreground">{loadError}</p>
        </div>
      </div>
    );
  }
  if (!ask) return <div className="py-20 text-center text-muted-foreground">Loading…</div>;

  if (done) {
    return (
      <div className="max-w-lg mx-auto px-4 py-16">
        <div className="rounded-2xl bg-card border border-border p-6">
          <h1 className="font-heading text-xl font-bold text-foreground">
            {done.status === 'rejected' ? 'Marked as not confirmed' : 'Thank you — that is recorded'}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {done.status === 'rejected'
              ? `We have told ${ask.volunteerName} these hours were not confirmed.`
              : `${ask.volunteerName}'s ${done.hours} hours with ${ask.orgName} are confirmed. They have been told.`}
          </p>
          <p className="mt-4 text-xs text-muted-foreground">
            Nothing else is needed from you, and this link will not work again.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-10">
      <h1 className="font-heading text-2xl font-bold text-foreground">Can you confirm this?</h1>
      <p className="mt-1.5 mb-5 text-sm text-muted-foreground">
        <strong className="text-foreground">{ask.volunteerName}</strong> says they volunteered with{' '}
        <strong className="text-foreground">{ask.orgName}</strong> and named you as the person who
        would know. You do not need an account.
      </p>

      <div className="rounded-2xl bg-card border border-border p-5">
        <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2.5 text-sm">
          <dt className="text-muted-foreground">What they did</dt><dd className="text-foreground">{ask.activity}</dd>
          <dt className="text-muted-foreground">Date</dt><dd className="text-foreground">{formatDay(ask.serviceDate, 'long')}</dd>
          <dt className="text-muted-foreground">Hours claimed</dt>
          <dd className="font-heading text-lg font-bold text-foreground tabular-nums">{ask.hours}</dd>
        </dl>
      </div>

      {error && <p className="mt-4 rounded-md bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="mt-5">
        {mode === 'choose' && (
          <div className="space-y-3">
            <Button onClick={() => decide('approve')} disabled={busy}
              className="w-full rounded-md bg-green-600 hover:bg-green-700 text-white">
              {busy ? 'Recording…' : `Yes — ${ask.hours} hours is right`}
            </Button>
            <div className="flex flex-wrap gap-4 text-sm">
              <button onClick={() => setMode('adjust')} className="text-primary underline underline-offset-4 cursor-pointer">
                The hours were different
              </button>
              <button onClick={() => setMode('reject')} className="text-muted-foreground underline underline-offset-4 cursor-pointer">
                They did not volunteer with us
              </button>
            </div>
          </div>
        )}

        {mode === 'adjust' && (
          <div className="rounded-2xl bg-card border border-border p-5">
            <h2 className="font-heading font-semibold text-foreground">Change the hours</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-semibold text-foreground mb-1.5">Hours they actually did</label>
                <Input value={hours} onChange={e => setHours(e.target.value)} inputMode="decimal" className="rounded-md" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-foreground mb-1.5">Your name</label>
                <Input value={name} onChange={e => setName(e.target.value)} placeholder="Dana Reed" className="rounded-md" />
                <p className="mt-1 text-xs text-muted-foreground">Shown on their certificate.</p>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-semibold text-foreground mb-1.5">A note, if useful</label>
                <Input value={note} onChange={e => setNote(e.target.value)} maxLength={300}
                  placeholder="Left half an hour early" className="rounded-md" />
                <p className="mt-1 text-xs text-muted-foreground">They will see this.</p>
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <Button onClick={() => decide('adjust')} disabled={busy} className="rounded-md">
                {busy ? 'Recording…' : 'Confirm these hours'}
              </Button>
              <Button variant="outline" onClick={() => setMode('choose')} disabled={busy} className="rounded-md">Back</Button>
            </div>
          </div>
        )}

        {mode === 'reject' && (
          <div className="rounded-2xl bg-card border border-border p-5">
            <h2 className="font-heading font-semibold text-foreground">They did not volunteer with us</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              These hours will not count, and {ask.volunteerName} will be told. We will not ask you again.
            </p>
            <div className="mt-3">
              <label className="block text-sm font-semibold text-foreground mb-1.5">A reason, if you want to give one</label>
              <Input value={note} onChange={e => setNote(e.target.value)} maxLength={300}
                placeholder="We have no record of them" className="rounded-md" />
            </div>
            <div className="mt-4 flex gap-2">
              <Button onClick={() => decide('reject')} disabled={busy}
                className="rounded-md bg-red-600 hover:bg-red-700 text-white">
                {busy ? 'Recording…' : 'Confirm — they did not'}
              </Button>
              <Button variant="outline" onClick={() => setMode('choose')} disabled={busy} className="rounded-md">Back</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useRoute } from 'wouter';
import { ShieldCheck, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Entry { orgName: string; orgConfirmed: boolean; activity: string; serviceDate: string; hours: number; approverName: string | null }
interface Full { holderName: string; totalHours: number; confirmedOrgHours: number; issuedAt: string; revoked: boolean; entries: Entry[] }

const fmt = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('en-US',
    { month: 'short', day: 'numeric', year: 'numeric' });

/** Deliberately open. A teacher holding a printed certificate has no account
 *  here, and asking them to make one is the fastest way to have it disbelieved. */
export default function CheckCertificatePage() {
  const [, params] = useRoute('/check/:code');
  const [code, setCode] = useState(params?.code ?? '');
  const [result, setResult] = useState<Full | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function check(c: string) {
    setError(''); setResult(null); setBusy(true);
    try {
      const res = await fetch(`/api/verify-hours/${encodeURIComponent(c.trim())}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      setResult(d);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }
  useEffect(() => { if (params?.code) check(params.code); }, [params?.code]);

  return (
    <div className="max-w-2xl mx-auto px-4 py-10">
      <h1 className="font-heading text-2xl font-bold text-foreground">Check a certificate</h1>
      <p className="mt-1.5 mb-5 text-sm text-muted-foreground">
        Type the code printed on a LocalLink service record to see whether it is genuine and what it covers.
      </p>

      <form onSubmit={e => { e.preventDefault(); check(code); }}
        className="rounded-2xl bg-card border border-border p-5 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-56">
          <label className="block text-sm font-semibold text-foreground mb-1.5">Verification code</label>
          <Input value={code} onChange={e => setCode(e.target.value.toUpperCase())}
            placeholder="ABCD-1234" className="rounded-md font-heading tracking-wider" />
        </div>
        <Button type="submit" disabled={busy || !code.trim()} className="rounded-md">
          <Search className="w-4 h-4 mr-1.5" /> {busy ? 'Checking…' : 'Check'}
        </Button>
      </form>

      {error && (
        <p className="mt-5 rounded-md bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      {result && (
        <div className="mt-5 rounded-2xl bg-card border border-border p-5">
          {result.revoked && (
            <p className="mb-4 rounded-md bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
              This certificate has been withdrawn and should not be accepted.
            </p>
          )}
          <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-4">
            <div>
              <p className="text-xs text-muted-foreground">This record is genuine and belongs to</p>
              <p className="font-heading text-xl font-bold text-foreground">{result.holderName}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Confirmed hours</p>
              <p className="font-heading text-3xl font-bold text-foreground tabular-nums">{result.totalHours}</p>
            </div>
          </div>

          <ul className="mt-4 space-y-3">
            {result.entries.map((e, i) => (
              <li key={i} className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 pb-3 last:border-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <span className="block font-semibold text-foreground">{e.orgName}</span>
                  <span className="block text-sm text-muted-foreground">{e.activity}</span>
                  <span className="block text-xs text-muted-foreground">
                    {fmt(e.serviceDate)}{e.approverName ? ` · confirmed by ${e.approverName}` : ''}
                  </span>
                  {e.orgConfirmed ? (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-700 dark:text-green-400">
                      <ShieldCheck className="w-3 h-3" /> Confirmed organization
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">Approved by a named person</span>
                  )}
                </div>
                <span className="font-heading font-bold tabular-nums text-foreground">{e.hours}h</span>
              </li>
            ))}
          </ul>

          {result.confirmedOrgHours < result.totalHours && (
            <p className="mt-4 rounded-md bg-secondary px-4 py-3 text-xs text-muted-foreground">
              <strong className="text-foreground">{result.confirmedOrgHours} of {result.totalHours} hours</strong> are
              with organizations LocalLink has confirmed are real. The rest were approved by the named
              person, whose organization we have not independently confirmed.
            </p>
          )}
          <p className="mt-4 text-xs text-muted-foreground">Issued {fmt(result.issuedAt)}.</p>
        </div>
      )}
    </div>
  );
}

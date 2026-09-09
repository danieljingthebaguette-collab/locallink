import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { Award, ShieldCheck, Printer, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { useAuthStore } from '@/lib/store';
import { formatDay as fmt } from '@/lib/utils';

interface Cert { id: string; code: string; totalHours: number; confirmedOrgHours: number; issuedAt: string }
interface Entry { orgName: string; orgConfirmed: boolean; activity: string; serviceDate: string; hours: number; approverName: string | null; approverEmail?: string | null; approverKind?: string | null }
interface Full { holderName: string; totalHours: number; confirmedOrgHours: number; issuedAt: string; entries: Entry[] }

async function call<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const token = localStorage.getItem('locallink_token');
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { ...opts, headers });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data as T;
}

export default function CertificatePage() {
  const { isLoggedIn } = useAuthStore();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [certs, setCerts] = useState<Cert[] | null>(null);
  const [showing, setShowing] = useState<{ code: string; data: Full } | null>(null);
  const [busy, setBusy] = useState(false);
  // Asked for once, here, at the only moment it matters. There is no real-name
  // field on an account -- username is all this site has ever stored -- and a
  // "Verified Service Record" reading jsmith2027 is worth nothing to a school.
  const [askName, setAskName] = useState(false);
  const [fullName, setFullName] = useState('');

  const load = () => call<Cert[]>('/api/certificates').then(setCerts)
    .catch(e => toast({ title: e.message, variant: 'destructive' }));

  useEffect(() => {
    if (!isLoggedIn) { navigate('/account'); return; }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn]);

  async function issue() {
    setBusy(true);
    try {
      const { code } = await call<{ code: string }>('/api/certificates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(fullName.trim() ? { fullName: fullName.trim() } : {}),
      });
      setAskName(false);
      await load(); await open(code);
    } catch (e: any) {
      if (e.message === 'NEED_NAME') { setAskName(true); return; }
      toast({ title: e.message, variant: 'destructive' });
    } finally { setBusy(false); }
  }

  const open = async (code: string) =>
    setShowing({ code, data: await call<Full>(`/api/verify-hours/${code}`) });

  if (!isLoggedIn) return null;
  if (!certs) return <div className="py-20 text-center text-muted-foreground">Loading…</div>;

  if (showing) {
    const { code, data } = showing;
    return (
      <div className="max-w-3xl mx-auto px-4 py-8 pb-24">
        <div className="no-print mb-5 flex flex-wrap items-center gap-2">
          <Button variant="outline" className="rounded-md" onClick={() => setShowing(null)}>
            <ArrowLeft className="w-4 h-4 mr-1.5" /> Back
          </Button>
          <Button className="rounded-md" onClick={() => window.print()}>
            <Printer className="w-4 h-4 mr-1.5" /> Print or save as PDF
          </Button>
          <span className="text-sm text-muted-foreground">
            Anyone can check it at {window.location.origin}/check/{code}
          </span>
        </div>

        <div className="rounded-2xl bg-card border border-border p-8">
          <div className="border-b border-border pb-5">
            <p className="font-heading text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
              LocalLink
            </p>
            <h1 className="mt-1.5 font-heading text-2xl font-bold text-foreground">Verified Service Record</h1>
          </div>

          <div className="mt-6 flex flex-wrap items-end justify-between gap-5">
            <div>
              <p className="text-xs text-muted-foreground">Volunteer</p>
              <p className="font-heading text-xl font-bold text-foreground">{data.holderName}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Total confirmed hours</p>
              <p className="font-heading text-3xl font-bold text-foreground tabular-nums">{data.totalHours}</p>
            </div>
          </div>

          <div className="mt-7 overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Date</th>
                  <th className="py-2 pr-3 font-medium">Organization</th>
                  <th className="py-2 pr-3 font-medium">What was done</th>
                  <th className="py-2 pr-3 font-medium">Confirmed by</th>
                  <th className="py-2 text-right font-medium">Hours</th>
                </tr>
              </thead>
              <tbody>
                {data.entries.map((e, i) => (
                  <tr key={i} className="border-b border-border/60 align-top">
                    <td className="py-2.5 pr-3 whitespace-nowrap">{fmt(e.serviceDate)}</td>
                    <td className="py-2.5 pr-3">
                      <span className="block text-foreground">{e.orgName}</span>
                      {e.approverKind === 'locallink_org' ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-700 dark:text-green-400">
                          <ShieldCheck className="w-3 h-3" /> Confirmed by the organization on LocalLink
                        </span>
                      ) : e.approverKind === 'org_domain' ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-700 dark:text-green-400">
                          <ShieldCheck className="w-3 h-3" /> Confirmed by {e.approverEmail}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          Confirmed by {e.approverEmail ?? 'a named person'} — a personal email address
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3">{e.activity}</td>
                    <td className="py-2.5 pr-3">{e.approverName ?? '—'}</td>
                    <td className="py-2.5 text-right tabular-nums text-foreground">{e.hours}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data.confirmedOrgHours < data.totalHours && (
            <p className="mt-5 rounded-md bg-secondary px-4 py-3 text-xs text-muted-foreground">
              <strong className="text-foreground">{data.confirmedOrgHours} of {data.totalHours} hours</strong>
              were confirmed by the organization itself, or from an organization's own email address. The remainder were confirmed by the
              named person above, whose organization we have not independently confirmed.
            </p>
          )}

          <div className="mt-6 flex flex-wrap items-end justify-between gap-4 border-t border-border pt-5">
            <div>
              <p className="text-xs text-muted-foreground">Issued {fmt(data.issuedAt)}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Check this record at {window.location.origin}/check
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Verification code</p>
              <p className="font-heading text-lg font-bold tracking-wider text-foreground">{code}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 pb-24 space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-foreground">Certificate</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          A printable record of your confirmed hours, with a code your school can check.
        </p>
      </div>

      <div className="rounded-2xl bg-card border border-border p-5">
        <h2 className="font-heading font-semibold text-foreground">Make a new certificate</h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          It takes a snapshot of your confirmed hours right now. Older certificates keep saying what
          they said when you made them, so one you have already handed in never changes.
        </p>
        {askName && (
          <div className="mt-4 rounded-md border border-border bg-background p-4">
            <label htmlFor="cert-name" className="block text-sm font-semibold text-foreground">
              What name should the certificate show?
            </label>
            <p className="mt-1 mb-2 text-xs text-muted-foreground">
              Your full name, the way your school knows you — not your username. This is what your
              teacher will read, and it cannot be changed afterwards.
            </p>
            <Input
              id="cert-name"
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              placeholder="Maya Rodriguez"
              maxLength={80}
              autoFocus
              className="rounded-md"
            />
          </div>
        )}
        <Button
          className="mt-4 rounded-md"
          onClick={issue}
          disabled={busy || (askName && fullName.trim().length < 2)}
        >
          <Award className="w-4 h-4 mr-1.5" />
          {busy ? 'Making it…' : askName ? 'Make certificate' : 'Make certificate'}
        </Button>
      </div>

      {certs.length > 0 && (
        <div className="space-y-2">
          <h2 className="font-heading font-semibold text-foreground">Certificates you have made</h2>
          {certs.map(c => (
            <div key={c.id} className="rounded-2xl bg-card border border-border p-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-heading font-semibold tracking-wider text-foreground">{c.code}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {c.totalHours} hours · issued {fmt(c.issuedAt)}
                </p>
              </div>
              <Button variant="outline" className="rounded-md" onClick={() => open(c.code)}>Open</Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

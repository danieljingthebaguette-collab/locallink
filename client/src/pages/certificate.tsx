import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { Award, ShieldCheck, Printer, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useAuthStore } from '@/lib/store';

interface Cert { id: string; code: string; totalHours: number; confirmedOrgHours: number; issuedAt: string }
interface Entry { orgName: string; orgConfirmed: boolean; activity: string; serviceDate: string; hours: number; approverName: string | null }
interface Full { holderName: string; totalHours: number; confirmedOrgHours: number; issuedAt: string; entries: Entry[] }

const fmt = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('en-US',
    { month: 'short', day: 'numeric', year: 'numeric' });

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
      const { code } = await call<{ code: string }>('/api/certificates', { method: 'POST' });
      await load(); await open(code);
    } catch (e: any) { toast({ title: e.message, variant: 'destructive' }); }
    finally { setBusy(false); }
  }

  const open = async (code: string) =>
    setShowing({ code, data: await call<Full>(`/api/verify-hours/${code}`) });

  if (!isLoggedIn) return null;
  if (!certs) return <div className="py-20 text-center text-muted-foreground">Loading…</div>;

  if (showing) {
    const { code, data } = showing;
    return (
      <div className="max-w-3xl mx-auto px-4 py-8">
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
                      {e.orgConfirmed ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-700 dark:text-green-400">
                          <ShieldCheck className="w-3 h-3" /> Confirmed organization
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Approved by a named person</span>
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
              <strong className="text-foreground">{data.confirmedOrgHours} of {data.totalHours} hours</strong> are
              with organizations LocalLink has confirmed are real. The remainder were approved by the
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
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
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
        <Button className="mt-4 rounded-md" onClick={issue} disabled={busy}>
          <Award className="w-4 h-4 mr-1.5" /> {busy ? 'Making it…' : 'Make certificate'}
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

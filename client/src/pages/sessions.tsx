import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { QrCode, Plus, Loader2, ShieldCheck, Clock, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { useAuthStore } from '@/lib/store';
import { formatDay } from '@/lib/utils';

interface Session {
  id: string; title: string; date: string; duration: number; location: string;
  scanned: number; running: number;
}

async function call<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body) headers['content-type'] = 'application/json';
  const token = localStorage.getItem('locallink_token');
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { ...opts, headers });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw Object.assign(new Error(data.message || data.error || 'Something went wrong'),
    { code: data.error });
  return data as T;
}

/** Local datetime, in the shape the date input wants. */
function nowForInput(): string {
  const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
}

/**
 * Hours without a post on the board.
 *
 * Some organizations run the same shift every week and have no interest in
 * advertising it — they already know who is coming. They still want the hours
 * recorded, and the volunteer still wants a record their school accepts. A
 * session is that: codes to scan, nothing on the board.
 */
export default function SessionsPage() {
  const { isLoggedIn, currentUser } = useAuthStore();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [verified, setVerified] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ title: '', location: '', date: nowForInput(), duration: '2' });

  const isOrg = currentUser?.accountType === 'organization';

  async function load() {
    const d = await call<{ verified: boolean; sessions: Session[] }>('/api/tracker-sessions');
    setSessions(d.sessions); setVerified(d.verified);
  }

  useEffect(() => {
    if (!isLoggedIn) { navigate('/account'); return; }
    if (!isOrg) return;
    load().catch(e => toast({ title: e.message, variant: 'destructive' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn, isOrg]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const { id } = await call<{ id: string }>('/api/tracker-sessions', {
        method: 'POST',
        body: JSON.stringify({ ...form, duration: Number(form.duration) }),
      });
      navigate(`/event-code/${id}`);
    } catch (err: any) {
      toast({ title: err.message, variant: 'destructive' });
    } finally { setSaving(false); }
  }

  if (!isLoggedIn) return null;

  if (!isOrg) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 pb-24 text-center">
        <h1 className="font-heading text-2xl font-bold text-foreground">Sessions are for organizations</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          If you are volunteering, your hours live under <button onClick={() => navigate('/hours')}
            className="text-primary underline cursor-pointer">My Hours</button>.
        </p>
      </div>
    );
  }

  if (sessions === null) {
    return <div className="flex justify-center py-24"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 pb-24 space-y-5">
      <div>
        <h1 className="font-heading text-2xl font-bold text-foreground">Tracker sessions</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Codes people scan to record hours, without putting anything on the board. For the shifts you
          already have volunteers for.
        </p>
      </div>

      {/* The gate, said as a state of the account rather than as an error at the
          moment somebody tries to use it. */}
      {verified === false ? (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5">
          <h2 className="flex items-center gap-2 font-heading font-semibold text-foreground">
            <ShieldCheck className="w-4 h-4" /> We are checking your organization
          </h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Hours scanned here go on records that schools rely on, so we look at every organization
            before its codes work. It usually takes a day, and we will let you know.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            You can post on the board in the meantime — that is not affected.
          </p>
        </div>
      ) : (
        <>
          {!open ? (
            <Button className="rounded-md" onClick={() => setOpen(true)}>
              <Plus className="w-4 h-4 mr-1.5" /> New session
            </Button>
          ) : (
            <form onSubmit={create} className="rounded-2xl border border-border bg-card p-5 space-y-4">
              <h2 className="font-heading font-semibold text-foreground">New session</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label htmlFor="s-title" className="mb-1.5 block text-sm font-semibold text-foreground">
                    What is it?
                  </label>
                  <Input id="s-title" required value={form.title} maxLength={120}
                    onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                    placeholder="Thursday soup kitchen" className="rounded-md" />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Volunteers see this when they scan, and it goes on their certificate.
                  </p>
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="s-loc" className="mb-1.5 block text-sm font-semibold text-foreground">
                    Where?
                  </label>
                  <Input id="s-loc" required value={form.location}
                    onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                    placeholder="St John's hall" className="rounded-md" />
                </div>
                <div>
                  <label htmlFor="s-date" className="mb-1.5 block text-sm font-semibold text-foreground">
                    When does it start?
                  </label>
                  <Input id="s-date" type="datetime-local" required value={form.date}
                    onChange={e => setForm(f => ({ ...f, date: e.target.value }))} className="rounded-md" />
                </div>
                <div>
                  <label htmlFor="s-dur" className="mb-1.5 block text-sm font-semibold text-foreground">
                    How long?
                  </label>
                  <Input id="s-dur" required inputMode="decimal" value={form.duration}
                    onChange={e => setForm(f => ({ ...f, duration: e.target.value }))} className="rounded-md" />
                  {/* Not decoration: an unfinished clock pays this out, and a
                      finished one cannot exceed it by much. */}
                  <p className="mt-1 text-xs text-muted-foreground">
                    Hours. Anyone who forgets to scan out gets this much.
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={saving} className="rounded-md">
                  {saving ? 'Creating…' : 'Create and show codes'}
                </Button>
                <Button type="button" variant="outline" className="rounded-md" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </>
      )}

      {sessions.length === 0 ? (
        verified !== false && (
          <div className="rounded-2xl border border-border bg-card py-12 text-center">
            <QrCode className="mx-auto mb-3 h-9 w-9 text-muted-foreground/40" />
            <h2 className="font-heading font-semibold text-foreground">No sessions yet</h2>
            <p className="mx-auto mt-1.5 max-w-sm text-sm text-muted-foreground">
              Make one when you have a shift running. You get a sheet to print and a code on your
              phone, and that is the whole setup.
            </p>
          </div>
        )
      ) : (
        <div className="space-y-2">
          {sessions.map(s => (
            <button key={s.id} onClick={() => navigate(`/event-code/${s.id}`)}
              className="flex w-full flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/50 cursor-pointer">
              <div className="min-w-0">
                <p className="font-heading font-semibold text-foreground">{s.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {formatDay(s.date)} · {s.duration}h · {s.location}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3 text-sm">
                {s.running > 0 && (
                  <span className="inline-flex items-center gap-1 font-medium text-primary">
                    <Clock className="h-3.5 w-3.5" /> {s.running} here
                  </span>
                )}
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  <Users className="h-3.5 w-3.5" /> {s.scanned}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { Clock, Plus, Check, X, ShieldCheck, Award, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { useAuthStore } from '@/lib/store';
import { cn, formatDay as fmt } from '@/lib/utils';

interface HourLog {
  id: string; opportunityId: string | null; orgName: string; orgConfirmed: boolean;
  activity: string; serviceDate: string; hours: number;
  status: 'running' | 'pending' | 'approved' | 'adjusted' | 'rejected';
  approvedHours: number | null; approverName: string | null; approverNote: string | null;
  approverKind?: string | null; approverEmail?: string | null; source?: string;
  submittedAt?: string; decidedAt?: string | null; startedAt?: string | null;
}
interface Totals { confirmed: number; fromConfirmedOrgs: number; waiting: number; running: number; goalHours: number | null }
interface HoursPayload { logs: HourLog[]; totals: Totals; fullName: string | null }
interface Loggable { id: string; title: string; date: string; duration: number; hostName: string; location: string; hostEmail?: string | null; hostContact?: string | null }

const hoursOf = (l: HourLog) => l.approvedHours ?? l.hours;

/** A clock that is still running has no hours yet -- it had been rendering as
 *  "0h", which reads as a bug rather than as a clock. */
function runningFor(startedAt: string | null | undefined, nowMs: number): string {
  if (!startedAt) return '—';
  // Timestamps we write are ISO with a Z. Anything that reaches us in SQLite's
  // "YYYY-MM-DD HH:MM:SS" shape is UTC with nothing saying so, and reading it
  // as local time silently produces a clock stuck at zero.
  const iso = /[Zz]|[+-]\d{2}:?\d{2}$/.test(startedAt)
    ? startedAt
    : startedAt.replace(' ', 'T') + 'Z';
  const mins = Math.max(0, Math.floor((nowMs - new Date(iso).getTime()) / 60000));
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
}

async function call<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body) headers['content-type'] = 'application/json';
  const token = localStorage.getItem('locallink_token');
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { ...opts, headers: { ...headers, ...(opts.headers as any) } });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data as T;
}

const StatusPill = ({ status }: { status: string }) => {
  const map: Record<string, [string, string]> = {
    running: ['Clocked in', 'bg-primary/15 text-primary'],
    pending: ['Waiting on them', 'bg-amber-500/15 text-amber-700 dark:text-amber-400'],
    approved: ['Confirmed', 'bg-green-500/15 text-green-700 dark:text-green-400'],
    adjusted: ['Confirmed, hours changed', 'bg-green-500/15 text-green-700 dark:text-green-400'],
    rejected: ['Not confirmed', 'bg-red-500/15 text-red-600 dark:text-red-400'],
  };
  const [label, look] = map[status] ?? [status, 'bg-secondary text-muted-foreground'];
  return <span className={cn('inline-block rounded px-2 py-0.5 text-xs font-semibold', look)}>{label}</span>;
};

/** How an entry was confirmed, in words rather than by colour alone.
 *  The tier is decided by the server from the post and the address -- never
 *  from anything typed here -- so this only has to report it honestly. */
const TrustMark = ({ kind, email }: { kind?: string | null; email?: string | null }) => {
  if (kind === 'locallink_org') return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-700 dark:text-green-400">
      <ShieldCheck className="w-3.5 h-3.5" /> Confirmed by the organization on LocalLink
    </span>
  );
  if (kind === 'org_domain') return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-700 dark:text-green-400">
      <ShieldCheck className="w-3.5 h-3.5" /> Confirmed by {email ?? 'an organization email'}
    </span>
  );
  if (kind === 'personal') return (
    <span className="text-xs text-muted-foreground">
      Confirmed by {email ?? 'a personal email address'} — a personal address, so your school may ask more
    </span>
  );
  return <span className="text-xs text-muted-foreground">Not confirmed</span>;
};

export default function HoursPage() {
  const { isLoggedIn, currentUser } = useAuthStore();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [logs, setLogs] = useState<HourLog[] | null>(null);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [loggable, setLoggable] = useState<Loggable[]>([]);
  const [openForm, setOpenForm] = useState(false);
  const [prefill, setPrefill] = useState<Loggable | null>(null);
  const [goalDraft, setGoalDraft] = useState('');
  const [saving, setSaving] = useState(false);
  // Asked for here because this is where it starts mattering to somebody else:
  // the organization's attendance list shows this name, and a coordinator
  // cannot match "rosterC" to anyone who actually turned up.
  const [fullName, setFullName] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [now, setNow] = useState(Date.now());

  // Only ticks while something is actually running.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const [form, setForm] = useState({
    orgName: '', approverName: '', approverEmail: '', activity: '', serviceDate: '', hours: '',
  });

  const isVolunteer = currentUser?.accountType === 'volunteer';

  async function load() {
    const [d, l] = await Promise.all([
      call<HoursPayload>('/api/hours'),
      call<Loggable[]>('/api/hours/loggable').catch(() => [] as Loggable[]),
    ]);
    setLogs(d.logs); setTotals(d.totals); setLoggable(l); setFullName(d.fullName);
    setGoalDraft(d.totals.goalHours ? String(d.totals.goalHours) : '');
  }

  useEffect(() => {
    if (!isLoggedIn) { navigate('/account'); return; }
    if (!isVolunteer) return;
    load().catch(e => toast({ title: e.message, variant: 'destructive' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn, isVolunteer]);

  async function saveName() {
    const name = nameDraft.trim();
    if (name.length < 2) return;
    setSavingName(true);
    try {
      await call('/api/me/full-name', { method: 'PUT', body: JSON.stringify({ fullName: name }) });
      setFullName(name);
      toast({ title: 'Saved', description: 'This is the name organizations and your school will see.' });
    } catch (e: any) {
      toast({ title: e.message, variant: 'destructive' });
    } finally { setSavingName(false); }
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  /** Starting from an event fills in everything the post already knows. */
  function startFromEvent(ev: Loggable) {
    setPrefill(ev);
    setForm({
      orgName: ev.hostName,
      approverName: ev.hostContact ?? '',
      approverEmail: ev.hostEmail ?? '',
      activity: ev.title, serviceDate: ev.date.slice(0, 10), hours: String(ev.duration || ''),
    });
    setOpenForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await call('/api/hours', {
        method: 'POST',
        body: JSON.stringify({
          ...form, hours: Number(form.hours),
          opportunityId: prefill?.id ?? null,
        }),
      });
      toast({
        title: 'Sent for confirmation',
        description: `We emailed ${form.approverEmail}. You'll hear when they answer.`,
      });
      setForm({ orgName: '', approverName: '', approverEmail: '', activity: '', serviceDate: '', hours: '' });
      setPrefill(null); setOpenForm(false);
      await load();
    } catch (err: any) {
      toast({ title: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  async function withdraw(id: string) {
    try { await call(`/api/hours/${id}`, { method: 'DELETE' }); await load(); }
    catch (e: any) { toast({ title: e.message, variant: 'destructive' }); }
  }

  async function saveGoal() {
    try {
      await call('/api/me/goal-hours', { method: 'PUT', body: JSON.stringify({ goalHours: goalDraft || null }) });
      await load();
    } catch (e: any) { toast({ title: e.message, variant: 'destructive' }); }
  }

  if (!isLoggedIn) return null;

  if (!isVolunteer) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 pb-24 text-center">
        <h1 className="font-heading text-2xl font-bold text-foreground">Hours are for volunteer accounts</h1>
        <p className="mt-2 text-muted-foreground">
          Organizations confirm hours from the email we send — there is nothing to set up here.
        </p>
      </div>
    );
  }

  if (!logs || !totals) {
    return <div className="py-20 text-center text-muted-foreground">Loading your hours…</div>;
  }

  const pct = totals.goalHours ? Math.min(100, (totals.confirmed / totals.goalHours) * 100) : 0;

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 pb-24 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-bold text-foreground">My hours</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every entry is confirmed by the organization before it counts toward your certificate.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="rounded-md" onClick={() => navigate('/certificate')}>
            <Award className="w-4 h-4 mr-1.5" /> Certificate
          </Button>
          <Button className="rounded-md" onClick={() => { setPrefill(null); setOpenForm(o => !o); }}>
            {openForm ? 'Cancel' : <><Plus className="w-4 h-4 mr-1.5" /> Log hours</>}
          </Button>
        </div>
      </div>

      {/* Your real name. Not vanity: the organization confirming your hours sees
          this on their list, and a coordinator cannot match a username to
          anyone who actually turned up. It is also what goes on the
          certificate, so it is asked for once and then fixed. */}
      {fullName === null && (
        <div className="rounded-2xl border border-primary/30 bg-primary/5 p-5">
          <label htmlFor="full-name" className="block font-heading font-semibold text-foreground">
            What is your name?
          </label>
          <p className="mt-1 mb-3 text-sm text-muted-foreground">
            Organizations see this when they confirm your hours, and it is the name printed on your
            certificate. Your full name, as your school knows you — not your username. You can only
            set this once.
          </p>
          <div className="flex flex-wrap gap-2">
            <Input
              id="full-name"
              value={nameDraft}
              onChange={e => setNameDraft(e.target.value)}
              placeholder="Ava Lin"
              maxLength={80}
              className="rounded-md flex-1 min-w-[200px]"
            />
            <Button className="rounded-md" onClick={saveName} disabled={savingName || nameDraft.trim().length < 2}>
              {savingName ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      )}

      {/* Progress. Hidden until a target is set — a bar with no target is decoration. */}
      <div className="rounded-2xl bg-card border border-border p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <span className="font-heading text-3xl font-bold text-foreground tabular-nums">{totals.confirmed}</span>
            <span className="ml-2 text-sm text-muted-foreground">hours confirmed</span>
            {totals.waiting > 0 && (
              <span className="ml-3 text-sm text-amber-700 dark:text-amber-400">{totals.waiting} waiting</span>
            )}
            {/* A clock still running is in neither total, so without this it
                disappears from the summary while very much existing. */}
            {totals.running > 0 && (
              <span className="ml-3 text-sm font-medium text-primary">
                {totals.running} clocked in
              </span>
            )}
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            My target
            <Input id="goal-hours" value={goalDraft} onChange={e => setGoalDraft(e.target.value)} onBlur={saveGoal}
              inputMode="numeric" placeholder="40" className="w-20 h-9 text-center rounded-md"
              aria-label="Hours target" />
          </label>
        </div>

        {totals.goalHours ? (
          <>
            <div className="mt-4 h-2 rounded-full bg-secondary overflow-hidden">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {totals.confirmed} of {totals.goalHours} hours
              {totals.confirmed >= totals.goalHours
                ? ' — target reached.'
                : ` — ${Math.round((totals.goalHours - totals.confirmed) * 10) / 10} to go.`}
            </p>
          </>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            Set a target above to track your progress toward it.
          </p>
        )}

        {totals.fromConfirmedOrgs < totals.confirmed && (
          <p className="mt-3 text-xs text-muted-foreground">
            {totals.fromConfirmedOrgs} of those were confirmed by the organization itself, or from an organization's own email address — which is the kind schools ask for. The rest were confirmed from a personal address, and your certificate says so.
          </p>
        )}
      </div>

      {/* The one-tap path: events you signed up for that have already happened. */}
      {loggable.length > 0 && !openForm && (
        <div className="rounded-2xl bg-card border border-border p-5">
          <h2 className="font-heading font-semibold text-foreground">Events you went to</h2>
          <p className="mt-1 mb-3 text-sm text-muted-foreground">
            You signed up for these and they have passed. One tap fills in the details.
          </p>
          <div className="space-y-2">
            {loggable.map(ev => (
              <button key={ev.id} onClick={() => startFromEvent(ev)}
                className="w-full flex items-center justify-between gap-3 rounded-md border border-border bg-background px-4 py-3 text-left cursor-pointer hover:border-primary/50 transition-colors">
                <span className="min-w-0">
                  <span className="block font-semibold text-foreground truncate">{ev.title}</span>
                  <span className="block text-xs text-muted-foreground">
                    {ev.hostName} · {fmt(ev.date)} · {ev.duration}h
                  </span>
                </span>
                <span className="flex items-center gap-1 text-sm font-semibold text-primary flex-shrink-0">
                  Log it <ChevronRight className="w-4 h-4" />
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {openForm && (
        <form onSubmit={submit} className="rounded-2xl bg-card border border-border p-5 space-y-4">
          <div>
            <h2 className="font-heading font-semibold text-foreground">
              {prefill ? `Log hours for "${prefill.title}"` : 'Log hours'}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              We email the person you name and ask them to confirm it. Once you send this you cannot
              edit it — that is what makes your certificate worth something.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="org-name" className="block text-sm font-semibold text-foreground mb-1.5">Who did you volunteer with?</label>
              <Input id="org-name" value={form.orgName} onChange={set('orgName')} required
                disabled={!!prefill} placeholder="Arm in Arm" className="rounded-md" />
              {prefill && <p className="mt-1 text-xs text-muted-foreground">Taken from the post, so it matches what was advertised.</p>}
            </div>
            <div>
              <label htmlFor="service-date" className="block text-sm font-semibold text-foreground mb-1.5">Date you volunteered</label>
              <Input id="service-date" type="date" value={form.serviceDate} onChange={set('serviceDate')} required
                disabled={!!prefill} max={new Date().toISOString().slice(0, 10)} className="rounded-md" />
            </div>
            <div>
              <label htmlFor="hours-count" className="block text-sm font-semibold text-foreground mb-1.5">How many hours?</label>
              <Input id="hours-count" value={form.hours} onChange={set('hours')} required inputMode="decimal"
                placeholder="3.5" className="rounded-md" />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="activity" className="block text-sm font-semibold text-foreground mb-1.5">What did you do?</label>
              <Input id="activity" value={form.activity} onChange={set('activity')} required maxLength={300}
                placeholder="Sorted and packed food boxes" className="rounded-md" />
              <p className="mt-1 text-xs text-muted-foreground">One line. This appears on your certificate.</p>
            </div>
            <div>
              <label htmlFor="approver-name" className="block text-sm font-semibold text-foreground mb-1.5">Who can confirm this?</label>
              <Input id="approver-name" value={form.approverName} onChange={set('approverName')} placeholder="Dana Reed" className="rounded-md" />
            </div>
            <div>
              <label htmlFor="approver-email" className="block text-sm font-semibold text-foreground mb-1.5">Their email</label>
              <Input id="approver-email" type="email" value={form.approverEmail} onChange={set('approverEmail')} required
                placeholder="supervisor@organization.org" className="rounded-md" />
              <p className="mt-1 text-xs text-muted-foreground">Not your own — someone else has to confirm it.</p>
            </div>
          </div>

          <Button type="submit" disabled={saving} className="rounded-md">
            {saving ? 'Sending…' : 'Send for confirmation'}
          </Button>
        </form>
      )}

      {logs.length === 0 ? (
        <div className="rounded-2xl bg-card border border-border py-14 text-center">
          <Clock className="w-9 h-9 mx-auto mb-3 text-muted-foreground/40" />
          <h2 className="font-heading font-semibold text-foreground">Nothing logged yet</h2>
          <p className="mx-auto mt-1.5 max-w-sm text-sm text-muted-foreground">
            Log your first hours and we will ask the organization to confirm them. One confirmed
            entry is enough to print a certificate.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {logs.map(l => (
            <div key={l.id} className="rounded-2xl bg-card border border-border p-4 flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-heading font-semibold text-foreground">{l.orgName}</span>
                  <StatusPill status={l.status} />
                  {l.opportunityId && (
                    <span className="text-xs text-muted-foreground">from a LocalLink event</span>
                  )}
                </div>
                <p className="mt-1 text-sm text-foreground">{l.activity}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {fmt(l.serviceDate)}
                  {l.status === 'running'
                    ? ' · still running'
                    : l.approverName
                      ? ` · ${l.status === 'pending' ? 'waiting on' : 'confirmed by'} ${l.approverName}`
                      : ''}
                </p>
                {l.approverNote && (
                  <p className="mt-1.5 rounded bg-secondary px-2.5 py-1.5 text-xs text-foreground">“{l.approverNote}”</p>
                )}
                {(l.status === 'approved' || l.status === 'adjusted') && (
                  <div className="mt-1.5"><TrustMark kind={l.approverKind} email={l.approverEmail} /></div>
                )}
              </div>
              <div className="text-right flex-shrink-0">
                <div className="font-heading text-xl font-bold text-foreground tabular-nums">
                  {l.status === 'running' ? runningFor(l.startedAt, now) : `${hoursOf(l)}h`}
                </div>
                {l.status === 'running' && (
                  <div className="mt-1 max-w-[9rem] text-xs text-muted-foreground">
                    Scan the organizer's phone to finish
                  </div>
                )}
                {l.status === 'adjusted' && (
                  <div className="text-xs text-muted-foreground line-through tabular-nums">{l.hours}h claimed</div>
                )}
                {l.status === 'pending' && (
                  <button onClick={() => withdraw(l.id)}
                    className="mt-1 text-xs text-muted-foreground underline hover:text-foreground cursor-pointer">
                    Withdraw
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

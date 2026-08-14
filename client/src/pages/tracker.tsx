import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useAuthStore, useOpportunitiesStore } from '@/lib/store';
import {
  ClipboardList, ChevronDown, Loader2, Download, QrCode,
  Check, X as XIcon, Building2,
} from 'lucide-react';

interface AttendanceRow {
  id: string;
  userId: string;
  username: string;
  email: string;
  occurrenceDate: string;
  checkInAt: string;
  checkOutAt: string | null;
  hoursClaimed: number | null;
  hoursVerified: number | null;
  status: 'checked_in' | 'pending' | 'verified' | 'rejected';
  note: string | null;
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('locallink_token');
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function fmtHours(n: number | null): string {
  if (n === null || n === undefined) return '—';
  return (Math.round(n * 100) / 100).toString();
}

/** Org-side v1 of the Tracker: each hosted event expands into a roster of
 * check-ins, approved/edited/rejected here. The volunteer-facing hours view
 * (own totals, breakdown by org, certificate) is a later phase — this page
 * is the org's half only, per the current scope. */
export default function Tracker() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { isLoggedIn, currentUser } = useAuthStore();
  const { myPosts, fetchMyPosts, loading: postsLoading } = useOpportunitiesStore();

  const [openEventId, setOpenEventId] = useState<string | null>(null);
  const [rosterByEvent, setRosterByEvent] = useState<Record<string, AttendanceRow[]>>({});
  const [rosterLoading, setRosterLoading] = useState<string | null>(null);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [exportingId, setExportingId] = useState<string | null>(null);

  useEffect(() => {
    fetchMyPosts();
  }, [fetchMyPosts]);

  if (!isLoggedIn || !currentUser) {
    return (
      <div className="min-h-screen bg-background pb-24 font-sans">
        <main className="container mx-auto px-4 py-16 text-center">
          <ClipboardList className="w-16 h-16 text-muted-foreground mx-auto opacity-50 mb-4" />
          <h2 className="text-2xl font-heading font-bold text-foreground mb-2">Please Login</h2>
          <p className="text-muted-foreground mb-6">You need to be logged in to view the Tracker.</p>
          <Button onClick={() => navigate('/account')} className="rounded-full px-8">Login / Sign Up</Button>
        </main>
      </div>
    );
  }

  const isOrg = currentUser.accountType === 'organization' || currentUser.isAdmin;
  if (!isOrg) {
    return (
      <div className="min-h-screen bg-background pb-24 font-sans">
        <main className="container mx-auto px-4 py-16 text-center max-w-md">
          <ClipboardList className="w-16 h-16 text-muted-foreground mx-auto opacity-50 mb-4" />
          <h2 className="text-2xl font-heading font-bold text-foreground mb-2">Tracker is for organizations</h2>
          <p className="text-muted-foreground mb-6">
            It's where an organization reviews check-ins and verifies volunteer hours. Switch to an
            organization account from your profile to post opportunities and use it yourself.
          </p>
          <Button onClick={() => navigate('/profile')} variant="outline" className="rounded-full px-8">
            Go to Profile
          </Button>
        </main>
      </div>
    );
  }

  const hostedEvents = myPosts.filter(o => o.hostId === currentUser.id);

  const loadRoster = async (eventId: string) => {
    if (rosterByEvent[eventId]) return; // already fetched for this event
    setRosterLoading(eventId);
    try {
      const res = await fetch(`/api/opportunities/${eventId}/attendance`, { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json();
        setRosterByEvent(prev => ({ ...prev, [eventId]: data }));
      } else {
        toast({ title: 'Could not load roster', variant: 'destructive' });
      }
    } finally {
      setRosterLoading(null);
    }
  };

  const toggleEvent = (eventId: string) => {
    if (openEventId === eventId) { setOpenEventId(null); return; }
    setOpenEventId(eventId);
    loadRoster(eventId);
  };

  const decide = async (row: AttendanceRow, eventId: string, status: 'verified' | 'rejected') => {
    setDecidingId(row.id);
    try {
      const res = await fetch(`/api/attendance/${row.id}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        const updated = await res.json();
        setRosterByEvent(prev => ({
          ...prev,
          [eventId]: prev[eventId].map(r => r.id === row.id
            ? { ...r, status: updated.status, hoursVerified: updated.hoursVerified }
            : r),
        }));
        toast({ title: status === 'verified' ? 'Hours approved' : 'Submission rejected' });
      } else {
        const data = await res.json().catch(() => ({}));
        toast({ title: data.error || 'Could not update', variant: 'destructive' });
      }
    } finally {
      setDecidingId(null);
    }
  };

  const exportCsv = async (eventId: string, title: string) => {
    setExportingId(eventId);
    try {
      const token = localStorage.getItem('locallink_token');
      const res = await fetch(`/api/opportunities/${eventId}/attendance/export`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) { toast({ title: 'Export failed', variant: 'destructive' }); return; }
      // The endpoint sets Content-Disposition, but a plain <a href> GET can't
      // carry the Authorization header the route requires — fetch the blob
      // ourselves and trigger the save via a throwaway object URL instead.
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${title.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}_attendance.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setExportingId(null);
    }
  };

  return (
    <div className="min-h-screen bg-background pb-24 font-sans">
      <main className="container mx-auto px-4 py-8 max-w-3xl">
        <div className="mb-8">
          <h1 className="text-2xl font-heading font-bold text-foreground flex items-center gap-2">
            <ClipboardList className="w-6 h-6 text-primary" />
            Tracker
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Review who checked in, verify their hours, and export a roster for your records.
          </p>
        </div>

        {postsLoading && hostedEvents.length === 0 && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        )}

        {!postsLoading && hostedEvents.length === 0 && (
          <div className="rounded-2xl border-2 border-dashed border-border p-8 text-center space-y-2">
            <Building2 className="w-10 h-10 text-muted-foreground mx-auto opacity-40" />
            <p className="text-muted-foreground font-medium">No events yet</p>
            <p className="text-sm text-muted-foreground">Post an opportunity and its roster will show up here.</p>
          </div>
        )}

        <div className="space-y-3">
          {hostedEvents.map(ev => {
            const open = openEventId === ev.id;
            const roster = rosterByEvent[ev.id] || [];
            const pending = roster.filter(r => r.status === 'pending').length;
            const verified = roster.filter(r => r.status === 'verified').length;
            const checkInUrl = `${window.location.origin}/checkin/${ev.id}`;

            return (
              <div key={ev.id} className="rounded-2xl border border-border overflow-hidden">
                <button
                  onClick={() => toggleEvent(ev.id)}
                  className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left hover:bg-secondary/40 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground truncate">{ev.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {new Date(ev.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {pending > 0 && (
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400">
                        {pending} pending
                      </span>
                    )}
                    {verified > 0 && (
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                        {verified} verified
                      </span>
                    )}
                    <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
                  </div>
                </button>

                {open && (
                  <div className="border-t border-border px-5 py-4 space-y-4">
                    {rosterLoading === ev.id ? (
                      <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
                    ) : roster.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">
                        No check-ins yet. Share the check-in link below at the event.
                      </p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm min-w-[540px]">
                          <thead>
                            <tr className="text-[11px] uppercase tracking-wide text-muted-foreground">
                              <th className="text-left font-semibold pb-2 pr-4">Volunteer</th>
                              <th className="text-left font-semibold pb-2 pr-4">In</th>
                              <th className="text-left font-semibold pb-2 pr-4">Out</th>
                              <th className="text-right font-semibold pb-2 pr-4">Claimed</th>
                              <th className="text-right font-semibold pb-2 pr-4">Verified</th>
                              <th className="text-left font-semibold pb-2 pr-4">Status</th>
                              <th className="pb-2"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {roster.map(r => (
                              <tr key={r.id} className="border-t border-border/60">
                                <td className="py-2.5 pr-4 font-medium text-foreground">{r.username}</td>
                                <td className="py-2.5 pr-4 text-muted-foreground">{fmtTime(r.checkInAt)}</td>
                                <td className="py-2.5 pr-4 text-muted-foreground">{fmtTime(r.checkOutAt)}</td>
                                <td className="py-2.5 pr-4 text-right tabular-nums">{fmtHours(r.hoursClaimed)}</td>
                                <td className="py-2.5 pr-4 text-right tabular-nums">{fmtHours(r.hoursVerified)}</td>
                                <td className="py-2.5 pr-4">
                                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                                    r.status === 'verified' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                                    : r.status === 'rejected' ? 'bg-red-500/15 text-red-500'
                                    : r.status === 'pending' ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                                    : 'bg-secondary text-muted-foreground'
                                  }`}>
                                    {r.status === 'checked_in' ? 'in progress' : r.status}
                                  </span>
                                </td>
                                <td className="py-2.5">
                                  {r.status === 'pending' ? (
                                    <div className="flex gap-1.5 justify-end">
                                      <button
                                        onClick={() => decide(r, ev.id, 'verified')}
                                        disabled={decidingId === r.id}
                                        aria-label={`Approve ${r.username}'s hours`}
                                        className="w-7 h-7 flex items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/25 transition-colors disabled:opacity-50"
                                      >
                                        {decidingId === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                                      </button>
                                      <button
                                        onClick={() => decide(r, ev.id, 'rejected')}
                                        disabled={decidingId === r.id}
                                        aria-label={`Reject ${r.username}'s hours`}
                                        className="w-7 h-7 flex items-center justify-center rounded-full bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors disabled:opacity-50"
                                      >
                                        <XIcon className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  ) : null}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <Button
                        variant="outline" size="sm"
                        onClick={() => exportCsv(ev.id, ev.title)}
                        disabled={exportingId === ev.id}
                        className="rounded-full text-xs"
                      >
                        {exportingId === ev.id ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Download className="w-3.5 h-3.5 mr-1.5" />}
                        Export CSV
                      </Button>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-secondary/50 rounded-full px-3 py-1.5">
                        <QrCode className="w-3.5 h-3.5" />
                        <code className="truncate max-w-[220px]">{checkInUrl}</code>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}

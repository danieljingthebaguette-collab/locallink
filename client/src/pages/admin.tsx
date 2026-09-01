import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { cn, getExternalSignupUrlError } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useAuthStore, useAdminStore, useOpportunitiesStore, type JoinLink } from '@/lib/store';
import { VerifiedBadge } from '@/components/VerifiedBadge';
import { Ban, CheckCircle2, TrendingUp, Scale, ClipboardCheck, XCircle, Mail, Bell } from 'lucide-react';
import type { AppUser, Opportunity } from '@/lib/mockData';
import { AVAILABILITY_OPTIONS, CATEGORIES, TOWNS, type Category } from '@/lib/mockData';
import { getEditCategoryOptions, getCategoryTint, getCategoryLabel } from '@/lib/categoryUtils';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Shield,
  Users,
  MapPin,
  Trash2,
  Star,
  BarChart3,
  Search,
  Edit3,
  Save,
  X,
  ChevronUp,
  ChevronDown,
  Loader2,
  Flag,
  MessageSquare,
  Link2,
  Copy,
  BadgeCheck,
  Calendar,
  Sparkles,
} from 'lucide-react';

type Tab = 'overview' | 'users' | 'opportunities' | 'verify' | 'reports' | 'feedback' | 'appeals' | 'join-links';

export default function Admin() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { isLoggedIn, currentUser } = useAuthStore();
  const { users, stats, loading, fetchUsers, fetchStats, deleteUser, deleteOpportunity, updateOpportunity, banUser, unbanUser, pendingOpportunities, fetchPendingOpportunities, approveOpportunity, denyOpportunity, toggleFeatured, verifyUser, joinLinks, fetchJoinLinks, createJoinLink, deleteJoinLink } = useAdminStore();
  const { opportunities, fetchOpportunities } = useOpportunitiesStore();
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  // Badge count lives here so the tab shows a pending total without the tab
  // itself having to be open.

  // Redirect non-admin users
  useEffect(() => {
    if (!isLoggedIn || !currentUser) {
      navigate('/account');
    } else if (!currentUser.isAdmin) {
      navigate('/');
    }
  }, [isLoggedIn, currentUser, navigate]);

  // Load admin data
  useEffect(() => {
    if (currentUser?.isAdmin) {
      fetchUsers(currentUser.id);
      fetchStats(currentUser.id);
      fetchOpportunities();
      fetchPendingOpportunities();
      fetchJoinLinks();
    }
  }, [currentUser]);

  if (!currentUser?.isAdmin) return null;

  const tabs: { value: Tab; label: string; icon: React.ReactNode; badge?: number }[] = [
    { value: 'overview', label: 'Overview', icon: <BarChart3 className="w-4 h-4" /> },
    { value: 'users', label: 'Users', icon: <Users className="w-4 h-4" /> },
    { value: 'opportunities', label: 'Opportunities', icon: <MapPin className="w-4 h-4" /> },
    { value: 'verify', label: 'Verify', icon: <ClipboardCheck className="w-4 h-4" />, badge: pendingOpportunities.length },
    { value: 'reports', label: 'Reports', icon: <Flag className="w-4 h-4" /> },
    { value: 'feedback', label: 'Feedback', icon: <MessageSquare className="w-4 h-4" /> },
    { value: 'appeals', label: 'Appeals', icon: <Scale className="w-4 h-4" /> },
    { value: 'join-links', label: 'Join Links', icon: <Link2 className="w-4 h-4" /> },
  ];

  return (
    <div className="min-h-screen bg-background pb-24 font-sans">
      <main className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <div className="w-12 h-12 rounded-2xl bg-red-500/10 flex items-center justify-center">
            <Shield className="w-6 h-6 text-red-500" />
          </div>
          <div>
            <h1 className="text-2xl font-heading font-bold text-foreground">Admin Panel</h1>
            <p className="text-sm text-muted-foreground">Manage users, opportunities, and platform data</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-8 overflow-x-auto pb-2">
          {tabs.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setActiveTab(tab.value)}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium transition-all whitespace-nowrap',
                activeTab === tab.value
                  ? 'bg-foreground text-background shadow-md'
                  : 'bg-card border border-border text-muted-foreground hover:bg-accent'
              )}
            >
              {tab.icon}
              {tab.label}
              {tab.badge !== undefined && tab.badge > 0 && (
                <span className="ml-1 min-w-[18px] h-[18px] px-1 rounded-md bg-orange-500 text-white text-[10px] font-bold flex items-center justify-center">
                  {tab.badge}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === 'overview' && (
          <OverviewTab stats={stats} users={users} opportunities={opportunities} />
        )}
        {activeTab === 'users' && (
          <UsersTab
            users={users}
            adminUserId={currentUser.id}
            loading={loading}
            onDeleteUser={async (userId) => {
              const ok = await deleteUser(currentUser.id, userId);
              if (ok) {
                toast({ title: 'User deleted' });
                fetchStats(currentUser.id);
                useOpportunitiesStore.setState({ loaded: false });
                fetchOpportunities();
              } else {
                toast({ title: 'Failed to delete user', variant: 'destructive' });
              }
            }}
            onBanUser={async (userId) => {
              const ok = await banUser(userId);
              if (ok) toast({ title: 'User suspended' });
              else toast({ title: 'Failed to suspend user', variant: 'destructive' });
            }}
            onUnbanUser={async (userId) => {
              const ok = await unbanUser(userId);
              if (ok) toast({ title: 'User reinstated' });
              else toast({ title: 'Failed to reinstate user', variant: 'destructive' });
            }}
            onVerifyUser={async (userId) => {
              const ok = await verifyUser(userId);
              if (ok) toast({ title: 'Verification badge updated' });
              else toast({ title: 'Failed to update badge', variant: 'destructive' });
            }}
          />
        )}
        {activeTab === 'opportunities' && (
          <OpportunitiesTab
            opportunities={opportunities}
            adminUserId={currentUser.id}
            onDeleteOpportunity={async (oppId, reason) => {
              const ok = await deleteOpportunity(currentUser.id, oppId, reason);
              if (ok) {
                toast({ title: 'Opportunity deleted' });
                useOpportunitiesStore.setState({ loaded: false });
                fetchOpportunities();
                fetchStats(currentUser.id);
              } else {
                toast({ title: 'Failed to delete opportunity', variant: 'destructive' });
              }
            }}
            onUpdateOpportunity={async (oppId, data, reason) => {
              const ok = await updateOpportunity(currentUser.id, oppId, data, reason);
              if (ok) {
                toast({ title: 'Opportunity updated!' });
                useOpportunitiesStore.setState({ loaded: false });
                fetchOpportunities();
              } else {
                toast({ title: 'Failed to update opportunity', variant: 'destructive' });
              }
              return ok;
            }}
            onToggleFeatured={async (oppId) => {
              const ok = await toggleFeatured(oppId);
              if (ok) {
                toast({ title: 'Featured status updated!' });
                useOpportunitiesStore.setState({ loaded: false });
                fetchOpportunities();
              } else {
                toast({ title: 'Failed to update featured status', variant: 'destructive' });
              }
            }}
          />
        )}
        {activeTab === 'verify' && (
          <VerifyTab
            pendingOpportunities={pendingOpportunities}
            onApprove={async (oppId) => {
              const ok = await approveOpportunity(oppId);
              if (ok) {
                toast({ title: 'Post approved!', description: 'The organization has been notified.' });
                useOpportunitiesStore.setState({ loaded: false });
                fetchOpportunities();
                fetchStats(currentUser.id);
              } else {
                toast({ title: 'Failed to approve post', variant: 'destructive' });
              }
            }}
            onDeny={async (oppId, reason) => {
              const ok = await denyOpportunity(oppId, reason);
              if (ok) {
                toast({ title: 'Post denied', description: 'The organization has been notified.' });
              } else {
                toast({ title: 'Failed to deny post', variant: 'destructive' });
              }
            }}
          />
        )}
        {activeTab === 'reports' && <ReportsTab toast={toast} />}
        {activeTab === 'feedback' && <FeedbackTab toast={toast} />}
        {activeTab === 'appeals' && <AppealsTab toast={toast} onUnbanUser={unbanUser} />}
        {activeTab === 'join-links' && (
          <JoinLinksTab
            links={joinLinks}
            onCreate={async (orgName, category) => {
              const result = await createJoinLink(orgName, category);
              if (result.link) toast({ title: `Link created: /join/${result.link.slug}` });
              else toast({ title: result.error || 'Failed to create link', variant: 'destructive' });
            }}
            onDelete={async (slug) => {
              const ok = await deleteJoinLink(slug);
              if (ok) toast({ title: 'Link deleted' });
              else toast({ title: 'Failed to delete link', variant: 'destructive' });
            }}
            toast={toast}
          />
        )}
      </main>
    </div>
  );
}

// ===== Overview Tab =====
const RANGE_OPTIONS = [
  { label: '1W',  days: 7,   title: '7-Day Activity' },
  { label: '2W',  days: 14,  title: '14-Day Activity' },
  { label: '1M',  days: 30,  title: '30-Day Activity' },
  { label: '1Y',  days: 365, title: '12-Month Activity' },
] as const;

/** For the 1-year view collapse 365 daily rows into 12 monthly buckets */
function bucketByMonth(data: { date: string; signups: number; users: number }[]) {
  const map = new Map<string, { date: string; signups: number; users: number }>();
  for (const d of data) {
    const key = d.date.slice(0, 7); // "YYYY-MM"
    if (!map.has(key)) map.set(key, { date: key, signups: 0, users: 0 });
    const b = map.get(key)!;
    b.signups += d.signups;
    b.users   += d.users;
  }
  return Array.from(map.values());
}

/**
 * One-off nudge for volunteers who signed up before the questionnaire existed.
 * Shows the count first and asks before sending, because the email half cannot
 * be taken back. Safe to press twice: the server stamps everyone it processes,
 * so a second press finds nobody.
 */
function OnboardingNudgeCard() {
  const { toast } = useToast();
  const [counts, setCounts] = useState<{
    pending: number; emailable: number; alreadyNudged: number; alreadyEmailed: number;
    skipped?: { unverifiedEmail: number; unsubscribed: number; placeholderAddress: number };
  } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // Failures are shown, not swallowed. This used to be
  // `r.ok ? r.json() : null` followed by `if (!counts) return null`, so any
  // error at all -- an expired token, a 500 -- deleted the whole card from the
  // page with nothing to see. That is precisely how the missing analytics
  // route stayed hidden, and it hid this one too.
  const load = () => {
    const token = localStorage.getItem('locallink_token');
    setLoadError(null);
    fetch('/api/admin/onboarding-nudge', { headers: { Authorization: `Bearer ${token}` } })
      .then(async r => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.error || `the server returned ${r.status}`);
        }
        return r.json();
      })
      .then(setCounts)
      .catch((e: Error) => setLoadError(e.message));
  };
  useEffect(load, []);

  const send = async () => {
    setSending(true);
    try {
      const token = localStorage.getItem('locallink_token');
      const res = await fetch('/api/admin/onboarding-nudge', {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(String(res.status));
      const r = await res.json();
      toast({
        title: `Notified ${r.notified} volunteer${r.notified === 1 ? '' : 's'}`,
        description: `${r.emailed} email${r.emailed === 1 ? '' : 's'} sent${r.emailFailed ? `, ${r.emailFailed} failed` : ''}.`,
      });
      setConfirming(false);
      load();
    } catch {
      toast({ title: "Couldn't send the nudge", variant: 'destructive' });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="rounded-2xl bg-card border border-border p-6 space-y-3">
      <div>
        <h3 className="font-heading font-semibold text-foreground">Questionnaire nudge</h3>
        {loadError && (
          <p className="text-sm text-red-600 mt-1">
            Couldn't load the count — {loadError}.{' '}
            <button onClick={load} className="underline font-medium">Try again</button>
          </p>
        )}
        {!counts && !loadError && (
          <p className="text-sm text-muted-foreground mt-1">Checking who still needs asking…</p>
        )}
      </div>
      {counts && (<>
      <div>
        <p className="text-sm text-muted-foreground mt-1">
          {counts.pending === 0
            ? `Everyone has been asked — ${counts.alreadyNudged} volunteer${counts.alreadyNudged === 1 ? '' : 's'} nudged, ${counts.alreadyEmailed} of them by email. Nothing will be sent.`
            : `${counts.pending} volunteer${counts.pending === 1 ? " hasn't" : "s haven't"} filled in the questionnaire yet, and ${counts.pending === 1 ? 'has' : 'have'}n't been asked. ${counts.emailable} can be emailed; any others get the in-site notification only.`}
        </p>
        {/* Why anyone was reached by notification only. The gap between
            "nudged" and "emailed" is otherwise unexplainable from here. */}
        {counts.skipped && (counts.skipped.unverifiedEmail + counts.skipped.unsubscribed + counts.skipped.placeholderAddress) > 0 && (
          <p className="text-xs text-muted-foreground mt-2">
            Notification only, no email:{' '}
            {[
              counts.skipped.unverifiedEmail && `${counts.skipped.unverifiedEmail} never confirmed their email address`,
              counts.skipped.unsubscribed && `${counts.skipped.unsubscribed} unsubscribed`,
              counts.skipped.placeholderAddress && `${counts.skipped.placeholderAddress} on a placeholder address`,
            ].filter(Boolean).join(' · ')}.
          </p>
        )}
        {counts.pending > 0 && counts.alreadyNudged > 0 && (
          <p className="text-xs text-muted-foreground mt-1">
            {counts.alreadyNudged} {counts.alreadyNudged === 1 ? 'volunteer has' : 'volunteers have'} already been
            nudged previously ({counts.alreadyEmailed} by email) and will not be contacted again.
          </p>
        )}
      </div>
      {counts.pending > 0 && (
        confirming ? (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-foreground font-medium">
              Send to {counts.pending}? {counts.emailable} will get a real email.
            </span>
            <Button size="sm" onClick={send} disabled={sending} className="rounded-md">
              {sending ? 'Sending…' : 'Yes, send'}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setConfirming(false)} disabled={sending} className="rounded-md">
              Cancel
            </Button>
          </div>
        ) : (
          <Button size="sm" onClick={() => setConfirming(true)} className="rounded-md">
            Send the nudge
          </Button>
        )
      )}
      </>)}
    </div>
  );
}

function OverviewTab({ stats, users, opportunities }: { stats: any; users: AppUser[]; opportunities: Opportunity[] }) {
  const [rangeDays, setRangeDays] = useState<7 | 14 | 30 | 365>(14);
  const [analytics, setAnalytics] = useState<{ date: string; signups: number; users: number }[]>([]);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('locallink_token');
    setAnalyticsLoading(true);
    setAnalyticsError(false);
    fetch(`/api/admin/analytics?days=${rangeDays}`, { headers: { Authorization: `Bearer ${token}` } })
      // A failure here used to fall back to [], which the chart draws as "No
      // data for this period" — indistinguishable from a real quiet stretch.
      // That is how a missing route went unnoticed on the live site, so say
      // which of the two it actually is.
      .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((raw: { date: string; signups: number; users: number }[]) => {
        setAnalytics(rangeDays === 365 ? bucketByMonth(raw) : raw);
      })
      .catch(() => { setAnalytics([]); setAnalyticsError(true); })
      .finally(() => setAnalyticsLoading(false));
  }, [rangeDays]);

  const chartData = analytics;
  const maxSignups = Math.max(...chartData.map(d => d.signups), 1);
  const maxUsers   = Math.max(...chartData.map(d => d.users),   1);
  const [hoveredDay, setHoveredDay] = useState<{ date: string; signups: number; users: number } | null>(null);
  const totalSignups = chartData.reduce((s, d) => s + d.signups, 0);
  const totalUsers   = chartData.reduce((s, d) => s + d.users,   0);
  const activeRange  = RANGE_OPTIONS.find(r => r.days === rangeDays)!;

  const statCards = [
    { label: 'Total Users', value: stats?.totalUsers ?? 0, icon: <Users className="w-5 h-5" />, color: 'text-blue-500 bg-blue-500/10' },
    { label: 'Opportunities', value: stats?.totalOpps ?? 0, icon: <MapPin className="w-5 h-5" />, color: 'text-green-500 bg-green-500/10' },
    { label: 'Total Signups', value: stats?.totalSignups ?? 0, icon: <Star className="w-5 h-5" />, color: 'text-purple-500 bg-purple-500/10' },
  ];

  return (
    <div className="space-y-6">
      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {statCards.map((stat) => (
          <div key={stat.label} className="rounded-2xl bg-card border border-border p-5 space-y-3">
            <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center', stat.color)}>
              {stat.icon}
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{stat.value}</p>
              <p className="text-xs text-muted-foreground font-medium">{stat.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Analytics Chart */}
      <div className="rounded-2xl bg-card border border-border p-6">
        <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-primary" />
            <h3 className="font-heading font-semibold text-foreground">{activeRange.title}</h3>
          </div>
          {/* Range selector */}
          <div className="flex items-center gap-1">
            {RANGE_OPTIONS.map(r => (
              <button
                key={r.days}
                onClick={() => { setRangeDays(r.days as any); setHoveredDay(null); }}
                className={cn(
                  'px-2.5 py-1 rounded-md text-xs font-semibold transition-all border',
                  rangeDays === r.days
                    ? 'bg-foreground text-background border-foreground'
                    : 'bg-background text-muted-foreground border-border hover:border-foreground/50 hover:text-foreground'
                )}>
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {analyticsLoading ? (
          <div className="h-28">
            <svg viewBox="0 0 100 88" preserveAspectRatio="none" className="w-full block" style={{ height: '88px' }}>
              <polyline
                vectorEffect="non-scaling-stroke"
                points="0,60 10,50 20,55 30,35 40,40 50,25 60,30 70,20 80,28 90,18 100,22"
                fill="none"
                stroke="currentColor"
                strokeOpacity="0.15"
                strokeWidth="1.5"
                strokeLinejoin="round"
                strokeLinecap="round"
                className="animate-pulse text-violet-500"
              />
              <polyline
                vectorEffect="non-scaling-stroke"
                points="0,70 10,65 20,68 30,55 40,58 50,48 60,52 70,42 80,46 90,38 100,40"
                fill="none"
                stroke="currentColor"
                strokeOpacity="0.15"
                strokeWidth="1.5"
                strokeLinejoin="round"
                strokeLinecap="round"
                className="animate-pulse text-sky-400"
              />
            </svg>
          </div>
        ) : chartData.length > 0 ? (
          <div className="h-28">
            <svg
              viewBox="0 0 100 88"
              preserveAspectRatio="none"
              className="w-full block"
              style={{ height: '88px' }}
            >
              {/* Signups line */}
              {chartData.length > 1 && (
                <polyline
                  vectorEffect="non-scaling-stroke"
                  points={chartData.map((d, i) => {
                    const x = (i / (chartData.length - 1)) * 100;
                    const y = 88 - (maxSignups > 0 ? Math.max((d.signups / maxSignups) * 80, d.signups > 0 ? 4 : 0) : 2);
                    return `${x},${y}`;
                  }).join(' ')}
                  fill="none"
                  stroke="rgb(139,92,246)"
                  strokeOpacity="0.75"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              )}
              {/* Users line */}
              {chartData.length > 1 && (
                <polyline
                  vectorEffect="non-scaling-stroke"
                  points={chartData.map((d, i) => {
                    const x = (i / (chartData.length - 1)) * 100;
                    const y = 88 - (maxUsers > 0 ? Math.max((d.users / maxUsers) * 80, d.users > 0 ? 4 : 0) : 2);
                    return `${x},${y}`;
                  }).join(' ')}
                  fill="none"
                  stroke="rgb(56,189,248)"
                  strokeOpacity="0.75"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              )}
              {/* Per-day dots + invisible hit areas */}
              {chartData.map((d, i) => {
                const x = chartData.length > 1 ? (i / (chartData.length - 1)) * 100 : 50;
                const sy = 88 - (maxSignups > 0 ? Math.max((d.signups / maxSignups) * 80, d.signups > 0 ? 4 : 0) : 2);
                const uy = 88 - (maxUsers > 0 ? Math.max((d.users / maxUsers) * 80, d.users > 0 ? 4 : 0) : 2);
                const isHovered = hoveredDay?.date === d.date;
                const colW = 100 / chartData.length;
                return (
                  <g key={d.date}>
                    <rect
                      x={x - colW / 2} y={0} width={colW} height={88}
                      fill="transparent"
                      onMouseEnter={() => setHoveredDay(d)}
                      onMouseLeave={() => setHoveredDay(null)}
                      style={{ cursor: 'default' }}
                    />
                    <circle
                      vectorEffect="non-scaling-stroke"
                      cx={x} cy={sy} r={isHovered ? 3 : 2.5}
                      fill={isHovered ? 'rgb(139,92,246)' : 'rgba(139,92,246,0.55)'}
                      style={{ pointerEvents: 'none' }}
                    />
                    <circle
                      vectorEffect="non-scaling-stroke"
                      cx={x} cy={uy} r={isHovered ? 3 : 2.5}
                      fill={isHovered ? 'rgb(56,189,248)' : 'rgba(56,189,248,0.55)'}
                      style={{ pointerEvents: 'none' }}
                    />
                  </g>
                );
              })}
            </svg>
            {/* X-axis labels */}
            <div className="flex items-center mt-0.5">
              {chartData.map((d) => (
                <p key={d.date} className="flex-1 text-[7px] text-muted-foreground leading-none text-center truncate">
                  {rangeDays === 365 ? d.date.slice(0, 7).replace('-', '/') : d.date.slice(5).replace('-', '/')}
                </p>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-28 text-sm text-muted-foreground text-center px-4">
            {analyticsError
              ? "Couldn't load activity — the chart data failed to fetch. Try reloading."
              : 'No data for this period'}
          </div>
        )}

        {/* Stats row */}
        <div className="flex items-center justify-between mt-4 pt-3 border-t border-border/30 gap-3 flex-wrap">
          <div className="flex items-center gap-5">
            <div className="flex items-center gap-1.5">
              <div className="w-5 h-[2px] rounded-md bg-violet-500/80 flex-shrink-0" />
              <span className="text-xs text-muted-foreground">
                <span className="font-bold text-foreground text-sm mr-0.5">
                  {hoveredDay ? hoveredDay.signups : totalSignups}
                </span>
                {hoveredDay ? 'signups' : 'total signups'}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-5 h-[2px] rounded-md bg-sky-400/80 flex-shrink-0" />
              <span className="text-xs text-muted-foreground">
                <span className="font-bold text-foreground text-sm mr-0.5">
                  {hoveredDay ? hoveredDay.users : totalUsers}
                </span>
                {hoveredDay ? 'new users' : 'new users'}
              </span>
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground italic">
            {hoveredDay
              ? `${hoveredDay.date}${rangeDays === 365 ? ' (monthly total)' : ''}`
              : `${activeRange.title.toLowerCase()} totals · hover a point for details`}
          </p>
        </div>
      </div>

      {/* Questionnaire nudge — one-off, for volunteers who joined before it existed */}
      <OnboardingNudgeCard />

      {/* Recent Users */}
      <div className="rounded-2xl bg-card border border-border p-6">
        <h3 className="font-heading font-semibold text-foreground mb-4">Recent Users</h3>
        <div className="space-y-3">
          {users.slice(0, 5).map((user) => (
            <div key={user.id} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
              <div>
                <p className="text-sm font-medium text-foreground">{user.username}</p>
                <p className="text-xs text-muted-foreground">{user.email}</p>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                {user.isAdmin && (
                  <span className="bg-red-500/10 text-red-500 px-2 py-0.5 rounded-md font-medium">Admin</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Recent Opportunities */}
      <div className="rounded-2xl bg-card border border-border p-6">
        <h3 className="font-heading font-semibold text-foreground mb-4">Recent Opportunities</h3>
        <div className="space-y-3">
          {opportunities.slice(0, 5).map((opp) => (
            <div key={opp.id} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
              <div>
                <p className="text-sm font-medium text-foreground">{opp.title}</p>
                <p className="text-xs text-muted-foreground">{opp.category} · {opp.location}</p>
              </div>
              <div className="text-xs text-muted-foreground">
                {opp.spotsType === 'unlimited'
                  ? `${opp.signups.length} interested · Unlimited`
                  : opp.spotsType === 'none' || opp.spots === 0
                  ? `${opp.signups.length} interested · No cap`
                  : `${opp.signups.length}/${opp.spots} interested${opp.signups.length >= opp.spots ? ' · Full' : ''}`}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ===== Users Tab =====
function UsersTab({
  users,
  adminUserId,
  loading,
  onDeleteUser,
  onBanUser,
  onUnbanUser,
  onVerifyUser,
}: {
  users: AppUser[];
  adminUserId: string;
  loading: boolean;
  onDeleteUser: (userId: string) => Promise<void>;
  onBanUser: (userId: string) => Promise<void>;
  onUnbanUser: (userId: string) => Promise<void>;
  onVerifyUser: (userId: string) => Promise<void>;
}) {
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [confirmDeleteUser, setConfirmDeleteUser] = useState<AppUser | null>(null);
  const [confirmSuspendUser, setConfirmSuspendUser] = useState<AppUser | null>(null);
  const { toast } = useToast();
  const [nudging, setNudging] = useState<string | null>(null);

  // Bell opens a dialog to compose in: blank sends the questionnaire nudge,
  // which is the usual case, and anything typed is delivered verbatim. Mail
  // sends the questionnaire email straight away -- there is nothing to write.
  //
  // A real dialog rather than window.prompt(), which is not dependable: it
  // throws outright in an embedded frame and Chrome suppresses it in
  // cross-origin ones, so the button would have looked broken with no clue why.
  const [composeFor, setComposeFor] = useState<AppUser | null>(null);
  const [composeText, setComposeText] = useState('');

  const sendNudge = async (user: AppUser, channel: 'email' | 'notification', message = '') => {
    setNudging(`${user.id}:${channel}`);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/nudge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('locallink_token')}` },
        body: JSON.stringify({ channel, message }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed');
      toast({
        title: channel === 'email' ? `Emailed ${user.username}` : `Notified ${user.username}`,
        description: channel === 'email'
          ? 'The questionnaire email is on its way.'
          : (message.trim() ? 'Your message is in their notifications.' : 'The questionnaire nudge is in their notifications.'),
      });
    } catch (e: any) {
      toast({ title: `Couldn't reach ${user.username}`, description: e.message, variant: 'destructive' });
    } finally {
      setNudging(null);
      setComposeFor(null);
      setComposeText('');
    }
  };
  // Collapsed by default, one at a time -- a list of users is scanned, not
  // read top to bottom, so preferences only take up room once actually asked
  // for. Same reasoning as the "What to Expect" fold on a post.
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);

  // Debounce search — avoids filtering on every keystroke
  useEffect(() => {
    const t = setTimeout(() => setSearchQuery(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const filteredUsers = users.filter(u =>
    u.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search users..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="pl-11 h-11 rounded-xl border border-border"
        />
      </div>

      <p className="text-sm text-muted-foreground">{filteredUsers.length} users found</p>

      <AlertDialog open={!!confirmDeleteUser} onOpenChange={(open) => !open && setConfirmDeleteUser(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete User?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{confirmDeleteUser?.username}</strong>? This will remove all their data and signups. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-500 hover:bg-red-600"
              onClick={() => { if (confirmDeleteUser) { onDeleteUser(confirmDeleteUser.id); setConfirmDeleteUser(null); } }}
            >
              Delete User
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!confirmSuspendUser} onOpenChange={(open) => !open && setConfirmSuspendUser(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Suspend User?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to suspend <strong>{confirmSuspendUser?.username}</strong>? They will be unable to log in until reinstated.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-500 hover:bg-amber-600"
              onClick={() => { if (confirmSuspendUser) { onBanUser(confirmSuspendUser.id); setConfirmSuspendUser(null); } }}
            >
              Suspend User
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Compose a notification for one person */}
      <AlertDialog open={!!composeFor} onOpenChange={(open) => { if (!open) { setComposeFor(null); setComposeText(''); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Notify {composeFor?.username}</AlertDialogTitle>
            <AlertDialogDescription>
              This lands in their notification bell on the site. Leave it blank to send the
              standard questionnaire nudge, or write your own message.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            value={composeText}
            onChange={(e) => setComposeText(e.target.value)}
            placeholder="Leave blank for the questionnaire nudge, or type a message…"
            maxLength={300}
            className="min-h-[92px] resize-none"
          />
          <p className="text-xs text-muted-foreground -mt-1">
            {composeText.trim()
              ? `${composeText.trim().length}/300 — sent as written.`
              : 'Will send: “We added a short questionnaire — it takes a minute and lets us mark the opportunities that actually fit you.”'}
          </p>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => composeFor && sendNudge(composeFor, 'notification', composeText)}
              disabled={!!nudging}
            >
              {nudging ? 'Sending…' : 'Send notification'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">Loading users...</div>
      ) : filteredUsers.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p>{searchQuery ? `No users matching "${searchQuery}"` : 'No users yet'}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredUsers.map((user) => (
            <div key={user.id} className={cn('rounded-2xl bg-card border border-border p-4', user.banned && 'opacity-60')}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary flex-shrink-0">
                    {user.username.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-foreground">{user.username}</p>
                      {user.verified && (
                        <VerifiedBadge className="w-4 h-4" />
                      )}
                      {user.isAdmin && (
                        <span className="bg-red-500/10 text-red-500 px-2 py-0.5 rounded-md text-[10px] font-medium">Admin</span>
                      )}
                      {user.accountType === 'organization' && (
                        <span className="bg-primary/10 text-primary px-2 py-0.5 rounded-md text-[10px] font-medium">Org</span>
                      )}
                      {user.banned && (
                        <span className="bg-amber-500/10 text-amber-600 px-2 py-0.5 rounded-md text-[10px] font-medium">Suspended</span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                  </div>
                </div>
                {user.id !== adminUserId && (
                  <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
                    {user.accountType === 'organization' && (
                      <Button
                        size="sm"
                        variant="outline"
                        className={cn('rounded-md text-xs', user.verified
                          ? 'text-sky-600 border-sky-300 hover:bg-sky-50 dark:hover:bg-sky-950'
                          : 'text-muted-foreground border-border hover:bg-accent')}
                        onClick={() => onVerifyUser(user.id)}
                        title={user.verified ? 'Remove verification badge' : 'Grant verification badge'}
                      >
                        <BadgeCheck className="w-3 h-3 mr-1" />
                        {user.verified ? 'Unverify' : 'Verify'}
                      </Button>
                    )}
                    {/* Nudge one person: the questionnaire by email, or a
                        notification in the site. Hidden for anyone the nudge
                        makes no sense for -- organizations and admins never
                        answer it, and a volunteer who already has is done. */}
                    {user.accountType === 'volunteer' && !user.isAdmin && !user.onboardingCompletedAt && !user.banned && (
                      <Button
                        size="sm" variant="outline"
                        className="rounded-md text-xs px-2 text-primary border-primary/30 hover:bg-primary/5"
                        title={`Email the questionnaire to ${user.username}`}
                        disabled={nudging === `${user.id}:email`}
                        onClick={() => sendNudge(user, 'email')}
                      >
                        <Mail className="w-3.5 h-3.5" />
                      </Button>
                    )}
                    {!user.banned && (
                      <Button
                        size="sm" variant="outline"
                        className="rounded-md text-xs px-2 text-primary border-primary/30 hover:bg-primary/5"
                        title={`Send ${user.username} a notification on the site`}
                        disabled={nudging === `${user.id}:notification`}
                        onClick={() => { setComposeText(''); setComposeFor(user); }}
                      >
                        <Bell className="w-3.5 h-3.5" />
                      </Button>
                    )}
                    {user.banned ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-md text-xs text-green-600 border-green-300 hover:bg-green-50 dark:hover:bg-green-950"
                        onClick={() => onUnbanUser(user.id)}
                      >
                        <CheckCircle2 className="w-3 h-3 mr-1" /> Reinstate
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-md text-xs text-amber-600 border-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950"
                        onClick={() => setConfirmSuspendUser(user)}
                      >
                        <Ban className="w-3 h-3 mr-1" /> Suspend
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="destructive"
                      className="rounded-md"
                      onClick={() => setConfirmDeleteUser(user)}
                    >
                      <Trash2 className="w-3 h-3 mr-1" /> Delete
                    </Button>
                  </div>
                )}
              </div>

              {/* Organizations and admins never answer the questionnaire, and
                  a volunteer who hasn't completed it has nothing to show --
                  the toggle only appears where there's something behind it. */}
              {user.accountType === 'volunteer' && user.onboardingCompletedAt && (
                <>
                  <button
                    onClick={() => setExpandedUserId(id => id === user.id ? null : user.id)}
                    className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    {expandedUserId === user.id ? 'Hide' : 'View'} preferences
                    <ChevronDown className={cn('w-3.5 h-3.5 transition-transform duration-200', expandedUserId === user.id && 'rotate-180')} />
                  </button>
                  {expandedUserId === user.id && (
                    <div className="mt-3 pt-3 border-t border-border space-y-2.5">
                      {/* Ordered by what an admin actually scans for first:
                          when they can help, how experienced they already
                          are, then what kind of work they're drawn to. Towns
                          is real data too, just the least decision-relevant
                          of the six, so it sits last rather than first. */}
                      {!!user.onboardingAvailability?.length && (
                        <div>
                          <p className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground mb-1">Available</p>
                          <div className="flex flex-wrap gap-1">
                            {user.onboardingAvailability.map(id => (
                              <span key={id} className="px-2 py-0.5 rounded-md bg-secondary text-xs">
                                {AVAILABILITY_OPTIONS.find(o => o.id === id)?.label || id}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {(user.onboardingHoursSoFar != null || user.onboardingGoalHours != null || user.onboardingGoalEvents != null) && (
                        <div>
                          <p className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground mb-1">Hours</p>
                          <div className="flex gap-4 flex-wrap text-xs text-foreground">
                            {user.onboardingHoursSoFar != null && <span>{user.onboardingHoursSoFar} hrs done before</span>}
                            {/* One "Goal" label covering both answers, not one
                                per field -- two separate spans each writing
                                their own "Goal:" was why it showed up twice
                                when someone answered both. */}
                            {(user.onboardingGoalHours != null || user.onboardingGoalEvents != null) && (
                              <span>
                                Goal this year: {[
                                  user.onboardingGoalHours != null ? `${user.onboardingGoalHours} hrs` : null,
                                  user.onboardingGoalEvents != null ? `${user.onboardingGoalEvents} events` : null,
                                ].filter(Boolean).join(', ')}
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                      {!!user.onboardingMajors && (
                        <div>
                          <p className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground mb-1">Major / field of study</p>
                          <p className="text-xs text-foreground">{user.onboardingMajors}</p>
                        </div>
                      )}
                      {!!user.onboardingInterests?.length && (
                        <div>
                          <p className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground mb-1">Kind of work they enjoy</p>
                          <div className="flex flex-wrap gap-1">
                            {user.onboardingInterests.map(tag => (
                              <span key={tag} className="px-2 py-0.5 rounded-md bg-secondary text-xs">{tag}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      {!!user.onboardingTowns?.length && (
                        <div>
                          <p className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground mb-1">Towns</p>
                          <div className="flex flex-wrap gap-1">
                            {user.onboardingTowns.map(t => (
                              <span key={t} className="px-2 py-0.5 rounded-md bg-secondary text-xs">{t}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      {!user.onboardingInterests?.length && !user.onboardingTowns?.length && !user.onboardingAvailability?.length
                        && !user.onboardingMajors && user.onboardingHoursSoFar == null && user.onboardingGoalHours == null && user.onboardingGoalEvents == null && (
                        <p className="text-xs text-muted-foreground italic">Completed the questionnaire without answering anything.</p>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ===== Opportunities Tab =====
function OpportunitiesTab({
  opportunities,
  adminUserId,
  onDeleteOpportunity,
  onUpdateOpportunity,
  onToggleFeatured,
}: {
  opportunities: Opportunity[];
  adminUserId: string;
  onDeleteOpportunity: (oppId: string, reason?: string) => Promise<void>;
  onUpdateOpportunity: (oppId: string, data: Record<string, any>, reason?: string) => Promise<boolean>;
  onToggleFeatured: (oppId: string) => Promise<void>;
}) {
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [confirmDeleteOpp, setConfirmDeleteOpp] = useState<Opportunity | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{
    title: string; description: string; category: Category;
    location: string; town: string; date: string; duration: number; spots: number;
    pinnedSize: 'small' | 'medium' | 'large' | null;
    externalSignupUrl: string;
  }>({ title: '', description: '', category: 'volunteer', location: '', town: '', date: '', duration: 2, spots: 10, pinnedSize: null, externalSignupUrl: '' });
  const [editReason, setEditReason] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [signupUrlError, setSignupUrlError] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setSearchQuery(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const filteredOpps = opportunities.filter(o =>
    o.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    o.location.toLowerCase().includes(searchQuery.toLowerCase()) ||
    o.category.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const startEdit = (opp: Opportunity) => {
    setEditingId(opp.id);
    setEditReason('');
    setSignupUrlError('');
    setEditForm({
      title: opp.title,
      description: opp.description,
      category: opp.category as Category,
      location: opp.location,
      town: opp.town ?? '',
      date: opp.date,
      duration: opp.duration,
      spots: opp.spots,
      pinnedSize: (opp.pinnedSize as 'small' | 'medium' | 'large' | null) ?? null,
      externalSignupUrl: opp.externalSignupUrl ?? '',
    });
  };

  const handleSaveEdit = async (oppId: string) => {
    if (!editForm.title || !editForm.description || !editForm.location || !editForm.date) return;
    const urlError = getExternalSignupUrlError(editForm.externalSignupUrl);
    if (urlError) { setSignupUrlError(urlError); return; }
    setSavingEdit(true);
    const ok = await onUpdateOpportunity(oppId, editForm, editReason);
    setSavingEdit(false);
    if (ok) { setEditingId(null); setEditReason(''); }
  };

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search opportunities..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="pl-11 h-11 rounded-xl border border-border"
        />
      </div>

      <AlertDialog open={!!confirmDeleteOpp} onOpenChange={(open) => { if (!open) { setConfirmDeleteOpp(null); setDeleteReason(''); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Opportunity?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{confirmDeleteOpp?.title}</strong>? All signups will be removed. This cannot be undone.
              The host will receive a notification.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="px-1 pb-2">
            <Textarea
              placeholder="Reason for removal (optional — will be included in the host's notification)"
              value={deleteReason}
              onChange={e => setDeleteReason(e.target.value)}
              className="rounded-xl text-sm min-h-[72px] resize-none"
              maxLength={300}
            />
            {deleteReason.length > 0 && (
              <p className="text-[10px] text-muted-foreground mt-1 text-right">{deleteReason.length}/300</p>
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteReason('')}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-500 hover:bg-red-600"
              onClick={() => {
                if (confirmDeleteOpp) {
                  onDeleteOpportunity(confirmDeleteOpp.id, deleteReason);
                  setConfirmDeleteOpp(null);
                  setDeleteReason('');
                }
              }}
            >
              Delete Opportunity
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <p className="text-sm text-muted-foreground">{filteredOpps.length} opportunities found</p>

      {filteredOpps.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <MapPin className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p>{searchQuery ? `No opportunities matching "${searchQuery}"` : 'No opportunities yet'}</p>
        </div>
      ) : (
      <div className="space-y-3">
        {filteredOpps.map((opp) => (
          <div key={opp.id} className="rounded-2xl bg-card border border-border overflow-hidden">
            <div className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={cn(
                      'px-2 py-0.5 rounded-md text-[10px] font-medium uppercase tracking-wide',
                      getCategoryTint(opp.category)
                    )}>
                      {getCategoryLabel(opp.category)}
                    </span>
                    <span className="text-xs text-muted-foreground">by {opp.hostName}</span>
                  </div>
                  <h4 className="font-semibold text-foreground text-sm truncate">{opp.title}</h4>
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{opp.description}</p>
                  <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                    <span>{opp.location}</span>
                    <span>·</span>
                    <span>{opp.signups.length} interested</span>
                    <span>·</span>
                    <span>{opp.duration}h</span>
                  </div>
                </div>
                {opp.image && (
                  <img src={opp.image} alt={opp.title} className="w-16 h-16 rounded-xl object-cover flex-shrink-0" />
                )}
              </div>
              <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border/50">
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-md text-xs"
                  onClick={() => editingId === opp.id ? setEditingId(null) : startEdit(opp)}
                >
                  {editingId === opp.id ? <ChevronUp className="w-3 h-3 mr-1" /> : <Edit3 className="w-3 h-3 mr-1" />}
                  {editingId === opp.id ? 'Close' : 'Edit'}
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  className="rounded-md text-xs"
                  onClick={() => setConfirmDeleteOpp(opp)}
                >
                  <Trash2 className="w-3 h-3 mr-1" /> Delete
                </Button>
                <button
                  onClick={() => onToggleFeatured(opp.id)}
                  title={opp.isFeatured ? 'Remove from featured' : 'Mark as featured'}
                  className={cn(
                    'p-1.5 rounded-md transition-colors',
                    opp.isFeatured
                      ? 'text-yellow-500 bg-yellow-500/10 hover:bg-yellow-500/20'
                      : 'text-muted-foreground hover:bg-secondary'
                  )}
                >
                  <Star className="w-4 h-4" fill={opp.isFeatured ? 'currentColor' : 'none'} />
                </button>
              </div>
            </div>

            {/* Inline edit form */}
            {editingId === opp.id && (
              <div className="border-t border-border p-4 bg-secondary/20 space-y-3">
                <p className="text-xs font-semibold text-foreground uppercase tracking-wide">Edit Post</p>
                <div className="space-y-2">
                  <Input placeholder="Title *" value={editForm.title}
                    onChange={e => setEditForm({ ...editForm, title: e.target.value })}
                    className="h-9 rounded-xl text-sm" />
                  <Textarea placeholder="Description *" value={editForm.description}
                    onChange={e => setEditForm({ ...editForm, description: e.target.value })}
                    className="rounded-xl text-sm min-h-[60px]" />
                  <div className="grid grid-cols-3 gap-2">
                    <select value={editForm.category}
                      onChange={e => setEditForm({ ...editForm, category: e.target.value as Category })}
                      className="h-9 rounded-xl border border-input bg-background px-3 text-sm">
                      {getEditCategoryOptions(editForm.category).map(c => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </select>
                    <Input placeholder="Location *" value={editForm.location}
                      onChange={e => setEditForm({ ...editForm, location: e.target.value })}
                      className="h-9 rounded-xl text-sm" />
                    <select value={editForm.town}
                      onChange={e => setEditForm({ ...editForm, town: e.target.value })}
                      className="h-9 rounded-xl border border-input bg-background px-3 text-sm">
                      <option value="">No town set</option>
                      {TOWNS.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <Input type="datetime-local" value={editForm.date}
                      min={new Date().toISOString().slice(0, 16)}
                      onChange={e => setEditForm({ ...editForm, date: e.target.value })}
                      className="h-9 rounded-xl text-sm" />
                    <Input type="number" placeholder="Duration (hrs)" min={0.5} step={0.5}
                      value={editForm.duration}
                      onChange={e => setEditForm({ ...editForm, duration: parseFloat(e.target.value) })}
                      className="h-9 rounded-xl text-sm" />
                    <Input type="number" placeholder="Capacity" min={1}
                      value={editForm.spots}
                      onChange={e => setEditForm({ ...editForm, spots: parseInt(e.target.value) })}
                      className="h-9 rounded-xl text-sm" />
                  </div>
                  {/* Admin-only: card size override */}
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">Card Size:</span>
                    <select
                      value={editForm.pinnedSize ?? 'auto'}
                      onChange={e => setEditForm({ ...editForm, pinnedSize: e.target.value === 'auto' ? null : e.target.value as 'small' | 'medium' | 'large' })}
                      className="h-9 flex-1 rounded-xl border border-input bg-background px-3 text-sm"
                    >
                      <option value="auto">Auto — by interest count</option>
                      <option value="small">Small (1×1)</option>
                      <option value="medium">Medium (2×1)</option>
                      <option value="large">Large (2×2, hero)</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="admin-field" className="text-xs font-medium text-muted-foreground block mb-1">
                      Signup page (optional) — if volunteers need to register on your own site
                    </label>
                    <Input id="admin-field" placeholder="https://your-site.org/signup" value={editForm.externalSignupUrl}
                      onChange={e => { setEditForm({ ...editForm, externalSignupUrl: e.target.value }); setSignupUrlError(''); }}
                      className={cn("h-9 rounded-xl text-sm", signupUrlError && "ring-2 ring-red-400")} />
                    {signupUrlError && <p className="text-red-500 text-xs mt-1">{signupUrlError}</p>}
                  </div>
                  <div className="relative">
                    <Textarea
                      placeholder="Reason for edit (optional — sends a notification to the host)"
                      value={editReason}
                      onChange={e => setEditReason(e.target.value)}
                      className="rounded-xl text-sm min-h-[56px] resize-none pr-12"
                      maxLength={300}
                    />
                    {editReason.length > 0 && (
                      <p className="absolute bottom-2 right-3 text-[9px] text-muted-foreground">{editReason.length}/300</p>
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setEditingId(null)} className="flex-1 rounded-md">
                    <X className="w-3 h-3 mr-1" /> Cancel
                  </Button>
                  <Button size="sm" onClick={() => handleSaveEdit(opp.id)} disabled={savingEdit} className="flex-1 rounded-md">
                    {savingEdit ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Save className="w-3 h-3 mr-1" />}
                    {savingEdit ? 'Saving...' : 'Save Changes'}
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      )}
    </div>
  );
}

// ===== Verify Tab =====
function VerifyTab({
  pendingOpportunities,
  onApprove,
  onDeny,
}: {
  pendingOpportunities: Opportunity[];
  onApprove: (oppId: string) => Promise<void>;
  onDeny: (oppId: string, reason: string) => Promise<void>;
}) {
  const [denyingId, setDenyingId] = useState<string | null>(null);
  const [denyReason, setDenyReason] = useState('');
  const [processingId, setProcessingId] = useState<string | null>(null);

  const handleApprove = async (oppId: string) => {
    setProcessingId(oppId);
    await onApprove(oppId);
    setProcessingId(null);
  };

  const handleDeny = async (oppId: string) => {
    setProcessingId(oppId);
    await onDeny(oppId, denyReason);
    setDenyingId(null);
    setDenyReason('');
    setProcessingId(null);
  };

  if (pendingOpportunities.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
        <div className="w-14 h-14 rounded-2xl bg-green-500/10 flex items-center justify-center">
          <CheckCircle2 className="w-7 h-7 text-green-500" />
        </div>
        <p className="font-semibold text-foreground">All caught up!</p>
        <p className="text-sm text-muted-foreground">No posts are waiting for approval.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {pendingOpportunities.length} post{pendingOpportunities.length !== 1 ? 's' : ''} waiting for review.
      </p>
      {pendingOpportunities.map((opp) => (
        <div key={opp.id} className="rounded-2xl bg-card border border-border p-5 space-y-3">
          {/* Header row */}
          <div className="flex items-start gap-4">
            {opp.image && (
              <img
                src={opp.image}
                alt={opp.title}
                className="w-16 h-16 rounded-xl object-cover flex-shrink-0 border border-border"
              />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className="bg-orange-500/10 text-orange-600 px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wide">
                  Pending
                </span>
                <span className="bg-muted text-muted-foreground px-2 py-0.5 rounded-md text-[10px] font-medium capitalize">
                  {opp.category}
                </span>
              </div>
              <h3 className="font-semibold text-foreground truncate">{opp.title}</h3>
              <p className="text-xs text-muted-foreground">by {opp.hostName} · {opp.location}</p>
            </div>
          </div>

          {/* Description */}
          <p className="text-sm text-muted-foreground line-clamp-3">{opp.description}</p>

          {/* Meta */}
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1"><Calendar className="w-3 h-3" />{new Date(opp.date).toLocaleDateString(undefined, { dateStyle: 'medium' })}</span>
            <span>⏱ {opp.duration}h</span>
            {opp.spotsType === 'limited' && <span>👥 {opp.spots} spots</span>}
          </div>

          {/* Deny reason input */}
          {denyingId === opp.id && (
            <div className="space-y-2">
              <Textarea
                placeholder="Reason for denial (will be sent to the organization)…"
                value={denyReason}
                onChange={e => setDenyReason(e.target.value)}
                className="rounded-xl text-sm min-h-[64px] resize-none"
                maxLength={300}
              />
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            {denyingId === opp.id ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 rounded-md"
                  onClick={() => { setDenyingId(null); setDenyReason(''); }}
                  disabled={processingId === opp.id}
                >
                  <X className="w-3 h-3 mr-1" /> Cancel
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  className="flex-1 rounded-md"
                  onClick={() => handleDeny(opp.id)}
                  disabled={processingId === opp.id}
                >
                  {processingId === opp.id ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <XCircle className="w-3 h-3 mr-1" />}
                  Confirm Deny
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 rounded-md text-red-600 border-red-300 hover:bg-red-50 dark:hover:bg-red-950"
                  onClick={() => setDenyingId(opp.id)}
                  disabled={processingId === opp.id}
                >
                  <XCircle className="w-3 h-3 mr-1" /> Deny
                </Button>
                <Button
                  size="sm"
                  className="flex-1 rounded-md bg-green-600 hover:bg-green-700 text-white"
                  onClick={() => handleApprove(opp.id)}
                  disabled={processingId === opp.id}
                >
                  {processingId === opp.id ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <CheckCircle2 className="w-3 h-3 mr-1" />}
                  Approve
                </Button>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ===== Reports Tab =====
function ReportsTab({ toast }: { toast: any }) {
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchReports = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('locallink_token');
      const res = await fetch('/api/admin/reports', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setReports(await res.json());
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { fetchReports(); }, []);

  const dismissReport = async (id: string) => {
    const token = localStorage.getItem('locallink_token');
    const res = await fetch(`/api/admin/reports/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) {
      setReports(r => r.filter(x => x.id !== id));
      toast({ title: 'Report dismissed' });
    }
  };

  const REASON_LABELS: Record<string, string> = {
    spam: 'Spam or misleading', inappropriate: 'Inappropriate content', fake: 'Fake or scam', other: 'Other',
  };

  const PAGE_SIZE = 10;
  const [page, setPage] = useState(0);
  const totalPages = Math.ceil(reports.length / PAGE_SIZE);
  const pageReports = reports.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-heading font-bold text-lg">Reports <span className="text-muted-foreground font-normal text-base">({reports.length})</span></h2>
      </div>
      {reports.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Flag className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p>No reports yet — all clear!</p>
        </div>
      ) : (
        <>
        <div className="space-y-3">
          {pageReports.map(r => (
            <div key={r.id} className="rounded-2xl bg-card border border-border p-4 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-foreground truncate">{r.postTitle}</p>
                  <p className="text-xs text-muted-foreground">Reported by <span className="font-medium">{r.reporterName}</span> · {new Date(r.createdAt).toLocaleDateString()}</p>
                </div>
                <span className="text-xs bg-red-500/10 text-red-500 font-semibold px-2.5 py-1 rounded-md whitespace-nowrap flex-shrink-0">
                  {REASON_LABELS[r.reason] || r.reason}
                </span>
              </div>
              {r.note && <p className="text-sm text-muted-foreground bg-secondary/50 rounded-xl px-3 py-2">"{r.note}"</p>}
              <div className="flex gap-2 pt-1">
                <Button variant="outline" size="sm" className="rounded-md text-xs" onClick={() => dismissReport(r.id)}>
                  <Trash2 className="w-3 h-3 mr-1" /> Dismiss
                </Button>
              </div>
            </div>
          ))}
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 pt-2">
            <Button variant="outline" size="sm" className="rounded-md" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>← Prev</Button>
            <span className="text-xs text-muted-foreground">{page + 1} / {totalPages}</span>
            <Button variant="outline" size="sm" className="rounded-md" onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page === totalPages - 1}>Next →</Button>
          </div>
        )}
        </>
      )}
    </div>
  );
}

// ===== Appeals Tab =====
function AppealsTab({ toast, onUnbanUser }: { toast: any; onUnbanUser: (userId: string) => Promise<boolean> }) {
  const [appeals, setAppeals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAppeals = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('locallink_token');
      const res = await fetch('/api/admin/appeals', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setAppeals(await res.json());
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { fetchAppeals(); }, []);

  const approveAppeal = async (appeal: any) => {
    const token = localStorage.getItem('locallink_token');
    const res = await fetch(`/api/admin/appeals/${appeal.id}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      setAppeals(a => a.filter(x => x.id !== appeal.id));
      // Sync the Zustand users store so the Users tab reflects the unban immediately
      await onUnbanUser(appeal.userId);
      toast({ title: `${appeal.username}'s account has been reinstated` });
    } else {
      toast({ title: 'Failed to approve appeal', variant: 'destructive' });
    }
  };

  const dismissAppeal = async (id: string) => {
    const token = localStorage.getItem('locallink_token');
    const res = await fetch(`/api/admin/appeals/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      setAppeals(a => a.filter(x => x.id !== id));
      toast({ title: 'Appeal dismissed' });
    }
  };

  const APPEALS_PAGE_SIZE = 10;
  const [appealsPage, setAppealsPage] = useState(0);
  const appealsTotalPages = Math.ceil(appeals.length / APPEALS_PAGE_SIZE);
  const pageAppeals = appeals.slice(appealsPage * APPEALS_PAGE_SIZE, (appealsPage + 1) * APPEALS_PAGE_SIZE);

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-heading font-bold text-lg">
          Appeals <span className="text-muted-foreground font-normal text-base">({appeals.length})</span>
        </h2>
      </div>
      {appeals.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Scale className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p>No pending appeals.</p>
        </div>
      ) : (
        <>
        <div className="space-y-3">
          {pageAppeals.map(a => (
            <div key={a.id} className="rounded-2xl bg-card border border-border p-4 space-y-3">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-full bg-amber-500/10 flex items-center justify-center text-sm font-bold text-amber-600 flex-shrink-0">
                  {a.username.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-foreground">{a.username}</p>
                    <span className="bg-amber-500/10 text-amber-600 px-2 py-0.5 rounded-md text-[10px] font-medium">Suspended</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{a.email} · {new Date(a.createdAt).toLocaleDateString()}</p>
                </div>
              </div>
              <div className="bg-secondary/50 rounded-xl px-3 py-2.5">
                <p className="text-xs text-muted-foreground font-medium mb-1 uppercase tracking-wide">Appeal message</p>
                <p className="text-sm text-foreground leading-relaxed">"{a.message}"</p>
              </div>
              <div className="flex gap-2 pt-1">
                <Button
                  size="sm"
                  className="rounded-md text-xs bg-green-600 hover:bg-green-700 flex-1"
                  onClick={() => approveAppeal(a)}
                >
                  <CheckCircle2 className="w-3 h-3 mr-1" /> Approve & Reinstate
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-md text-xs flex-1"
                  onClick={() => dismissAppeal(a.id)}
                >
                  <X className="w-3 h-3 mr-1" /> Dismiss
                </Button>
              </div>
            </div>
          ))}
        </div>
        {appealsTotalPages > 1 && (
          <div className="flex items-center justify-center gap-2 pt-2">
            <Button variant="outline" size="sm" className="rounded-md" onClick={() => setAppealsPage(p => Math.max(0, p - 1))} disabled={appealsPage === 0}>← Prev</Button>
            <span className="text-xs text-muted-foreground">{appealsPage + 1} / {appealsTotalPages}</span>
            <Button variant="outline" size="sm" className="rounded-md" onClick={() => setAppealsPage(p => Math.min(appealsTotalPages - 1, p + 1))} disabled={appealsPage === appealsTotalPages - 1}>Next →</Button>
          </div>
        )}
        </>
      )}
    </div>
  );
}

// ===== Feedback Tab =====
function FeedbackTab({ toast }: { toast: any }) {
  const [feedback, setFeedback] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchFeedback = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('locallink_token');
      const res = await fetch('/api/admin/feedback', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setFeedback(await res.json());
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { fetchFeedback(); }, []);

  const deleteFeedback = async (id: string) => {
    const token = localStorage.getItem('locallink_token');
    const res = await fetch(`/api/admin/feedback/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) {
      setFeedback(f => f.filter(x => x.id !== id));
      toast({ title: 'Feedback deleted' });
    }
  };

  const avgRating = feedback.length > 0
    ? (feedback.reduce((s, f) => s + f.rating, 0) / feedback.length).toFixed(1)
    : '—';

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="font-heading font-bold text-lg">Feedback <span className="text-muted-foreground font-normal text-base">({feedback.length})</span></h2>
        {feedback.length > 0 && (
          <div className="flex items-center gap-1.5 bg-yellow-500/10 text-yellow-600 px-3 py-1.5 rounded-md text-sm font-semibold">
            <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" />
            {avgRating} avg rating
          </div>
        )}
      </div>
      {feedback.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <MessageSquare className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p>No feedback yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {feedback.map(f => (
            <div key={f.id} className="rounded-2xl bg-card border border-border p-4 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex gap-0.5 mb-1">
                    {[1,2,3,4,5].map(s => (
                      <Star key={s} className={cn('w-3.5 h-3.5', s <= f.rating ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground/20')} />
                    ))}
                  </div>
                  <p className="text-sm text-foreground">{f.message}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {f.username ? <span className="font-medium">{f.username}</span> : 'Anonymous'} · {new Date(f.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <button onClick={() => deleteFeedback(f.id)} className="p-1.5 rounded-md hover:bg-secondary transition-colors flex-shrink-0">
                  <X className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ===== Join Links Tab =====
function JoinLinksTab({
  links,
  onCreate,
  onDelete,
  toast,
}: {
  links: JoinLink[];
  onCreate: (orgName: string, category?: string) => Promise<void>;
  onDelete: (slug: string) => Promise<void>;
  toast: ReturnType<typeof useToast>['toast'];
}) {
  const [orgName, setOrgName] = useState('');
  const [category, setCategory] = useState('');
  const [creating, setCreating] = useState(false);
  const BASE = typeof window !== 'undefined' ? window.location.origin : 'https://localnetlink.com';

  const handleCreate = async () => {
    if (!orgName.trim()) return;
    setCreating(true);
    await onCreate(orgName.trim(), category || undefined);
    setOrgName('');
    setCategory('');
    setCreating(false);
  };

  const copyLink = (slug: string) => {
    navigator.clipboard.writeText(`${BASE}/join/${slug}`);
    toast({ title: 'Link copied to clipboard!' });
  };

  const claimed = links.filter(l => l.claimedAt);
  const unclaimed = links.filter(l => !l.claimedAt);

  return (
    <div className="space-y-6">
      {/* Create new link */}
      <div className="rounded-2xl bg-card border border-border p-6 space-y-4">
        <h3 className="font-heading font-semibold text-foreground flex items-center gap-2">
          <Link2 className="w-5 h-5 text-primary" /> Generate a Join Link
        </h3>
        <p className="text-sm text-muted-foreground">
          Create a custom link like <span className="font-mono text-foreground">localnetlink.com/join/org-name</span> to send to an organization.
          They'll land on a pre-filled registration page and receive a verified badge automatically.
        </p>
        <div className="flex gap-3 flex-wrap">
          <Input
            placeholder="Organization name (e.g. Montgomery EMS)"
            value={orgName}
            onChange={e => setOrgName(e.target.value)}
            className="flex-1 min-w-48 h-11 rounded-xl border border-border"
            onKeyDown={e => e.key === 'Enter' && handleCreate()}
          />
          <select
            value={category}
            onChange={e => setCategory(e.target.value)}
            className="h-11 rounded-xl border border-border bg-background px-3 text-sm text-foreground"
          >
            <option value="">Any category</option>
            <option value="volunteer">Volunteer</option>
            <option value="education">Education</option>
            <option value="fitness">Fitness</option>
            <option value="community">Community</option>
            <option value="environment">Environment</option>
          </select>
          <Button onClick={handleCreate} disabled={creating || !orgName.trim()} className="h-11 rounded-xl px-6">
            {creating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Link2 className="w-4 h-4 mr-2" />}
            Generate Link
          </Button>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-2xl bg-card border border-border p-4 text-center">
          <p className="text-2xl font-bold text-foreground">{unclaimed.length}</p>
          <p className="text-xs text-muted-foreground mt-1">Links Sent (unclaimed)</p>
        </div>
        <div className="rounded-2xl bg-card border border-border p-4 text-center">
          <p className="text-2xl font-bold text-green-500">{claimed.length}</p>
          <p className="text-xs text-muted-foreground mt-1">Orgs Registered</p>
        </div>
      </div>

      {/* Link list */}
      {links.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Link2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p>No join links yet. Generate one above and send it to an organization.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {links.map(link => (
            <div key={link.slug} className={cn('rounded-2xl bg-card border border-border p-4 flex items-center justify-between gap-3 flex-wrap', link.claimedAt && 'border-green-500/30 bg-green-500/5')}>
              <div className="space-y-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-semibold text-foreground">{link.orgName}</p>
                  {link.claimedAt ? (
                    <span className="text-[10px] font-bold bg-green-500/15 text-green-600 px-2 py-0.5 rounded-md flex items-center gap-1">
                      <VerifiedBadge className="w-3 h-3" /> Registered
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold bg-muted text-muted-foreground px-2 py-0.5 rounded-md">Pending</span>
                  )}
                  {link.category && (
                    <span className="text-[10px] font-semibold bg-primary/10 text-primary px-2 py-0.5 rounded-md capitalize">{link.category}</span>
                  )}
                </div>
                <p className="text-xs font-mono text-muted-foreground truncate">{BASE}/join/{link.slug}</p>
                {link.claimedAt && (
                  <p className="text-xs text-green-600">Registered {new Date(link.claimedAt).toLocaleDateString()}</p>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {!link.claimedAt && (
                  <Button size="sm" variant="outline" className="rounded-md text-xs" onClick={() => copyLink(link.slug)}>
                    <Copy className="w-3 h-3 mr-1" /> Copy Link
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-md text-xs text-red-500 border-red-200 hover:bg-red-50 dark:hover:bg-red-950"
                  onClick={() => onDelete(link.slug)}
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

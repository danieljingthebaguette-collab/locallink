import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useAuthStore, useAdminStore, useOpportunitiesStore } from '@/lib/store';
import { Ban, CheckCircle2, TrendingUp, Scale, ClipboardCheck, XCircle } from 'lucide-react';
import type { AppUser, Opportunity } from '@/lib/mockData';
import { CATEGORIES, type Category } from '@/lib/mockData';
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
  Loader2,
  Flag,
  MessageSquare,
} from 'lucide-react';

type Tab = 'overview' | 'users' | 'opportunities' | 'verify' | 'reports' | 'feedback' | 'appeals';

export default function Admin() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { isLoggedIn, currentUser } = useAuthStore();
  const { users, stats, loading, fetchUsers, fetchStats, deleteUser, deleteOpportunity, updateOpportunity, banUser, unbanUser, pendingOpportunities, fetchPendingOpportunities, approveOpportunity, denyOpportunity, toggleFeatured } = useAdminStore();
  const { opportunities, fetchOpportunities } = useOpportunitiesStore();
  const [activeTab, setActiveTab] = useState<Tab>('overview');

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
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-primary/5 via-background to-background pb-24 font-sans">
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
                'flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-medium transition-all whitespace-nowrap',
                activeTab === tab.value
                  ? 'bg-foreground text-background shadow-md'
                  : 'bg-card border border-border text-muted-foreground hover:bg-accent'
              )}
            >
              {tab.icon}
              {tab.label}
              {tab.badge !== undefined && tab.badge > 0 && (
                <span className="ml-1 min-w-[18px] h-[18px] px-1 rounded-full bg-orange-500 text-white text-[10px] font-bold flex items-center justify-center">
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
                // Reset and refetch opportunities so deleted user's posts disappear from the feed
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

function OverviewTab({ stats, users, opportunities }: { stats: any; users: AppUser[]; opportunities: Opportunity[] }) {
  const [rangeDays, setRangeDays] = useState<7 | 14 | 30 | 365>(14);
  const [analytics, setAnalytics] = useState<{ date: string; signups: number; users: number }[]>([]);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('locallink_token');
    setAnalyticsLoading(true);
    fetch(`/api/admin/analytics?days=${rangeDays}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : [])
      .then((raw: { date: string; signups: number; users: number }[]) => {
        setAnalytics(rangeDays === 365 ? bucketByMonth(raw) : raw);
      })
      .catch(() => {})
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
                  'px-2.5 py-1 rounded-full text-xs font-semibold transition-all border',
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
          <div className="flex items-end gap-1 h-28">
            {Array.from({ length: rangeDays === 365 ? 12 : rangeDays }).map((_, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                <div className="w-full rounded-t-sm bg-muted animate-pulse" style={{ height: `${20 + Math.random() * 60}%`, minHeight: 8 }} />
              </div>
            ))}
          </div>
        ) : chartData.length > 0 ? (
          <div className="flex items-end gap-1 h-28">
            {chartData.map((d) => (
              <div
                key={d.date}
                className="flex-1 flex flex-col items-center gap-0.5 min-w-0 cursor-default"
                onMouseEnter={() => setHoveredDay(d)}
                onMouseLeave={() => setHoveredDay(null)}
              >
                <div className="w-full flex gap-[2px] items-end" style={{ height: '88px' }}>
                  <div
                    className={cn('flex-1 rounded-t-sm transition-colors', hoveredDay?.date === d.date ? 'bg-violet-500' : 'bg-violet-500/60')}
                    style={{ height: `${maxSignups > 0 ? Math.max((d.signups / maxSignups) * 100, d.signups > 0 ? 5 : 0) : 0}%` }}
                  />
                  <div
                    className={cn('flex-1 rounded-t-sm transition-colors', hoveredDay?.date === d.date ? 'bg-sky-400' : 'bg-sky-400/60')}
                    style={{ height: `${maxUsers > 0 ? Math.max((d.users / maxUsers) * 100, d.users > 0 ? 5 : 0) : 0}%` }}
                  />
                </div>
                <p className="text-[7px] text-muted-foreground leading-none mt-0.5 w-full text-center truncate">
                  {rangeDays === 365 ? d.date.slice(0, 7).replace('-', '/') : d.date.slice(5).replace('-', '/')}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex items-center justify-center h-28 text-sm text-muted-foreground">No data for this period</div>
        )}

        {/* Stats row */}
        <div className="flex items-center justify-between mt-4 pt-3 border-t border-border/30 gap-3 flex-wrap">
          <div className="flex items-center gap-5">
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-sm bg-violet-500/80 flex-shrink-0" />
              <span className="text-xs text-muted-foreground">
                <span className="font-bold text-foreground text-sm mr-0.5">
                  {hoveredDay ? hoveredDay.signups : totalSignups}
                </span>
                {hoveredDay ? 'signups' : 'total signups'}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-sm bg-sky-400/80 flex-shrink-0" />
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
              : `${activeRange.title.toLowerCase()} totals · hover a bar for details`}
          </p>
        </div>
      </div>

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
                  <span className="bg-red-500/10 text-red-500 px-2 py-0.5 rounded-full font-medium">Admin</span>
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
}: {
  users: AppUser[];
  adminUserId: string;
  loading: boolean;
  onDeleteUser: (userId: string) => Promise<void>;
  onBanUser: (userId: string) => Promise<void>;
  onUnbanUser: (userId: string) => Promise<void>;
}) {
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [confirmDeleteUser, setConfirmDeleteUser] = useState<AppUser | null>(null);

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
          className="pl-11 h-11 rounded-xl border-2 border-border"
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
                      {user.isAdmin && (
                        <span className="bg-red-500/10 text-red-500 px-2 py-0.5 rounded-full text-[10px] font-medium">Admin</span>
                      )}
                      {user.banned && (
                        <span className="bg-amber-500/10 text-amber-600 px-2 py-0.5 rounded-full text-[10px] font-medium">Suspended</span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                  </div>
                </div>
                {user.id !== adminUserId && (
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {user.banned ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-full text-xs text-green-600 border-green-300 hover:bg-green-50 dark:hover:bg-green-950"
                        onClick={() => onUnbanUser(user.id)}
                      >
                        <CheckCircle2 className="w-3 h-3 mr-1" /> Reinstate
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-full text-xs text-amber-600 border-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950"
                        onClick={() => onBanUser(user.id)}
                      >
                        <Ban className="w-3 h-3 mr-1" /> Suspend
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="destructive"
                      className="rounded-full"
                      onClick={() => setConfirmDeleteUser(user)}
                    >
                      <Trash2 className="w-3 h-3 mr-1" /> Delete
                    </Button>
                  </div>
                )}
              </div>
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
    location: string; date: string; duration: number; spots: number;
    pinnedSize: 'small' | 'medium' | 'large' | null;
  }>({ title: '', description: '', category: 'volunteer', location: '', date: '', duration: 2, spots: 10, pinnedSize: null });
  const [editReason, setEditReason] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

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
    setEditForm({
      title: opp.title,
      description: opp.description,
      category: opp.category as Category,
      location: opp.location,
      date: opp.date,
      duration: opp.duration,
      spots: opp.spots,
      pinnedSize: (opp.pinnedSize as 'small' | 'medium' | 'large' | null) ?? null,
    });
  };

  const handleSaveEdit = async (oppId: string) => {
    if (!editForm.title || !editForm.description || !editForm.location || !editForm.date) return;
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
          className="pl-11 h-11 rounded-xl border-2 border-border"
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
                      'px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wide',
                      opp.category === 'volunteer' ? 'bg-cat-vol/10 text-cat-vol' :
                      opp.category === 'education' ? 'bg-cat-edu/10 text-cat-edu' :
                      opp.category === 'fitness' ? 'bg-cat-sports/10 text-cat-sports' :
                      opp.category === 'community' ? 'bg-cat-community/10 text-cat-community' :
                      'bg-cat-environment/10 text-cat-environment'
                    )}>
                      {opp.category}
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
                  className="rounded-full text-xs"
                  onClick={() => editingId === opp.id ? setEditingId(null) : startEdit(opp)}
                >
                  {editingId === opp.id ? <ChevronUp className="w-3 h-3 mr-1" /> : <Edit3 className="w-3 h-3 mr-1" />}
                  {editingId === opp.id ? 'Close' : 'Edit'}
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  className="rounded-full text-xs"
                  onClick={() => setConfirmDeleteOpp(opp)}
                >
                  <Trash2 className="w-3 h-3 mr-1" /> Delete
                </Button>
                <button
                  onClick={() => onToggleFeatured(opp.id)}
                  title={opp.isFeatured ? 'Remove from featured' : 'Mark as featured'}
                  className={cn(
                    'p-1.5 rounded-full transition-colors',
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
                  <div className="grid grid-cols-2 gap-2">
                    <select value={editForm.category}
                      onChange={e => setEditForm({ ...editForm, category: e.target.value as Category })}
                      className="h-9 rounded-xl border border-input bg-background px-3 text-sm">
                      {CATEGORIES.filter(c => c.value !== 'all').map(c => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </select>
                    <Input placeholder="Location *" value={editForm.location}
                      onChange={e => setEditForm({ ...editForm, location: e.target.value })}
                      className="h-9 rounded-xl text-sm" />
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
                  <Button variant="outline" size="sm" onClick={() => setEditingId(null)} className="flex-1 rounded-full">
                    <X className="w-3 h-3 mr-1" /> Cancel
                  </Button>
                  <Button size="sm" onClick={() => handleSaveEdit(opp.id)} disabled={savingEdit} className="flex-1 rounded-full">
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
                <span className="bg-orange-500/10 text-orange-600 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide">
                  Pending
                </span>
                <span className="bg-muted text-muted-foreground px-2 py-0.5 rounded-full text-[10px] font-medium capitalize">
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
            <span>📅 {new Date(opp.date).toLocaleDateString(undefined, { dateStyle: 'medium' })}</span>
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
                  className="flex-1 rounded-full"
                  onClick={() => { setDenyingId(null); setDenyReason(''); }}
                  disabled={processingId === opp.id}
                >
                  <X className="w-3 h-3 mr-1" /> Cancel
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  className="flex-1 rounded-full"
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
                  className="flex-1 rounded-full text-red-600 border-red-300 hover:bg-red-50 dark:hover:bg-red-950"
                  onClick={() => setDenyingId(opp.id)}
                  disabled={processingId === opp.id}
                >
                  <XCircle className="w-3 h-3 mr-1" /> Deny
                </Button>
                <Button
                  size="sm"
                  className="flex-1 rounded-full bg-green-600 hover:bg-green-700 text-white"
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
                <span className="text-xs bg-red-500/10 text-red-500 font-semibold px-2.5 py-1 rounded-full whitespace-nowrap flex-shrink-0">
                  {REASON_LABELS[r.reason] || r.reason}
                </span>
              </div>
              {r.note && <p className="text-sm text-muted-foreground bg-secondary/50 rounded-xl px-3 py-2">"{r.note}"</p>}
              <div className="flex gap-2 pt-1">
                <Button variant="outline" size="sm" className="rounded-full text-xs" onClick={() => dismissReport(r.id)}>
                  <Trash2 className="w-3 h-3 mr-1" /> Dismiss
                </Button>
              </div>
            </div>
          ))}
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 pt-2">
            <Button variant="outline" size="sm" className="rounded-full" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>← Prev</Button>
            <span className="text-xs text-muted-foreground">{page + 1} / {totalPages}</span>
            <Button variant="outline" size="sm" className="rounded-full" onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page === totalPages - 1}>Next →</Button>
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
                    <span className="bg-amber-500/10 text-amber-600 px-2 py-0.5 rounded-full text-[10px] font-medium">Suspended</span>
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
                  className="rounded-full text-xs bg-green-600 hover:bg-green-700 flex-1"
                  onClick={() => approveAppeal(a)}
                >
                  <CheckCircle2 className="w-3 h-3 mr-1" /> Approve & Reinstate
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-full text-xs flex-1"
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
            <Button variant="outline" size="sm" className="rounded-full" onClick={() => setAppealsPage(p => Math.max(0, p - 1))} disabled={appealsPage === 0}>← Prev</Button>
            <span className="text-xs text-muted-foreground">{appealsPage + 1} / {appealsTotalPages}</span>
            <Button variant="outline" size="sm" className="rounded-full" onClick={() => setAppealsPage(p => Math.min(appealsTotalPages - 1, p + 1))} disabled={appealsPage === appealsTotalPages - 1}>Next →</Button>
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
          <div className="flex items-center gap-1.5 bg-yellow-500/10 text-yellow-600 px-3 py-1.5 rounded-full text-sm font-semibold">
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
                <button onClick={() => deleteFeedback(f.id)} className="p-1.5 rounded-full hover:bg-secondary transition-colors flex-shrink-0">
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

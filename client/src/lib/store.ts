import { create } from 'zustand';
import { type Opportunity, type AppUser, type Category } from './mockData';

const API = '/api';

// ─── Recurring schedule helper ───────────────────────────────────────────────
// For a recurring post (dayOfWeek 0–6, time "HH:MM"):
//   • OPEN   window = midnight (00:00) of event day → event time
//   • CLOSED window = event time → midnight of the same day next week
// Example: "Every Monday 12:00" → open Mon 00:00–12:00, closed Mon 12:00–next Mon 00:00
export function getRecurringStatus(opp: { recurringDay?: number; recurringTime?: string }): {
  isOpen: boolean;
  nextOccurrence: Date;
} | null {
  if (opp.recurringDay === undefined || opp.recurringDay === null || !opp.recurringTime) return null;

  const now = new Date();
  const [h, m] = opp.recurringTime.split(':').map(Number);
  const dayOfWeek = opp.recurringDay as number;

  // How many days ago was the most recent occurrence of dayOfWeek?
  const daysBack = (now.getDay() - dayOfWeek + 7) % 7;

  // Midnight of this week's event day
  const startOfThis = new Date(now);
  startOfThis.setDate(now.getDate() - daysBack);
  startOfThis.setHours(0, 0, 0, 0);

  // Event time on that day — this is when the post closes
  const closeTime = new Date(startOfThis);
  closeTime.setHours(h, m, 0, 0);

  // OPEN: we're on the event day and the event time hasn't come yet
  const isOpen = now >= startOfThis && now < closeTime;

  // nextOccurrence:
  //   • if open  → closeTime (when it closes today)
  //   • if closed → midnight of the same day next week (when it re-opens)
  const startOfNext = new Date(startOfThis);
  startOfNext.setDate(startOfNext.getDate() + 7);
  const nextOccurrence = isOpen ? closeTime : startOfNext;

  return { isOpen, nextOccurrence };
}

// Returns headers with JWT token attached if the user is logged in
function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('locallink_token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

// ===== Auth Store =====
interface AuthState {
  isLoggedIn: boolean;
  currentUser: AppUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string; needsVerification?: boolean; suspended?: boolean; email?: string }>;
  register: (username: string, email: string, password: string, accountType?: string) => Promise<{ success: boolean; error?: string; needsVerification?: boolean; email?: string }>;
  resendVerification: (email: string) => Promise<{ success: boolean; error?: string }>;
  forgotPassword: (email: string) => Promise<{ success: boolean; error?: string }>;
  resetPassword: (token: string, password: string) => Promise<{ success: boolean; error?: string }>;
  updateProfile: (data: { username?: string; currentPassword?: string; newPassword?: string; notifyOnInterest?: boolean; profileImage?: string | null }) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  loadUser: () => void;
}

export const useAuthStore = create<AuthState>((set) => {
  const savedUser = localStorage.getItem('locallink_user');
  const initialUser: AppUser | null = savedUser ? JSON.parse(savedUser) : null;

  return {
    isLoggedIn: !!initialUser,
    currentUser: initialUser,
    loading: false,

    login: async (email, password) => {
      set({ loading: true });
      try {
        const res = await fetch(`${API}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
        const data = await res.json();
        if (!res.ok) {
          set({ loading: false });
          // Surface the "email not verified" case so the UI can offer a resend button
          if (data.needsVerification) {
            return { success: false, error: data.error, needsVerification: true, email: data.email };
          }
          // Surface the "suspended" case so the UI can offer an appeal form
          if (data.suspended) {
            return { success: false, error: data.error, suspended: true, email: data.email };
          }
          return { success: false, error: data.error || 'Login failed' };
        }
        const { token, ...user } = data;
        localStorage.setItem('locallink_user', JSON.stringify(user));
        localStorage.setItem('locallink_token', token);
        set({ isLoggedIn: true, currentUser: user, loading: false });
        return { success: true };
      } catch {
        set({ loading: false });
        return { success: false, error: 'Network error' };
      }
    },

    register: async (username, email, password, accountType = 'volunteer') => {
      set({ loading: true });
      try {
        const res = await fetch(`${API}/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, email, password, accountType }),
        });
        const data = await res.json();
        if (!res.ok) {
          set({ loading: false });
          return { success: false, error: data.error || 'Registration failed' };
        }
        set({ loading: false });
        // Registration succeeded — user must verify their email before logging in
        return { success: true, needsVerification: true, email: data.email };
      } catch {
        set({ loading: false });
        return { success: false, error: 'Network error' };
      }
    },

    resendVerification: async (email) => {
      try {
        const res = await fetch(`${API}/auth/resend-verification`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        const data = await res.json();
        if (!res.ok) return { success: false, error: data.error || 'Failed to resend' };
        return { success: true };
      } catch {
        return { success: false, error: 'Network error' };
      }
    },

    forgotPassword: async (email) => {
      try {
        const res = await fetch(`${API}/auth/forgot-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        const data = await res.json();
        if (!res.ok) return { success: false, error: data.error || 'Request failed' };
        return { success: true };
      } catch {
        return { success: false, error: 'Network error' };
      }
    },

    resetPassword: async (token, password) => {
      try {
        const res = await fetch(`${API}/auth/reset-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, password }),
        });
        const data = await res.json();
        if (!res.ok) return { success: false, error: data.error || 'Reset failed' };
        return { success: true };
      } catch {
        return { success: false, error: 'Network error' };
      }
    },

    updateProfile: async (data) => {
      set({ loading: true });
      try {
        const res = await fetch(`${API}/auth/profile`, {
          method: 'PUT',
          headers: getAuthHeaders(),
          body: JSON.stringify(data),
        });
        const resData = await res.json();
        set({ loading: false });
        if (!res.ok) return { success: false, error: resData.error || 'Update failed' };
        localStorage.setItem('locallink_user', JSON.stringify(resData));
        set({ currentUser: resData });
        return { success: true };
      } catch {
        set({ loading: false });
        return { success: false, error: 'Network error' };
      }
    },

    logout: () => {
      localStorage.removeItem('locallink_user');
      localStorage.removeItem('locallink_token');
      set({ isLoggedIn: false, currentUser: null });
    },

    loadUser: () => {
      const savedUser = localStorage.getItem('locallink_user');
      if (savedUser) {
        set({ isLoggedIn: true, currentUser: JSON.parse(savedUser) });
      }
    },
  };
});

// ===== Opportunities Store =====
interface OpportunitiesState {
  opportunities: Opportunity[];
  searchQuery: string;
  currentCategory: Category | 'all';
  sortBy: 'newest' | 'oldest' | 'soonest' | 'popular';
  loading: boolean;
  loaded: boolean;
  setSearchQuery: (q: string) => void;
  setCategory: (cat: Category | 'all') => void;
  setSortBy: (sort: 'newest' | 'oldest' | 'soonest' | 'popular') => void;
  getFiltered: () => Opportunity[];
  fetchOpportunities: () => Promise<void>;
  addOpportunity: (opp: Omit<Opportunity, 'id' | 'createdAt' | 'signups' | 'popularity'>) => Promise<Opportunity | null>;
  updateOpportunity: (oppId: string, data: Partial<Omit<Opportunity, 'id' | 'createdAt' | 'signups' | 'popularity' | 'hostId' | 'hostName'>>) => Promise<boolean>;
  deleteOwnOpportunity: (oppId: string) => Promise<boolean>;
  signup: (oppId: string, userId: string) => Promise<boolean>;
  cancelSignup: (oppId: string, userId: string) => Promise<boolean>;
  getSignedUpEvents: (userId: string) => Opportunity[];
  getHostedEvents: (userId: string) => Opportunity[];
}

export const useOpportunitiesStore = create<OpportunitiesState>((set, get) => ({
  opportunities: [],
  searchQuery: '',
  currentCategory: 'all',
  sortBy: 'newest',
  loading: false,
  loaded: false,

  setSearchQuery: (q) => set({ searchQuery: q }),
  setCategory: (cat) => set({ currentCategory: cat }),
  setSortBy: (sort) => set({ sortBy: sort }),

  getFiltered: () => {
    const { opportunities, currentCategory, searchQuery, sortBy } = get();
    let filtered = [...opportunities];

    if (currentCategory !== 'all') {
      filtered = filtered.filter(opp => opp.category === currentCategory);
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(opp =>
        opp.title.toLowerCase().includes(query) ||
        opp.description.toLowerCase().includes(query) ||
        opp.location.toLowerCase().includes(query)
      );
    }

    // Apply sort
    if (sortBy === 'newest') {
      filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    } else if (sortBy === 'oldest') {
      filtered.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    } else if (sortBy === 'soonest') {
      filtered.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    } else if (sortBy === 'popular') {
      filtered.sort((a, b) => b.popularity - a.popularity);
    }

    // Sort order: open future → closed future → past
    // Recurring posts never enter the "past" bucket — their open/closed state
    // is computed dynamically from the current time vs. their weekly schedule.
    const now = new Date();

    const effectiveIsOpen = (o: Opportunity): boolean => {
      if (o.isRecurring) {
        const status = getRecurringStatus(o);
        return status ? status.isOpen : true;
      }
      return o.isAvailable !== false && o.isAvailable !== 0;
    };

    const future = filtered.filter(o => o.isRecurring || new Date(o.date) >= now);
    const past   = filtered.filter(o => !o.isRecurring && new Date(o.date) < now);
    const futureOpen   = future.filter(o =>  effectiveIsOpen(o));
    const futureClosed = future.filter(o => !effectiveIsOpen(o));
    return [...futureOpen, ...futureClosed, ...past];
  },

  fetchOpportunities: async () => {
    if (get().loaded) return;
    set({ loading: true });
    try {
      const res = await fetch(`${API}/opportunities`);
      if (res.ok) {
        const data = await res.json();
        set({ opportunities: data, loading: false, loaded: true });
      } else {
        set({ loading: false });
      }
    } catch {
      set({ loading: false });
    }
  },

  addOpportunity: async (opp) => {
    try {
      const res = await fetch(`${API}/opportunities`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(opp),
      });
      if (res.ok) {
        const newOpp = await res.json();
        set((s) => ({ opportunities: [newOpp, ...s.opportunities] }));
        return newOpp;
      }
      return null;
    } catch {
      return null;
    }
  },

  updateOpportunity: async (oppId, data) => {
    try {
      const res = await fetch(`${API}/opportunities/${oppId}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify(data),
      });
      if (res.ok) {
        const updated = await res.json();
        set((s) => ({
          opportunities: s.opportunities.map(o => o.id === oppId ? updated : o),
        }));
        return true;
      }
      // 401 = session expired — log the user out so the login screen reappears
      if (res.status === 401) useAuthStore.getState().logout();
      return false;
    } catch {
      return false;
    }
  },

  deleteOwnOpportunity: async (oppId) => {
    try {
      const res = await fetch(`${API}/opportunities/${oppId}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        set((s) => ({
          opportunities: s.opportunities.filter(o => o.id !== oppId),
        }));
        return true;
      }
      // 401 = session expired — log the user out so the login screen reappears
      if (res.status === 401) useAuthStore.getState().logout();
      return false;
    } catch {
      return false;
    }
  },

  // userId is kept in the signature for compatibility but the server now reads identity from JWT
  signup: async (oppId, _userId) => {
    try {
      const res = await fetch(`${API}/opportunities/${oppId}/signup`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({}),
      });
      if (res.ok) {
        const updated = await res.json();
        set((s) => ({
          opportunities: s.opportunities.map(o => o.id === oppId ? updated : o),
        }));
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  cancelSignup: async (oppId, _userId) => {
    try {
      const res = await fetch(`${API}/opportunities/${oppId}/signup`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        const updated = await res.json();
        set((s) => ({
          opportunities: s.opportunities.map(o => o.id === oppId ? updated : o),
        }));
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  getSignedUpEvents: (userId) => {
    return get().opportunities.filter(o => o.signups.includes(userId));
  },

  getHostedEvents: (userId) => {
    return get().opportunities.filter(o => o.hostId === userId);
  },
}));

// ===== Admin Store =====
// adminUserId params are kept for backwards compatibility but no longer sent in requests.
// The server reads admin identity from the JWT Authorization header instead.
interface AdminStats {
  totalUsers: number;
  totalOpps: number;
  totalSignups: number;
}

interface AdminState {
  users: AppUser[];
  stats: AdminStats | null;
  loading: boolean;
  fetchUsers: (adminUserId: string) => Promise<void>;
  fetchStats: (adminUserId: string) => Promise<void>;
  deleteUser: (adminUserId: string, userId: string) => Promise<boolean>;
  deleteOpportunity: (adminUserId: string, oppId: string, reason?: string) => Promise<boolean>;
  updateOpportunity: (adminUserId: string, oppId: string, data: Record<string, any>, reason?: string) => Promise<boolean>;
  banUser: (userId: string) => Promise<boolean>;
  unbanUser: (userId: string) => Promise<boolean>;
}

export const useAdminStore = create<AdminState>((set) => ({
  users: [],
  stats: null,
  loading: false,

  fetchUsers: async (_adminUserId) => {
    set({ loading: true });
    try {
      const res = await fetch(`${API}/admin/users`, {
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        set({ users: data, loading: false });
      } else {
        set({ loading: false });
      }
    } catch {
      set({ loading: false });
    }
  },

  fetchStats: async (_adminUserId) => {
    try {
      const res = await fetch(`${API}/admin/stats`, {
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        set({ stats: data });
      }
    } catch { /* ignore */ }
  },

  deleteUser: async (_adminUserId, userId) => {
    try {
      const res = await fetch(`${API}/admin/users/${userId}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        set(s => ({ users: s.users.filter(u => u.id !== userId) }));
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  deleteOpportunity: async (_adminUserId, oppId, reason) => {
    try {
      const res = await fetch(`${API}/admin/opportunities/${oppId}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
        body: JSON.stringify({ reason: reason ?? '' }),
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  updateOpportunity: async (_adminUserId, oppId, data, reason) => {
    try {
      const res = await fetch(`${API}/admin/opportunities/${oppId}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ ...data, adminReason: reason ?? '' }),
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  banUser: async (userId) => {
    try {
      const res = await fetch(`${API}/admin/users/${userId}/ban`, { method: 'POST', headers: getAuthHeaders() });
      if (res.ok) {
        set(s => ({ users: s.users.map(u => u.id === userId ? { ...u, banned: true } : u) }));
        return true;
      }
      return false;
    } catch { return false; }
  },

  unbanUser: async (userId) => {
    try {
      const res = await fetch(`${API}/admin/users/${userId}/unban`, { method: 'POST', headers: getAuthHeaders() });
      if (res.ok) {
        set(s => ({ users: s.users.map(u => u.id === userId ? { ...u, banned: false } : u) }));
        return true;
      }
      return false;
    } catch { return false; }
  },
}));

// ===== Favorites Store =====
interface FavoritesState {
  favorites: AppUser[];
  loaded: boolean;
  fetchFavorites: () => Promise<void>;
  addFavorite: (orgId: string) => Promise<boolean>;
  removeFavorite: (orgId: string) => Promise<boolean>;
  isFavorited: (orgId: string) => boolean;
}

export const useFavoritesStore = create<FavoritesState>((set, get) => ({
  favorites: [],
  loaded: false,

  fetchFavorites: async () => {
    try {
      const res = await fetch(`${API}/favorites`, { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        set({ favorites: data, loaded: true });
      }
    } catch { /* ignore */ }
  },

  addFavorite: async (orgId) => {
    // Optimistic update: add stub immediately so the heart turns red at once
    set(s => ({ favorites: [...s.favorites, { id: orgId } as AppUser] }));
    try {
      const res = await fetch(`${API}/favorites/${orgId}`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        // No re-fetch needed — the stub id is enough for isFavorited() to stay true.
        // The full user object syncs next time fetchFavorites() runs (e.g. profile page).
        return true;
      }
      // Rollback only on genuine server failure
      set(s => ({ favorites: s.favorites.filter(f => f.id !== orgId) }));
      return false;
    } catch {
      set(s => ({ favorites: s.favorites.filter(f => f.id !== orgId) }));
      return false;
    }
  },

  removeFavorite: async (orgId) => {
    try {
      const res = await fetch(`${API}/favorites/${orgId}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        set(s => ({ favorites: s.favorites.filter(f => f.id !== orgId) }));
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  isFavorited: (orgId) => {
    return get().favorites.some(f => f.id === orgId);
  },
}));

// ===== Notification Store =====
export interface AppNotification {
  id: string;
  userId: string;
  type: 'interest' | 'cancel' | 'admin_delete' | 'admin_edit';
  message: string;
  postId: string | null;
  read: boolean;
  createdAt: string;
}

interface NotificationState {
  notifications: AppNotification[];
  unreadCount: number;
  fetchNotifications: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  unreadCount: 0,

  fetchNotifications: async () => {
    try {
      const res = await fetch(`${API}/notifications`, { headers: getAuthHeaders() });
      if (res.ok) {
        const data: AppNotification[] = await res.json();
        set({ notifications: data, unreadCount: data.filter(n => !n.read).length });
      }
    } catch { /* ignore */ }
  },

  markRead: async (id) => {
    await fetch(`${API}/notifications/${id}/read`, { method: 'POST', headers: getAuthHeaders() });
    set(s => {
      const notifications = s.notifications.map(n => n.id === id ? { ...n, read: true } : n);
      return { notifications, unreadCount: notifications.filter(n => !n.read).length };
    });
  },

  markAllRead: async () => {
    await fetch(`${API}/notifications/read-all`, { method: 'POST', headers: getAuthHeaders() });
    set(s => ({
      notifications: s.notifications.map(n => ({ ...n, read: true })),
      unreadCount: 0,
    }));
  },
}));

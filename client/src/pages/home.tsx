import { useState, useEffect, useRef } from 'react';
import { useLocation } from 'wouter';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { cn, getLocationError, getExternalSignupUrlError, getRelativeDay } from '@/lib/utils';
import { Plus, MapPin, Users, Clock, Search, Loader2, Heart, Flag, X, Share2, Edit3, Save, ChevronDown, Star, Trash2, Repeat, Globe, ExternalLink, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useModalA11y } from '@/hooks/use-modal-a11y';
import { getCardSize, isLargeCard, getTitleSize } from '@/lib/cardUtils';
import { getCategoryColor, getModalGradient, getCategoryBorder, getCategoryLabel, countInterestMatches } from '@/lib/categoryUtils';
import { useAuthStore, useOpportunitiesStore, useFavoritesStore, getRecurringStatus } from '@/lib/store';
import { CATEGORIES, TOWNS, type Category, type Opportunity } from '@/lib/mockData';
import CreatePostModal from '@/components/CreatePostModal';
import ConfirmBubble from '@/components/ConfirmBubble';
import { useScrolled } from '@/hooks/use-scrolled';
import { VerifiedBadge } from '@/components/VerifiedBadge';
import CropEditor, {
  type ImageTransform,
  DEFAULT_TRANSFORM,
  parseImageTransform,
  serializeImageTransform,
  imageTransformStyle,
} from '@/components/CropEditor';

// Module-level cache so host profile images survive re-renders and modal re-opens
const hostProfileCache = new Map<string, { profileImage: string | null; orgWebsite: string | null }>();

const SORT_OPTIONS: { value: 'newest' | 'oldest' | 'soonest' | 'popular' | 'match'; label: string }[] = [
  { value: 'newest',  label: 'Newest' },
  { value: 'oldest',  label: 'Oldest' },
  { value: 'soonest', label: 'Soonest' },
  { value: 'popular', label: 'Popular' },
  // Only offered to someone who has actually stated interests -- see the
  // filter at the render site. An empty "For you" would be a worse experience
  // than not offering it.
  { value: 'match',   label: 'For you' },
];

// Easing curve used throughout — smooth deceleration
const EASE_OUT = [0.25, 0.1, 0.25, 1] as const;

// Shown twice: to signed-out visitors under the hero, and once more as a welcome
// to anyone who has just registered. Previously only signed-out visitors ever saw
// it, so the explanation reached people who hadn't joined and was hidden from the
// person who just did.
const VOLUNTEER_STEPS = [
  { n: 1, t: 'Browse the board', d: 'Real events from Somerset County orgs' },
  { n: 2, t: 'Tap I’m Interested', d: 'One click — the org gets notified' },
  { n: 3, t: 'Show up & help', d: 'Coordinate the details directly with them' },
];

const ORG_STEPS = [
  { n: 1, t: 'Post an opportunity', d: 'An admin reviews it before it goes live' },
  { n: 2, t: 'See who’s interested', d: 'Everyone who taps in appears on your list' },
  { n: 3, t: 'Reach out directly', d: 'Their name and email are right there' },
];

// Fixed spark layout for the "I'm Interested" burst — perimeter points with an
// outward direction each, so the effect reads as sparks leaving the button's
// edges rather than a generic radial explosion. Deterministic (no per-render
// randomness) so the animation is identical and testable every time it fires.
const INTEREST_BURST_SPARKS = [
  { left: '4%',  top: '15%',  dx: -20, dy: -16 },
  { left: '18%', top: '0%',   dx: -12, dy: -24 },
  { left: '38%', top: '0%',   dx: -2,  dy: -26 },
  { left: '62%', top: '0%',   dx: 2,   dy: -26 },
  { left: '82%', top: '0%',   dx: 12,  dy: -24 },
  { left: '96%', top: '15%',  dx: 20,  dy: -16 },
  { left: '96%', top: '85%',  dx: 20,  dy: 16 },
  { left: '82%', top: '100%', dx: 12,  dy: 24 },
  { left: '62%', top: '100%', dx: 2,   dy: 26 },
  { left: '38%', top: '100%', dx: -2,  dy: 26 },
  { left: '18%', top: '100%', dx: -12, dy: 24 },
  { left: '4%',  top: '85%',  dx: -20, dy: 16 },
] as const;

/** One-shot spark burst from a button's edges. Mount to fire, unmount to reset —
 * it never loops. Caller is responsible for skipping this entirely when
 * prefers-reduced-motion is set; the state change it accompanies still happens either way. */
function InterestBurst() {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-visible" aria-hidden="true">
      {INTEREST_BURST_SPARKS.map((s, i) => (
        <motion.span
          key={i}
          initial={{ opacity: 1, scale: 0.4, x: 0, y: 0 }}
          animate={{ opacity: 0, scale: 1, x: s.dx, y: s.dy }}
          transition={{ duration: 0.5, delay: (i % 4) * 0.02, ease: 'easeOut' }}
          className="absolute w-1.5 h-1.5 rounded-full bg-white shadow-[0_0_6px_2px_rgba(255,255,255,0.8)]"
          style={{ left: s.left, top: s.top }}
        />
      ))}
    </div>
  );
}

export default function Home() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { isLoggedIn, currentUser, markWelcomeSeen } = useAuthStore();
  // Read back what the onboarding questionnaire collected. Organizations never
  // answer it, so this stays empty for them and every match count falls to 0.
  const myInterests = currentUser?.onboardingInterests ?? null;
  const {
    setSearchQuery, setCategory, setSortBy, setTown, getFiltered,
    currentCategory, searchQuery, sortBy, currentTown,
    signup, cancelSignup, fetchOpportunities, updateOpportunity,
    loading, loaded, opportunities,
  } = useOpportunitiesStore();
  // Destructure `favorites` array directly so React re-renders when it changes
  const { favorites, fetchFavorites, addFavorite, removeFavorite } = useFavoritesStore();
  const isFavorited = (orgId: string) => favorites.some(f => f.id === orgId);

  // Card / modal state
  const [selectedCard, setSelectedCard] = useState<Opportunity | null>(null);
  const [hostProfile, setHostProfile] = useState<{ profileImage: string | null; orgWebsite: string | null } | null>(null);
  const [hostProfileLoading, setHostProfileLoading] = useState(false);
  const [signingUp, setSigningUp] = useState(false);
  const [showInterestBurst, setShowInterestBurst] = useState(false);
  const prefersReducedMotion = useReducedMotion();
  // Host "view interested" list — fetched on demand, not preloaded with the board
  const [showInterestedList, setShowInterestedList] = useState(false);
  const [interestedVolunteers, setInterestedVolunteers] = useState<
    { username: string; email: string; signedUpAt: string }[] | null
  >(null);
  const [interestedLoading, setInterestedLoading] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [togglingFav, setTogglingFav] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [reportNote, setReportNote] = useState('');
  const [submittingReport, setSubmittingReport] = useState(false);
  // Edit post state
  const [showEditForm, setShowEditForm] = useState(false);
  const [showDiscardEdits, setShowDiscardEdits] = useState(false);
  // Collapsed by default, and reset per post -- expanding one shouldn't leave
  // the next one you open already unrolled.
  const [stepsExpanded, setStepsExpanded] = useState(false);
  const scrolled = useScrolled();
  // Signed-out visitors still see the Create Post strip (it prompts sign-up);
  // signed-in volunteers don't, because for them it goes nowhere.
  const canPost = !isLoggedIn || !!currentUser?.isAdmin || currentUser?.accountType === 'organization';
  const isOrgAccount = currentUser?.accountType === 'organization';
  const [editForm, setEditForm] = useState<{
    title: string; description: string; location: string; town: string; date: string;
    duration: number; spots: number; category: Category;
    spotsType: 'limited' | 'unlimited' | 'none';
    recurringDay?: number; recurringTime?: string;
    cardTransform: ImageTransform;
    modalTransform: ImageTransform;
    externalSignupUrl: string;
  }>({
    title: '', description: '', location: '', town: '', date: '', duration: 2, spots: 0,
    category: 'volunteer',
    spotsType: 'none',
    cardTransform: DEFAULT_TRANSFORM,
    modalTransform: DEFAULT_TRANSFORM,
    externalSignupUrl: '',
  });
  const [savingEdit, setSavingEdit] = useState(false);
  const [signupUrlEditError, setSignupUrlEditError] = useState('');
  const [showSort, setShowSort] = useState(false);

  // Bump this key whenever sort/category/search changes so cards re-animate entrance
  const [listKey, setListKey] = useState(0);
  const prevFilters = useRef({ sortBy, currentCategory });

  useEffect(() => { fetchOpportunities(); }, [fetchOpportunities]);
  useEffect(() => { if (isLoggedIn) fetchFavorites(); }, [isLoggedIn, fetchFavorites]);

  // Deep link: auto-open post from ?post=ID in URL
  useEffect(() => {
    if (!loaded) return;
    const params = new URLSearchParams(window.location.search);
    const postId = params.get('post');
    if (postId) {
      const opp = opportunities.find(o => o.id === postId);
      if (opp) setSelectedCard(opp);
      // Clean the URL without reloading
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [loaded, opportunities]);

  // Re-animate cards when sort or category changes
  useEffect(() => {
    const prev = prevFilters.current;
    if (prev.sortBy !== sortBy || prev.currentCategory !== currentCategory) {
      setListKey(k => k + 1);
      prevFilters.current = { sortBy, currentCategory };
    }
  }, [sortBy, currentCategory]);

  // Debounce search re-animation so it doesn't fire on every keystroke
  useEffect(() => {
    const t = setTimeout(() => setListKey(k => k + 1), 350);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // Fetch host profile image when a card modal opens — public endpoint, no auth needed.
  // Results are cached in hostProfileCache so re-opening the same post is instant.
  useEffect(() => {
    if (!selectedCard) { setHostProfile(null); return; }
    const cached = hostProfileCache.get(selectedCard.hostId);
    if (cached) { setHostProfile(cached); return; }
    setHostProfileLoading(true);
    fetch(`/api/users/${selectedCard.hostId}/profile`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        const profile = data
          ? { profileImage: data.profileImage || null, orgWebsite: data.orgWebsite || null }
          : { profileImage: null, orgWebsite: null };
        hostProfileCache.set(selectedCard.hostId, profile);
        setHostProfile(profile);
      })
      .catch(() => setHostProfile(null))
      .finally(() => setHostProfileLoading(false));
  }, [selectedCard?.hostId]);

  const filteredOpportunities = getFiltered();

  // Host avatars for board cards — one profile fetch per unique host,
  // shared with the modal via the same module-level hostProfileCache.
  const [hostAvatars, setHostAvatars] = useState<Record<string, string | null>>({});
  useEffect(() => {
    const ids = Array.from(new Set(opportunities.map(o => o.hostId))).filter(id => !(id in hostAvatars));
    if (ids.length === 0) return;
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(ids.map(async (id): Promise<readonly [string, string | null]> => {
        const cached = hostProfileCache.get(id);
        if (cached) return [id, cached.profileImage] as const;
        try {
          const r = await fetch(`/api/users/${id}/profile`);
          if (!r.ok) return [id, null] as const;
          const d = await r.json();
          const img = d.profileImage || null;
          // Same shape the modal expects — a board prefetch must not poison the
          // cache with a half-filled entry that then hides the website link.
          hostProfileCache.set(id, { profileImage: img, orgWebsite: d.orgWebsite || null });
          return [id, img] as const;
        } catch { return [id, null] as const; }
      }));
      if (!cancelled) setHostAvatars(prev => ({ ...prev, ...Object.fromEntries(entries) }));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opportunities]);

  // Featured banner: admin-curated only. The /api/featured-posts endpoint
  // falls back to top-popularity posts when nothing is featured, so filter
  // the already-loaded feed on isFeatured instead of consuming it — no
  // featured post means no banner. Most recent wins; never stack banners.
  const featuredPost = opportunities
    .filter(o => !!o.isFeatured)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] ?? null;

  // ── Helpers ────────────────────────────────────────────────────────
  const formatDate = (d: string) => new Date(d).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const formatTime = (d: string) => new Date(d).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const isInterested = (opp: Opportunity) => currentUser ? opp.signups.includes(currentUser.id) : false;

  const DAY_FULL  = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const formatRecurringTime = (time: string) => {
    const [h, m] = time.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    return `${h % 12 || 12}:${m.toString().padStart(2, '0')} ${ampm}`;
  };
  // Text only — the repeat icon is rendered as an SVG alongside it at the call
  // sites, so this stays a plain string that can also be read aloud.
  const formatRecurringShort = (opp: Opportunity) => {
    const day = DAY_SHORT[opp.recurringDay ?? 0];
    if (!opp.recurringTime) return day;
    const [h, m] = opp.recurringTime.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hr = h % 12 || 12;
    const min = m === 0 ? '' : `:${m.toString().padStart(2, '0')}`;
    return `${day} ${hr}${min}${ampm}`;
  };

  // Returns capacity/availability string shown on cards (left side).
  // Interest never consumes a spot — spots are informational capacity hints only.
  const getAvailabilityDisplay = (opp: Opportunity) => {
    if (opp.spotsType === 'limited' && opp.spots > 0) return `~${opp.spots} spots`;
    if (opp.spotsType === 'unlimited') return 'Unlimited';
    return '';
  };

  // Always shows how many people have expressed interest — independent of spot count.
  const getInterestedDisplay = (opp: Opportunity) =>
    `${opp.signups.length} interested`;

  // ── Open create modal with guard ───────────────────────────────────
  const openCreateModal = () => {
    if (!isLoggedIn) {
      toast({ title: 'Please login first', description: 'You need to be logged in to create a post.' });
      navigate('/account');
      return;
    }
    if (!currentUser?.isAdmin && currentUser?.accountType !== 'organization') {
      // Points at a control that now actually exists (Profile -> "Post your own
      // opportunities"). The old copy said "update your account type in
      // settings" when no such setting existed anywhere.
      toast({
        title: 'Organization accounts only',
        description: 'Switch to an organization account on your profile to post opportunities.',
      });
      navigate('/profile');
      return;
    }
    setShowCreateModal(true);
  };

  // ── Sign up / cancel ──────────────────────────────────────────────
  const handleSignup = async (oppId: string) => {
    if (!isLoggedIn || !currentUser) {
      toast({ title: 'Please login first', description: 'You need to be logged in to express interest.' });
      navigate('/account');
      return;
    }
    setSigningUp(true);
    try {
      const result = await signup(oppId, currentUser.id);
      if (result.success) {
        toast({ title: "You're interested! ✓", description: 'You can view this in My Events.' });
        if (!prefersReducedMotion) {
          setShowInterestBurst(true);
          window.setTimeout(() => setShowInterestBurst(false), 600);
        }
        const fresh = useOpportunitiesStore.getState().opportunities.find(o => o.id === oppId);
        if (fresh) setSelectedCard(fresh); else setSelectedCard(null);
      } else {
        // The server's actual reason, when it gave one -- a 409 really does
        // mean "already interested", but that's not the only way this can
        // fail, and claiming it was regardless of the real cause is worse
        // than saying nothing.
        toast({ title: 'Could not register interest', description: result.error || 'Please try again.' });
      }
    } finally { setSigningUp(false); }
  };

  const handleCancelSignup = async (oppId: string) => {
    if (!currentUser) return;
    setSigningUp(true);
    try {
      await cancelSignup(oppId, currentUser.id);
      const fresh = useOpportunitiesStore.getState().opportunities.find(o => o.id === oppId);
      if (fresh) setSelectedCard(fresh); else setSelectedCard(null);
    } finally { setSigningUp(false); }
  };

  // ── Close modal — confirm if edit form has unsaved changes ────────
  const closeModalNow = () => {
    setSelectedCard(null); setShowReportModal(false); setReportReason(''); setReportNote(''); setShowEditForm(false);
    setShowInterestedList(false); setInterestedVolunteers(null); setShowInterestBurst(false);
    setShowDiscardEdits(false); setStepsExpanded(false);
  };

  const handleCloseModal = () => {
    if (showEditForm) setShowDiscardEdits(true);
    else closeModalNow();
  };

  // Escape, scroll lock, and focus in/out for the post modal. Routed through
  // handleCloseModal so Escape respects the unsaved-edits guard exactly as the
  // X and the backdrop already do.
  const cardModalRef = useModalA11y(!!selectedCard, handleCloseModal);

  // ── Host: view interested volunteers (fetched on demand, host-only server-side) ──
  const toggleInterestedList = async (oppId: string) => {
    if (showInterestedList) { setShowInterestedList(false); return; }
    setShowInterestedList(true);
    if (interestedVolunteers !== null) return; // already fetched for this card
    setInterestedLoading(true);
    try {
      const token = localStorage.getItem('locallink_token');
      const res = await fetch(`/api/opportunities/${oppId}/interested`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      setInterestedVolunteers(res.ok ? await res.json() : []);
    } catch {
      setInterestedVolunteers([]);
    } finally {
      setInterestedLoading(false);
    }
  };

  // ── Share post ────────────────────────────────────────────────────
  const handleShare = (oppId: string) => {
    const url = `${window.location.origin}/?post=${oppId}`;
    navigator.clipboard.writeText(url).then(() => {
      toast({ title: 'Link copied!', description: 'Share it with anyone to open this post directly.' });
    }).catch(() => {
      toast({ title: url, description: 'Copy this link to share the post.' });
    });
  };

  // ── Edit post (host only) ─────────────────────────────────────────
  const openEditForm = (opp: typeof selectedCard) => {
    if (!opp) return;
    setEditForm({
      title: opp.title,
      description: opp.description,
      location: opp.location,
      town: opp.town ?? '',
      date: opp.date,
      duration: opp.duration,
      spots: opp.spots || 0,
      category: opp.category as Category,
      spotsType: (opp.spotsType as 'limited' | 'unlimited' | 'none') || 'none',
      recurringDay: opp.recurringDay,
      recurringTime: opp.recurringTime,
      cardTransform: parseImageTransform(opp.cardObjectPosition),
      modalTransform: parseImageTransform(opp.modalObjectPosition),
      externalSignupUrl: opp.externalSignupUrl ?? '',
    });
    setSignupUrlEditError('');
    setShowEditForm(true);
  };

  const handleSaveEdit = async () => {
    if (!selectedCard) return;
    const locationError = getLocationError(editForm.location);
    if (locationError) {
      toast({ title: locationError, variant: 'destructive' });
      return;
    }
    const signupUrlError = getExternalSignupUrlError(editForm.externalSignupUrl);
    if (signupUrlError) {
      setSignupUrlEditError(signupUrlError);
      return;
    }
    setSavingEdit(true);
    // Build update payload — recurring events update day/time schedule; one-time events update date
    const payload: Record<string, any> = {
      title: editForm.title,
      description: editForm.description,
      location: editForm.location,
      town: editForm.town || null,
      duration: editForm.duration,
      spots: editForm.spots,
      category: editForm.category,
      spotsType: editForm.spotsType,
    };
    if (selectedCard.isRecurring) {
      if (editForm.recurringDay !== undefined) payload.recurringDay = editForm.recurringDay;
      if (editForm.recurringTime) payload.recurringTime = editForm.recurringTime;
    } else {
      payload.date = editForm.date;
    }
    payload.cardObjectPosition = serializeImageTransform(editForm.cardTransform);
    payload.modalObjectPosition = serializeImageTransform(editForm.modalTransform);
    payload.externalSignupUrl = editForm.externalSignupUrl.trim();
    const success = await updateOpportunity(selectedCard.id, payload as any);
    if (success) {
      // Refresh selected card from updated store
      const updated = useOpportunitiesStore.getState().opportunities.find(o => o.id === selectedCard.id);
      if (updated) setSelectedCard(updated);
      setShowEditForm(false);
      toast({ title: 'Post updated!' });
    } else {
      toast({ title: 'Failed to update post', variant: 'destructive' });
    }
    setSavingEdit(false);
  };

  // ── Report post ───────────────────────────────────────────────────
  const handleReport = async () => {
    if (!selectedCard || !reportReason) return;
    setSubmittingReport(true);
    try {
      const token = localStorage.getItem('locallink_token');
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ postId: selectedCard.id, reason: reportReason, note: reportNote }),
      });
      if (res.ok) {
        toast({ title: 'Report submitted', description: 'Thank you — our team will review this post.' });
        setShowReportModal(false);
        setReportReason('');
        setReportNote('');
      } else {
        const data = await res.json();
        toast({ title: 'Could not submit report', description: data.error || 'Please try again.', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Network error', variant: 'destructive' });
    }
    setSubmittingReport(false);
  };

  // ── Favorite toggle ────────────────────────────────────────────────
  const handleFavToggle = async (orgId: string) => {
    if (!isLoggedIn) {
      toast({ title: 'Please login first' });
      return;
    }
    setTogglingFav(true);
    if (isFavorited(orgId)) {
      await removeFavorite(orgId);
      toast({ title: 'Removed from favorites' });
    } else {
      await addFavorite(orgId);
      toast({ title: 'Added to favorites ♥' });
    }
    setTogglingFav(false);
  };

  return (
    <div className="min-h-screen bg-background pb-24 font-sans">

      {/* Search & Filters */}
      {/* Pinned directly under the header, which condenses 64px -> 52px on
          scroll. This must track that exactly or a gap opens above the pills. */}
      <div className={cn(
        "sticky z-40 bg-background border-b border-border/40 transition-[top] duration-200 ease-out",
        scrolled ? "top-[52px]" : "top-16"
      )}>
        <div className={cn(
          "container mx-auto px-4 transition-[padding,row-gap] duration-200 ease-out",
          scrolled ? "py-2 space-y-2" : "py-3 space-y-3"
        )}>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search opportunities..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={cn(
                "pl-10 rounded-md border-border bg-secondary/50 transition-[height] duration-200 ease-out",
                scrolled ? "h-9" : "h-10"
              )}
            />
          </div>
          <div className="overflow-hidden transition-all duration-300"
            style={{ opacity: selectedCard ? 0 : 1, height: selectedCard ? 0 : 'auto', pointerEvents: selectedCard ? 'none' : 'auto' }}>
            {/* Category pills — the filled background is one shared element that
                travels between pills (layoutId) rather than a class that blinks
                from one to the next. MotionConfig already makes this respect
                prefers-reduced-motion, so no per-component guard is needed. */}
            <div className="flex items-center gap-2 flex-wrap mb-2">
              {CATEGORIES.map(cat => {
                const active = currentCategory === cat.value;
                return (
                  <button key={cat.value} onClick={() => setCategory(cat.value as Category | 'all')}
                    aria-pressed={active}
                    className={cn(
                      "relative px-4 py-2 rounded-md text-sm font-medium border transition-colors duration-150",
                      active
                        ? "text-background border-transparent"
                        : "bg-background text-foreground border-border hover:border-foreground/50")}>
                    {active && (
                      <motion.span
                        layoutId="categoryPill"
                        // Same reason as the nav underline: the filter bar's
                        // padding and search height shrink on scroll, and without
                        // this the indicator animates that drift too.
                        layoutDependency={currentCategory}
                        className="absolute inset-0 rounded-md bg-foreground"
                        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                      />
                    )}
                    <span className="relative z-10">{cat.label}</span>
                  </button>
                );
              })}
            </div>
            {/* Sort toggle + town filter + pills */}
            <div>
              <div className="flex items-center gap-4 flex-wrap mb-1.5">
                {/* min-h-[44px] on these: as inline text they were 16-17px tall,
                    well under the 44px tap minimum on a phone. */}
                <button
                  onClick={() => setShowSort(s => !s)}
                  aria-expanded={showSort}
                  className="min-h-[44px] flex items-center gap-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide hover:text-foreground transition-colors">
                  <span>Sort: {SORT_OPTIONS.find(o => o.value === sortBy)?.label}</span>
                  <ChevronDown className={cn("w-3.5 h-3.5 transition-transform duration-200", showSort && "rotate-180")} />
                </button>
                <label htmlFor="home-field" className="min-h-[44px] flex items-center gap-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide cursor-pointer hover:text-foreground transition-colors">
                  <span>Town:</span>
                  <select id="home-field"
                    value={currentTown}
                    onChange={e => setTown(e.target.value)}
                    aria-label="Filter by town"
                    className="min-h-[44px] bg-transparent text-xs font-semibold uppercase tracking-wide cursor-pointer focus:outline-none max-w-[150px]">
                    <option value="all">All towns</option>
                    {TOWNS.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </label>
              </div>
              <div className={cn(
                "overflow-hidden transition-all duration-300 ease-in-out",
                showSort ? "max-h-20 opacity-100" : "max-h-0 opacity-0 pointer-events-none"
              )}>
                <div className="flex items-center gap-2 flex-wrap pb-1">
                  {SORT_OPTIONS.filter(o => o.value !== 'match' || (myInterests && myInterests.length > 0)).map(opt => (
                    <button key={opt.value} onClick={() => { setSortBy(opt.value); setShowSort(false); }}
                      className={cn("px-3 min-h-[38px] rounded-md text-xs font-semibold transition-all border",
                        sortBy === opt.value
                          ? "bg-foreground text-background border-foreground"
                          : "bg-background text-foreground border-border hover:border-foreground/50")}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Grid */}
      <main className="container mx-auto px-4 py-8">
        {/* Logged-out hero + how-it-works — not rendered at all once authenticated */}
        {!isLoggedIn && (
          <>
            {/* The hero is the one surface carrying weight — a faint wash toward
                the brand blue, larger type, room to breathe. Everything below it
                stays quiet so the page has an order to read in. */}
            <section className="mb-10 rounded-3xl border border-border/60 bg-secondary/40 px-6 py-10 md:px-12 md:py-14">
              <h1 className="font-heading font-bold text-3xl md:text-5xl text-foreground leading-[1.08] tracking-tight max-w-3xl text-balance">
                Find local volunteer opportunities in Somerset County
              </h1>
              <p className="text-muted-foreground text-base md:text-lg mt-4 max-w-xl leading-relaxed">
                Real organizations, real events, right where you live.
              </p>
              <Button onClick={() => navigate('/account')} className="mt-7 rounded-md px-8 h-12 font-semibold">
                Sign up free
              </Button>
            </section>
            {/* Deliberately unboxed: a hairline rule groups the steps without
                adding a third container competing with the hero. */}
            <div className="mb-10 border-t border-border pt-7 grid grid-cols-1 md:grid-cols-3 gap-7">
              {VOLUNTEER_STEPS.map(s => (
                <div key={s.n} className="flex items-start gap-3.5">
                  <div className="w-8 h-8 rounded-full bg-primary/10 text-primary text-sm font-bold flex items-center justify-center flex-shrink-0 tabular-nums">{s.n}</div>
                  <div>
                    <p className="font-semibold text-sm text-foreground">{s.t}</p>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{s.d}</p>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* First run. hasSeenWelcome, the endpoint and the store action all
            already existed server-side; nothing ever rendered them, so a new
            account landed on a bare board with no orientation at all. */}
        {isLoggedIn && currentUser && !currentUser.hasSeenWelcome && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: EASE_OUT }}
            className="mb-8 rounded-3xl border border-primary/25 bg-primary/[0.04] px-6 py-5 relative">
            <button
              onClick={() => markWelcomeSeen()}
              aria-label="Dismiss welcome"
              className="absolute top-3 right-3 w-9 h-9 flex items-center justify-center rounded-full text-muted-foreground hover:bg-secondary transition-colors">
              <X className="w-4 h-4" />
            </button>
            <p className="font-heading font-bold text-lg text-foreground pr-10">
              Welcome, {currentUser.username}
            </p>
            <p className="text-sm text-muted-foreground mt-0.5 mb-5">
              {isOrgAccount ? "Here's how posting works." : "Here's how it works."}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {(isOrgAccount ? ORG_STEPS : VOLUNTEER_STEPS).map(s => (
                <div key={s.n} className="flex items-start gap-3.5">
                  <div className="w-8 h-8 rounded-full bg-primary/10 text-primary text-sm font-bold flex items-center justify-center flex-shrink-0 tabular-nums">{s.n}</div>
                  <div>
                    <p className="font-semibold text-sm text-foreground">{s.t}</p>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{s.d}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-5 flex items-center gap-4">
              <button
                onClick={() => markWelcomeSeen()}
                className="text-xs font-semibold text-primary hover:underline">
                Got it
              </button>
              {/* No "Full instructions" link any more: it pointed at
                  /how-it-works, which this build doesn't have, so it landed on
                  the NotFound page. The three steps above are the explanation. */}
            </div>
          </motion.div>
        )}

        {loading && !loaded && (
          <>
          <div className="mb-2 h-16 md:h-20 rounded-3xl border-2 border-dashed border-border/30 bg-secondary/20 animate-pulse" />
          <div className="grid grid-cols-1 md:grid-cols-4 gap-2 auto-rows-[200px] grid-flow-dense mb-12">
            {['md:col-span-2 md:row-span-2','md:col-span-2 md:row-span-1','md:col-span-1 md:row-span-1','md:col-span-1 md:row-span-1','md:col-span-2 md:row-span-1','md:col-span-1 md:row-span-1'].map((size, i) => (
              <div key={i} className={cn("rounded-3xl bg-secondary/30 animate-pulse", size)}>
                <div className="h-full p-6 flex flex-col justify-between">
                  <div className="space-y-2">
                    <div className="h-3 w-16 bg-muted-foreground/10 rounded-full" />
                    <div className="h-5 w-3/4 bg-muted-foreground/10 rounded-full" />
                  </div>
                </div>
              </div>
            ))}
          </div>
          </>
        )}

        {(!loading || loaded) && (
          <>
            {/* Featured banner — one admin-featured post, full grid width (the
                1x4 slot), horizontal on desktop, stacked on mobile. Opens the
                same modal as any card. Absent entirely when nothing is featured. */}
            {featuredPost && (() => {
              const rs = !!featuredPost.isRecurring ? getRecurringStatus(featuredPost) : null;
              const isPast = rs ? false : new Date(featuredPost.date) < new Date();
              const manualClosed = featuredPost.isAvailable === false || (featuredPost.isAvailable as any) === 0;
              const isClosed = manualClosed || (rs ? !rs.isOpen : false);
              return (
                <motion.div
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: isPast ? 0.5 : isClosed ? 0.6 : 1, y: 0 }}
                  transition={{ duration: 0.38, ease: EASE_OUT }}
                  whileHover={{ y: -4, transition: { duration: 0.18, ease: 'easeOut' } }}
                  whileTap={{ scale: 0.98, transition: { duration: 0.1 } }}
                  onClick={() => setSelectedCard(featuredPost)}
                  className={cn(
                    "group relative mb-2 rounded-3xl overflow-hidden cursor-pointer border-[6px] shadow-sm hover:shadow-md transition-shadow duration-300 md:h-[200px]",
                    getCategoryBorder(featuredPost.category),
                    (isPast || isClosed) && "grayscale"
                  )}>
                  <div className={cn("absolute inset-0", getCategoryColor(featuredPost.category))} />
                  <div className="relative z-10 flex flex-col md:flex-row md:h-full text-white">
                    {featuredPost.image && (
                      <div className="relative h-24 md:h-full md:w-2/5 flex-shrink-0 overflow-hidden">
                        <img src={featuredPost.image} alt={featuredPost.title} className="w-full h-full" style={imageTransformStyle(parseImageTransform(featuredPost.cardObjectPosition))} />
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent to-black/20" />
                      </div>
                    )}
                    <div className="flex-1 px-4 py-3 md:p-6 flex flex-col justify-center gap-1.5 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] font-bold bg-white/25 text-white px-2 py-0.5 rounded-md inline-flex items-center gap-1">
                          <Star className="w-3 h-3 fill-current" /> FEATURED
                        </span>
                        <p className="text-xs font-bold tracking-widest uppercase opacity-80">{getCategoryLabel(featuredPost.category)}</p>
                        {!!featuredPost.isRecurring && <span className="text-[10px] font-bold bg-blue-500/80 text-white px-2 py-0.5 rounded-md inline-flex items-center gap-1"><Repeat className="w-2.5 h-2.5" />{formatRecurringShort(featuredPost)}</span>}
                        {isPast && !featuredPost.isRecurring && <span className="text-[10px] font-bold bg-white/20 text-white px-2 py-0.5 rounded-md">ENDED</span>}
                        {isClosed && !!featuredPost.isRecurring && <span className="text-[10px] font-bold bg-orange-500/80 text-white px-2 py-0.5 rounded-md">CLOSED</span>}
                      </div>
                      <h2 className="font-heading font-bold text-lg md:text-2xl leading-tight">{featuredPost.title}</h2>
                      <div className="flex items-center gap-2 text-sm opacity-90 flex-wrap">
                        <span className="inline-flex items-center gap-1.5">
                          {hostAvatars[featuredPost.hostId] ? (
                            <img src={hostAvatars[featuredPost.hostId]!} alt="" className="w-5 h-5 rounded-full object-cover ring-1 ring-white/40" />
                          ) : (
                            <span className="w-5 h-5 rounded-full bg-white/25 flex items-center justify-center text-[9px] font-bold">{featuredPost.hostName.charAt(0).toUpperCase()}</span>
                          )}
                          by {featuredPost.hostName}
                          {!!featuredPost.hostVerified && <VerifiedBadge className="w-3.5 h-3.5" />}
                        </span>
                        {!featuredPost.isRecurring && <span>· {formatDate(featuredPost.date)}</span>}
                      </div>
                    </div>
                  </div>
                </motion.div>
              );
            })()}
            {/* Create Post — full-width strip like the banner, but thinner.
                Hidden from signed-in volunteers: it was the most prominent thing
                on their first screen and led only to a "you can't do this" toast.
                Still shown to signed-out visitors, where it doubles as a prompt
                to sign up, and openCreateModal routes them to /account. */}
            {canPost && (
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: EASE_OUT }}
                whileHover={{ y: -2, transition: { duration: 0.18, ease: 'easeOut' } }}
                whileTap={{ scale: 0.99, transition: { duration: 0.1 } }}
                onClick={openCreateModal}
                className="mb-2 h-16 md:h-20 rounded-3xl border-2 border-dashed border-primary/30 bg-primary/5 hover:bg-primary/10 hover:border-primary/50 transition-colors duration-300 flex items-center justify-center gap-3 cursor-pointer group">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 group-hover:scale-110 transition-all duration-300">
                  <Plus className="w-5 h-5 text-primary" />
                </div>
                <p className="font-semibold text-primary text-sm">Create Post</p>
              </motion.div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-4 gap-2 auto-rows-[200px] grid-flow-dense mb-12">

              {/* Opportunity Cards */}
              {filteredOpportunities.map((opp, index) => {
                // pinnedSize: admin override → map to a synthetic popularity so the existing
                // cardUtils functions work unchanged ('large'=2×2, 'medium'=2×1, 'small'=1×1)
                // Pinned size → fixed popularity; otherwise live interest (signups) drives card size
                const effectivePopularity =
                  opp.pinnedSize === 'large'  ? 30 :
                  opp.pinnedSize === 'medium' ? 15 :
                  opp.pinnedSize === 'small'  ?  0 :
                  Math.max(opp.popularity, opp.signups.length);
                const large = isLargeCard(effectivePopularity);
                const hasImage = opp.image && large;
                const alreadyInterested = isInterested(opp);
                const availabilityDisplay = getAvailabilityDisplay(opp);
                // Recurring posts are never "past"; their open/closed state is time-computed
                // !! coerces SQLite 0/1 integers to proper booleans (avoids rendering "0" in JSX)
                const recurringStatus = !!opp.isRecurring ? getRecurringStatus(opp) : null;
                const isPast = recurringStatus ? false : new Date(opp.date) < new Date();
                // Manual host-close always wins; for recurring events schedule also contributes
                const manualClosed = opp.isAvailable === false || (opp.isAvailable as any) === 0;
                const isClosed = manualClosed || (recurringStatus ? !recurringStatus.isOpen : false);
                const matchedInterests = countInterestMatches(opp, myInterests);
                return (
                  <motion.div
                    key={`${opp.id}-${listKey}`}
                    initial={{ opacity: 0, y: 22, scale: 0.96 }}
                    animate={{
                      // Opacity is set here so Framer Motion's inline style doesn't override
                      // Tailwind opacity classes (inline styles always win over classes).
                      opacity: isPast ? 0.5 : isClosed ? 0.6 : 1,
                      y: 0,
                      scale: 1,
                    }}
                    transition={{
                      delay: Math.min(index * 0.045, 0.38),
                      duration: 0.38,
                      ease: EASE_OUT,
                    }}
                    whileHover={{ y: -5, transition: { duration: 0.18, ease: 'easeOut' } }}
                    whileTap={{ scale: 0.97, transition: { duration: 0.1 } }}
                    onClick={() => setSelectedCard(opp)}
                    className={cn(
                      "group relative rounded-3xl overflow-hidden cursor-pointer border-[6px] shadow-sm hover:shadow-md transition-shadow duration-300",
                      getCategoryBorder(opp.category), getCardSize(effectivePopularity),
                      // grayscale is a CSS filter — FM doesn't touch filter, so class works fine
                      (isPast || isClosed) && "grayscale"
                    )}>
                    {hasImage ? (
                      <div className="absolute inset-0">
                        <img src={opp.image} alt={opp.title} className="w-full h-full transition-transform duration-500 group-hover:scale-105" style={imageTransformStyle(parseImageTransform(opp.cardObjectPosition))} />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />
                      </div>
                    ) : (
                      <div className={cn("absolute inset-0", getCategoryColor(opp.category))} />
                    )}
                    <div className="relative h-full p-6 flex flex-col justify-between z-10 text-white">
                      {/* TOP — always visible, separator sits right below the tags */}
                      <div className="space-y-2 border-b border-white/20 pb-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-xs font-bold tracking-widest uppercase opacity-80">{getCategoryLabel(opp.category)}</p>
                          {/* When it is, in the terms people think in. The board
                              previously showed no date at all, so deciding whether
                              something was worth opening meant opening it. */}
                          {!isPast && !isClosed && !opp.isRecurring && (() => {
                            const rel = getRelativeDay(opp.date);
                            return rel ? (
                              <span className="text-[10px] font-bold bg-white/25 text-white px-2 py-0.5 rounded-md inline-flex items-center gap-1">
                                <Clock className="w-2.5 h-2.5" />{rel}
                              </span>
                            ) : null;
                          })()}
                          {matchedInterests > 0 && (
                            <span
                              title={`Matches ${matchedInterests} of your stated interests`}
                              className="text-[10px] font-bold bg-white/25 text-white px-2 py-0.5 rounded-md inline-flex items-center gap-1">
                              <Sparkles className="w-2.5 h-2.5" />FOR YOU
                            </span>
                          )}
                          {!!opp.isRecurring && <span className="text-[10px] font-bold bg-blue-500/80 text-white px-2 py-0.5 rounded-md inline-flex items-center gap-1"><Repeat className="w-2.5 h-2.5" />{formatRecurringShort(opp)}</span>}
                          {isPast && !opp.isRecurring && <span className="text-[10px] font-bold bg-white/20 text-white px-2 py-0.5 rounded-md">ENDED</span>}
                          {isClosed && !!opp.isRecurring && <span className="text-[10px] font-bold bg-orange-500/80 text-white px-2 py-0.5 rounded-md">CLOSED</span>}
                          {alreadyInterested && (
                            <motion.span
                              initial={{ scale: 0.7, opacity: 0 }}
                              animate={{ scale: 1, opacity: 1 }}
                              className="text-[10px] font-bold bg-green-500/80 text-white px-2 py-0.5 rounded-md">
                              INTERESTED ✓
                            </motion.span>
                          )}
                        </div>
                        <h3 className={cn("font-heading font-bold leading-tight break-words", getTitleSize(effectivePopularity))}>{opp.title}</h3>
                        {opp.tags && opp.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 pt-1">
                            {opp.tags.slice(0, 2).map(tag => (
                              <span key={tag} className="text-[10px] font-semibold bg-white/20 px-2 py-0.5 rounded-md">{tag}</span>
                            ))}
                          </div>
                        )}
                      </div>
                      {/* BOTTOM — large cards: full info + host; small cards: spots + interested */}
                      {large ? (
                        <div className="space-y-3 pt-3">
                          <p className="text-sm line-clamp-2 opacity-95 font-medium">{opp.description}</p>
                          <button
                            onClick={e => { e.stopPropagation(); navigate(`/org/${opp.hostId}`); }}
                            className="text-xs opacity-70 font-medium hover:opacity-100 hover:underline transition-opacity text-left flex items-center gap-1.5"
                          >
                            {hostAvatars[opp.hostId] ? (
                              <img src={hostAvatars[opp.hostId]!} alt="" className="w-5 h-5 rounded-full object-cover ring-1 ring-white/40" />
                            ) : (
                              <span className="w-5 h-5 rounded-full bg-white/25 flex items-center justify-center text-[9px] font-bold">{opp.hostName.charAt(0).toUpperCase()}</span>
                            )}
                            by {opp.hostName}
                          </button>
                          <div className="flex items-center justify-between pt-3 border-t border-white/20">
                            {availabilityDisplay ? (
                              <div className="flex items-center gap-2">
                                <Users className="w-4 h-4" />
                                <span className="font-bold text-sm">{availabilityDisplay}</span>
                              </div>
                            ) : <span />}
                            {/* Interest heat bar — width grows as more people show interest */}
                            {opp.signups.length > 0 && (() => {
                              const cap = opp.spots > 0 && opp.spotsType === 'limited' ? opp.spots : 30;
                              const pct = Math.min((opp.signups.length / cap) * 100, 100);
                              return (
                                <div className="w-16 h-2 rounded-full bg-white/20 overflow-hidden">
                                  <div className="h-full rounded-full bg-green-400/80 transition-all duration-700" style={{ width: `${pct}%` }} />
                                </div>
                              );
                            })()}
                          </div>
                          <div className="flex items-center gap-2 text-xs opacity-80">
                            <MapPin className="w-3 h-3" /><span>{opp.location.split(',')[0]}</span>
                            <span className="mx-1">&bull;</span>
                            <Clock className="w-3 h-3" /><span>{opp.duration}h</span>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between pt-3">
                          {availabilityDisplay ? (
                            <div className="flex items-center gap-1.5">
                              <Users className="w-3.5 h-3.5 opacity-75" />
                              <span className="text-xs font-bold">{availabilityDisplay}</span>
                            </div>
                          ) : <span />}
                          {/* Interest heat bar — width grows as more people show interest */}
                          {opp.signups.length > 0 && (() => {
                            const cap = opp.spots > 0 && opp.spotsType === 'limited' ? opp.spots : 30;
                            const pct = Math.min((opp.signups.length / cap) * 100, 100);
                            return (
                              <div className="w-12 h-1.5 rounded-full bg-white/20 overflow-hidden">
                                <div className="h-full rounded-full bg-green-400/80 transition-all duration-700" style={{ width: `${pct}%` }} />
                              </div>
                            );
                          })()}
                        </div>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </div>

            {filteredOpportunities.length === 0 && loaded && (() => {
              // Name what's actually filtering, so an empty board reads as a
              // narrow search rather than an empty site.
              const activeFilters = [
                searchQuery.trim() && `“${searchQuery.trim()}”`,
                currentCategory !== 'all' && getCategoryLabel(currentCategory as Category),
                currentTown !== 'all' && currentTown,
              ].filter(Boolean) as string[];
              return (
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35, ease: EASE_OUT }}
                  className="text-center py-16 space-y-4">
                  <div className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center mx-auto">
                    <Search className="w-7 h-7 text-muted-foreground" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-foreground text-lg font-heading font-bold">
                      {activeFilters.length ? 'Nothing matches those filters' : 'No opportunities posted yet'}
                    </p>
                    <p className="text-muted-foreground text-sm max-w-md mx-auto">
                      {activeFilters.length
                        ? `Showing ${activeFilters.join(' · ')}. Try widening your search.`
                        : 'Check back soon — new opportunities go up as local organisations post them.'}
                    </p>
                  </div>
                  {activeFilters.length > 0 && (
                    // Must clear town too — it used to be left set, so clearing
                    // filters on an empty town left the board just as empty.
                    <Button
                      onClick={() => { setSearchQuery(''); setCategory('all'); setTown('all'); }}
                      className="rounded-md">
                      Clear all filters
                    </Button>
                  )}
                </motion.div>
              );
            })()}

            <div className="rounded-3xl border border-border bg-secondary/30 p-8 md:p-12 text-center">
              <h2 className="font-heading text-2xl md:text-3xl font-bold text-foreground mb-3 text-balance">Ready to make a difference?</h2>
              <p className="text-muted-foreground text-base md:text-lg mb-6 max-w-lg mx-auto leading-relaxed">Discover local volunteer opportunities and connect with people in your community.</p>
              <Button size="lg" className="rounded-md px-8 h-11 font-semibold" onClick={openCreateModal}>Create an Opportunity</Button>
            </div>
          </>
        )}
      </main>

      {/* ── Card Detail Modal ──────────────────────────────────────────── */}
      <AnimatePresence>
        {selectedCard && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            onClick={handleCloseModal}
            className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.88, opacity: 0, y: 36 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 24 }}
              transition={{ type: 'spring', stiffness: 420, damping: 36 }}
              onClick={e => e.stopPropagation()}
              ref={cardModalRef}
              role="dialog"
              aria-modal="true"
              aria-label={selectedCard.title}
              className={cn("rounded-3xl w-full max-w-3xl overflow-hidden border-2 border-white/20 shadow-md max-h-[90vh] flex flex-col focus:outline-none", getModalGradient(selectedCard.category))}>

              {/* Modal header image area */}
              <div className="relative h-48 md:h-64 overflow-hidden flex-shrink-0">
                {selectedCard.image ? (
                  <><img src={selectedCard.image} alt={selectedCard.title} className="absolute inset-0 w-full h-full" style={imageTransformStyle(parseImageTransform(selectedCard.modalObjectPosition))} />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" /></>
                ) : <div className="absolute inset-0 opacity-30" />}
                <div className="absolute inset-0 flex items-end p-6 md:p-8 justify-between gap-3">
                  <motion.h2
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.08, duration: 0.32, ease: EASE_OUT }}
                    className="text-3xl md:text-4xl font-heading font-bold text-white leading-tight max-w-lg flex-1">
                    {selectedCard.title}
                  </motion.h2>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {/* Share button */}
                    <button
                      onClick={() => handleShare(selectedCard.id)}
                      className="p-2 rounded-md bg-white/20 hover:bg-white/30 text-white transition-colors"
                      title="Copy link">
                      <Share2 className="w-4 h-4" />
                    </button>
                    {/* Edit button — host or admin only */}
                    {(currentUser?.id === selectedCard.hostId || currentUser?.isAdmin) && (
                      <button
                        onClick={() => showEditForm ? setShowEditForm(false) : openEditForm(selectedCard)}
                        className="p-2 rounded-md bg-white/20 hover:bg-white/30 text-white transition-colors"
                        title="Edit post">
                        <Edit3 className="w-4 h-4" />
                      </button>
                    )}
                    <button onClick={handleCloseModal} className="p-2 rounded-md bg-white/20 hover:bg-white/30 text-white transition-colors text-lg leading-none">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Modal body */}
              <div className="p-6 md:p-8 space-y-6 text-white overflow-y-auto">

                {/* Inline Edit Form — host/admin only */}
                <AnimatePresence>
                  {showEditForm && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2 }}
                      className="bg-white/15 rounded-2xl p-4 border border-white/20 space-y-3 overflow-hidden">
                      <p className="text-xs font-bold tracking-widest uppercase opacity-75">Edit Post</p>
                      <input
                        value={editForm.title}
                        onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))}
                        placeholder="Title"
                        className="w-full rounded-xl bg-white/80 text-foreground border-0 text-sm h-9 px-3"
                      />
                      <textarea
                        value={editForm.description}
                        onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))}
                        placeholder="Description"
                        rows={3}
                        className="w-full rounded-xl bg-white/80 text-foreground border-0 text-sm px-3 py-2 resize-none"
                      />
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <div>
                          <input
                            value={editForm.location}
                            onChange={e => setEditForm(f => ({ ...f, location: e.target.value }))}
                            placeholder="Location"
                            className="w-full rounded-xl bg-white/80 text-foreground border-0 text-sm h-9 px-3"
                          />
                          {editForm.location.trim().length >= 5 && (
                            <p className="text-white/70 text-[11px] mt-1">
                              <a
                                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(editForm.location.trim())}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="underline hover:text-white"
                              >
                                Check it on Google Maps ↗
                              </a>
                            </p>
                          )}
                        </div>
                        <select
                          value={editForm.town}
                          onChange={e => setEditForm(f => ({ ...f, town: e.target.value }))}
                          className="rounded-xl bg-white/80 text-foreground border-0 text-sm h-9 px-3"
                        >
                          <option value="">No town set</option>
                          {TOWNS.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                        {selectedCard?.isRecurring ? (
                          /* Recurring events: day-of-week dropdown + time picker */
                          <div className="flex gap-1">
                            <select
                              value={editForm.recurringDay ?? 1}
                              onChange={e => setEditForm(f => ({ ...f, recurringDay: parseInt(e.target.value) }))}
                              className="flex-1 rounded-xl bg-white/80 text-foreground border-0 text-sm h-9 px-2"
                            >
                              {['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map((d, i) => (
                                <option key={d} value={i}>{d}</option>
                              ))}
                            </select>
                            <input
                              type="time"
                              value={editForm.recurringTime ?? '09:00'}
                              onChange={e => setEditForm(f => ({ ...f, recurringTime: e.target.value }))}
                              className="w-28 rounded-xl bg-white/80 text-foreground border-0 text-sm h-9 px-2"
                            />
                          </div>
                        ) : (
                          /* One-time events: full datetime-local picker */
                          <input
                            type="datetime-local"
                            value={editForm.date}
                            onChange={e => setEditForm(f => ({ ...f, date: e.target.value }))}
                            className="rounded-xl bg-white/80 text-foreground border-0 text-sm h-9 px-3"
                          />
                        )}
                        <input
                          type="number" min={0.5} step={0.5}
                          value={editForm.duration}
                          onChange={e => setEditForm(f => ({ ...f, duration: parseFloat(e.target.value) || 0.5 }))}
                          placeholder="Duration (hrs)"
                          className="rounded-xl bg-white/80 text-foreground border-0 text-sm h-9 px-3"
                        />
                      </div>
                      {/* Optional approximate capacity */}
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-white/75 font-medium whitespace-nowrap">Approx. capacity (optional):</span>
                        <input
                          type="number" min={1}
                          value={editForm.spots || ''}
                          onChange={e => {
                            const val = e.target.value;
                            setEditForm(f => ({
                              ...f,
                              spots: val ? parseInt(val) : 0,
                              spotsType: val ? 'limited' : 'none',
                            }));
                          }}
                          placeholder="e.g. 20"
                          className="rounded-xl bg-white/80 text-foreground border-0 text-sm h-9 px-3 w-28"
                        />
                      </div>
                      {/* External signup — org's own registration page, if they use one */}
                      <div>
                        <label htmlFor="home-field-2" className="text-xs text-white/75 font-medium block mb-1">
                          Signup page (optional) — if volunteers need to register on your own site
                        </label>
                        <input id="home-field-2"
                          type="text"
                          value={editForm.externalSignupUrl}
                          onChange={e => { setEditForm(f => ({ ...f, externalSignupUrl: e.target.value })); setSignupUrlEditError(''); }}
                          placeholder="https://your-site.org/signup"
                          className={cn(
                            "w-full rounded-xl bg-white/80 text-foreground border-0 text-sm h-9 px-3",
                            signupUrlEditError && "ring-2 ring-red-400"
                          )}
                        />
                        {signupUrlEditError && <p className="text-red-200 text-xs mt-1">{signupUrlEditError}</p>}
                      </div>
                      {/* Image crop editors — drag to pan, scroll/pinch to zoom */}
                      {selectedCard.image && (
                        <div className="space-y-2 pt-1">
                          <CropEditor
                            src={selectedCard.image}
                            label="Board Card Crop"
                            value={editForm.cardTransform}
                            onChange={t => setEditForm(f => ({ ...f, cardTransform: t }))}
                            variant="dark"
                          />
                          <CropEditor
                            src={selectedCard.image}
                            label="Post Banner Crop"
                            value={editForm.modalTransform}
                            onChange={t => setEditForm(f => ({ ...f, modalTransform: t }))}
                            variant="dark"
                          />
                        </div>
                      )}
                      <div className="flex gap-2 pt-1">
                        <button onClick={() => setShowEditForm(false)}
                          className="flex-1 rounded-xl py-2 bg-white/10 hover:bg-white/20 text-white text-sm font-medium transition-colors">
                          Cancel
                        </button>
                        <button onClick={handleSaveEdit} disabled={savingEdit}
                          className="flex-1 rounded-xl py-2 bg-white text-primary text-sm font-semibold flex items-center justify-center gap-1.5 disabled:opacity-60 hover:bg-white/90 transition-colors">
                          {savingEdit ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                          {savingEdit ? 'Saving...' : 'Save Changes'}
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Location / Date / Duration */}
                <motion.div
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.12, duration: 0.32, ease: EASE_OUT }}
                  className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {/* Location — full width on mobile, 1 col on desktop */}
                  <div className="col-span-2 md:col-span-1 bg-white/15 rounded-2xl p-3 md:p-4 border border-white/20">
                    <p className="text-xs font-bold tracking-widest uppercase opacity-75 mb-1.5">Location</p>
                    {selectedCard.location?.trim() ? (
                      <a
                        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(selectedCard.location)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        className="text-sm md:text-base font-semibold inline-flex items-start gap-1.5 underline decoration-white/40 underline-offset-2 hover:decoration-white transition-colors"
                      >
                        <MapPin className="w-4 h-4 flex-shrink-0 mt-0.5" />
                        <span>{selectedCard.location}</span>
                      </a>
                    ) : (
                      <p className="text-sm md:text-base font-semibold">{selectedCard.location}</p>
                    )}
                  </div>
                  {/* Date & Time / Schedule — full width on mobile, 1 col on desktop */}
                  <div className="col-span-2 md:col-span-1 bg-white/15 rounded-2xl p-3 md:p-4 border border-white/20">
                    {!!selectedCard.isRecurring ? (
                      <>
                        <p className="text-xs font-bold tracking-widest uppercase opacity-75 mb-1.5 inline-flex items-center gap-1.5"><Repeat className="w-3 h-3" /> Weekly Schedule</p>
                        <p className="text-sm md:text-base font-semibold">
                          Every {DAY_FULL[selectedCard.recurringDay ?? 0]} at {formatRecurringTime(selectedCard.recurringTime ?? '00:00')}
                        </p>
                        {(() => {
                          const rs = getRecurringStatus(selectedCard);
                          if (!rs) return null;
                          return (
                            <p className="text-xs opacity-70 mt-1">
                              Next session: {formatDate(rs.nextOccurrence.toISOString())} at {formatTime(rs.nextOccurrence.toISOString())}
                            </p>
                          );
                        })()}
                      </>
                    ) : (
                      <>
                        <p className="text-xs font-bold tracking-widest uppercase opacity-75 mb-1.5">Date & Time</p>
                        <p className="text-sm md:text-base font-semibold">{formatDate(selectedCard.date)} · {formatTime(selectedCard.date)}</p>
                      </>
                    )}
                  </div>
                  {/* Duration */}
                  <div className="bg-white/15 rounded-2xl p-3 md:p-4 border border-white/20">
                    <p className="text-xs font-bold tracking-widest uppercase opacity-75 mb-1.5">Duration</p>
                    <p className="text-sm md:text-base font-semibold">{selectedCard.duration} hours</p>
                  </div>
                  {/* Expected Spots — planned capacity, not a live countdown */}
                  <div className="bg-white/15 rounded-2xl p-3 md:p-4 border border-white/20">
                    <p className="text-xs font-bold tracking-widest uppercase opacity-75 mb-1.5">Expected Spots</p>
                    <p className="text-sm md:text-base font-semibold">
                      {selectedCard.spotsType === 'limited' && (selectedCard.spots ?? 0) > 0
                        ? `~${selectedCard.spots}`
                        : selectedCard.spotsType === 'unlimited'
                        ? 'Unlimited'
                        : '—'}
                    </p>
                    <p className="text-xs opacity-50 mt-0.5">planned capacity</p>
                  </div>
                </motion.div>

                {/* Host */}
                <motion.div
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.17, duration: 0.32, ease: EASE_OUT }}>
                  <div className="relative bg-white/15 rounded-2xl p-3 md:p-4 border border-white/20">
                    <p className="text-xs font-bold tracking-widest uppercase opacity-75 mb-1.5">Host</p>
                    <div className="flex items-center gap-3 pr-8">
                      {/* Host avatar — skeleton while loading, then image or initial */}
                      <div className="w-10 h-10 rounded-full overflow-hidden flex-shrink-0 bg-white/20 flex items-center justify-center ring-2 ring-white/30">
                        {hostProfileLoading ? (
                          <div className="w-full h-full animate-pulse bg-white/30 rounded-full" />
                        ) : hostProfile?.profileImage ? (
                          <img
                            src={hostProfile.profileImage}
                            alt={selectedCard.hostName}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <span className="text-base font-bold text-white">
                            {selectedCard.hostName.charAt(0).toUpperCase()}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => { setSelectedCard(null); navigate(`/org/${selectedCard.hostId}`); }}
                          className="text-base font-semibold truncate hover:underline text-left"
                        >
                          {selectedCard.hostName}
                        </button>
                        {selectedCard.hostVerified && (
                          <VerifiedBadge className="w-5 h-5 flex-shrink-0" />
                        )}
                      </div>
                    </div>
                    {isLoggedIn && currentUser?.id !== selectedCard.hostId && (
                      <motion.button
                        whileHover={{ scale: 1.15 }}
                        whileTap={{ scale: 0.85 }}
                        onClick={() => handleFavToggle(selectedCard.hostId)}
                        disabled={togglingFav}
                        className="absolute top-2.5 right-2.5 p-1.5 rounded-md bg-white/10 hover:bg-white/20 transition-colors"
                        title={isFavorited(selectedCard.hostId) ? 'Remove from favorites' : 'Favorite this org'}>
                        <motion.div
                          animate={isFavorited(selectedCard.hostId)
                            ? { scale: [1, 1.4, 0.9, 1.1, 1] }
                            : { scale: 1 }}
                          transition={{ duration: 0.4, ease: 'easeOut' }}>
                          <Heart className={cn("w-4 h-4 transition-colors duration-150", isFavorited(selectedCard.hostId) ? "fill-red-500 text-red-500" : "text-white/70")} />
                        </motion.div>
                      </motion.button>
                    )}
                  </div>
                </motion.div>

                {/* Description */}
                <motion.div
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.22, duration: 0.32, ease: EASE_OUT }}
                  className="bg-white/15 rounded-2xl p-6 border border-white/20 space-y-3">
                  <h3 className="text-sm font-bold tracking-widest uppercase opacity-75">About This Opportunity</h3>
                  <p className="text-white/95 leading-relaxed text-base">{selectedCard.description}</p>

                  {/* The organization's own steps, folded in behind "How to
                      sign up" rather than sitting in a card of their own. They
                      belong with the description -- both answer "what is
                      this?" -- but unrolled they pushed the Interested button
                      off the screen, so they stay collapsed until asked for. */}
                  {selectedCard.steps && selectedCard.steps.length > 0 && (
                    <div className="pt-1">
                      <button
                        onClick={() => setStepsExpanded(v => !v)}
                        aria-expanded={stepsExpanded}
                        className="inline-flex items-center gap-1.5 text-sm font-semibold text-white/85 hover:text-white underline underline-offset-4 decoration-white/40 hover:decoration-white transition-colors">
                        {stepsExpanded ? 'Show less' : 'How to sign up'}
                        <ChevronDown className={cn('w-3.5 h-3.5 transition-transform duration-200', stepsExpanded && 'rotate-180')} />
                      </button>

                      <AnimatePresence initial={false}>
                        {stepsExpanded && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.24, ease: EASE_OUT }}
                            className="overflow-hidden">
                            <p className="text-xs font-bold tracking-widest uppercase opacity-75 pt-4 pb-2.5">
                              How to take part
                            </p>
                            <ol className="space-y-2.5">
                              {selectedCard.steps.map((step, i) => (
                                <li key={i} className="flex items-start gap-3">
                                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-white/20 text-white text-xs font-bold flex items-center justify-center tabular-nums mt-0.5">
                                    {i + 1}
                                  </span>
                                  <span className="text-white/95 text-sm leading-relaxed">{step}</span>
                                </li>
                              ))}
                            </ol>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  )}

                  {/* Both links, when each exists — they answer different questions.
                      The organization's site is "who are these people"; the signup
                      page is "what do I have to do before turning up". Shown here
                      rather than only after committing, because that is the moment
                      someone is deciding whether to. */}
                  {(hostProfile?.orgWebsite || selectedCard.externalSignupUrl) && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {hostProfile?.orgWebsite && (
                        <a
                          href={hostProfile.orgWebsite}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-md bg-white/20 hover:bg-white/30 transition-colors px-3.5 py-2 text-sm font-semibold text-white">
                          <Globe className="w-3.5 h-3.5" />
                          {selectedCard.hostName}'s website
                        </a>
                      )}
                      {selectedCard.externalSignupUrl && (
                        <a
                          href={selectedCard.externalSignupUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-md bg-white/20 hover:bg-white/30 transition-colors px-3.5 py-2 text-sm font-semibold text-white">
                          <ExternalLink className="w-3.5 h-3.5" />
                          Sign-up page
                        </a>
                      )}
                    </div>
                  )}
                </motion.div>

                {/* Tags */}
                {selectedCard.tags && selectedCard.tags.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.26, duration: 0.3, ease: EASE_OUT }}
                    className="flex flex-wrap gap-2">
                    {selectedCard.tags.map(tag => (
                      <span key={tag} className="px-3 py-1 bg-white/20 border border-white/30 rounded-md text-xs font-semibold">{tag}</span>
                    ))}
                  </motion.div>
                )}

                {/* Interest count + CTA — host sees the interested list, everyone else signs up */}
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.29, duration: 0.3, ease: EASE_OUT }}>
                  {(currentUser?.id === selectedCard.hostId || currentUser?.isAdmin) ? (
                    <div>
                      <button
                        onClick={() => toggleInterestedList(selectedCard.id)}
                        className="w-full rounded-2xl py-3 font-semibold transition-colors border border-white/40 text-white text-lg bg-white/20 hover:bg-white/30 flex items-center justify-center gap-2">
                        <Users className="w-5 h-5" />
                        {showInterestedList ? 'Hide' : 'View'} Interested ({selectedCard.signups.length})
                        <ChevronDown className={cn("w-4 h-4 transition-transform duration-200", showInterestedList && "rotate-180")} />
                      </button>
                      <AnimatePresence>
                        {showInterestedList && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={{ duration: 0.25 }}
                            className="overflow-hidden">
                            {interestedLoading ? (
                              <div className="py-6 flex justify-center">
                                <Loader2 className="w-5 h-5 animate-spin text-white/60" />
                              </div>
                            ) : interestedVolunteers && interestedVolunteers.length > 0 ? (
                              <div className="space-y-2 mt-3">
                                {interestedVolunteers.map(v => (
                                  <div key={v.email} className="bg-white/10 rounded-xl px-4 py-2.5 flex items-center justify-between gap-3">
                                    <div className="min-w-0">
                                      <p className="text-sm font-semibold truncate">{v.username}</p>
                                      <p className="text-xs text-white/60 truncate">{v.email}</p>
                                    </div>
                                    <p className="text-xs text-white/50 flex-shrink-0">
                                      {new Date(v.signedUpAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="text-center py-6 mt-3 rounded-2xl border border-dashed border-white/25 bg-white/5">
                                <Users className="w-6 h-6 mx-auto mb-2 text-white/30" />
                                <p className="text-sm text-white/70 font-medium">No one's expressed interest yet</p>
                                <p className="text-xs text-white/40 mt-1">Volunteers who tap "I'm Interested" will show up here.</p>
                              </div>
                            )}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  ) : (
                    <>
                      {/* Interest count — spots are informational only, never block interest */}
                      {(() => {
                        const { signups: sups } = selectedCard;
                        const count = sups.length;
                        return (
                          <p className="text-white/60 text-sm text-center mb-4">
                            {count === 0 ? 'Be the first to show interest' : `${count} ${count === 1 ? 'person' : 'people'} interested`}
                          </p>
                        );
                      })()}
                      {!selectedCard.isRecurring && new Date(selectedCard.date) < new Date() ? (
                        // Ended one-time event — no interest CTA. Recurring posts never end.
                        <div className="rounded-2xl py-3 font-semibold text-center bg-white/10 border border-white/20 text-white/60 text-lg">
                          This event has ended
                        </div>
                      ) : isInterested(selectedCard) ? (
                        <div className="space-y-2">
                          <div className="relative">
                            <motion.div
                              initial={{ scale: 0.95 }}
                              animate={{ scale: 1 }}
                              className="rounded-2xl py-3 font-semibold text-center bg-green-500/30 border border-green-300/40 text-white text-lg">
                              Interested ✓
                            </motion.div>
                            {/* One-shot spark burst — mounts to fire, unmounts to reset, never loops.
                                Skipped under prefers-reduced-motion (handleSignup never sets it then);
                                the state change above still happens regardless. */}
                            {showInterestBurst && <InterestBurst />}
                          </div>

                          {/* Viral loop: the moment someone says they're interested
                              is the moment they're most likely to bring a friend along */}
                          <button onClick={() => handleShare(selectedCard.id)}
                            className="w-full rounded-2xl py-2.5 font-semibold bg-white/15 hover:bg-white/25 border border-white/30 text-white text-sm transition-colors flex items-center justify-center gap-2">
                            <Share2 className="w-4 h-4" /> Invite a friend — copy link
                          </button>
                          {/* Org's own registration page — a separate, clearly distinct control from
                              the interest confirmation above, so double-tapping "Interested ✓" (which
                              has no href) can never navigate anywhere. */}
                          {selectedCard.externalSignupUrl && (
                            <a
                              href={selectedCard.externalSignupUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="w-full rounded-2xl py-2.5 font-semibold bg-white/15 hover:bg-white/25 border border-white/30 text-white text-sm transition-colors flex items-center justify-center gap-2">
                              Complete signup with {selectedCard.hostName} →
                            </a>
                          )}
                          <button onClick={() => handleCancelSignup(selectedCard.id)} disabled={signingUp}
                            className="w-full rounded-2xl py-2 font-medium text-white/60 hover:text-white/80 text-sm transition-colors">
                            {signingUp ? 'Removing...' : 'Remove interest'}
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {/* Disclosure — visible before the click that shares the volunteer's info, not after */}
                          <p className="text-white/50 text-xs text-center">
                            Your name and email will be shared with the organization hosting this event.
                          </p>
                          <motion.button
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.97 }}
                            onClick={() => handleSignup(selectedCard.id)}
                            disabled={signingUp}
                            className={cn(
                              "w-full rounded-2xl py-3 font-semibold transition-colors border border-white/40 text-white text-lg flex items-center justify-center gap-2",
                              signingUp ? "bg-white/20 cursor-not-allowed opacity-70" : "bg-white/30 hover:bg-white/40"
                            )}>
                            {signingUp && <Loader2 className="w-5 h-5 animate-spin" />}
                            {signingUp ? 'Registering...' : "I'm Interested"}
                          </motion.button>
                        </div>
                      )}
                    </>
                  )}
                </motion.div>
                {/* Report button */}
                {isLoggedIn && currentUser?.id !== selectedCard.hostId && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.35 }}
                    className="pt-2 text-center">
                    {!showReportModal ? (
                      <button
                        onClick={() => setShowReportModal(true)}
                        className="text-white/40 hover:text-white/70 text-xs flex items-center gap-1 mx-auto transition-colors">
                        <Flag className="w-3 h-3" />
                        Report this post
                      </button>
                    ) : (
                      <div className="bg-white/10 border border-white/20 rounded-2xl p-4 text-left space-y-3">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-bold tracking-widest uppercase opacity-75">Report Post</p>
                          <button onClick={() => setShowReportModal(false)} className="p-1 rounded-md hover:bg-white/10">
                            <X className="w-3.5 h-3.5 text-white/60" />
                          </button>
                        </div>
                        <select
                          value={reportReason}
                          onChange={e => setReportReason(e.target.value)}
                          className="w-full rounded-xl bg-white/80 text-foreground border-0 text-sm h-9 px-3">
                          <option value="">Select a reason...</option>
                          <option value="spam">Spam or misleading</option>
                          <option value="inappropriate">Inappropriate content</option>
                          <option value="fake">Fake or scam</option>
                          <option value="other">Other</option>
                        </select>
                        <Textarea
                          placeholder="Additional details (optional)"
                          value={reportNote}
                          onChange={e => setReportNote(e.target.value)}
                          className="rounded-xl bg-white/80 text-foreground border-0 text-sm resize-none min-h-[60px]"
                        />
                        <button
                          onClick={handleReport}
                          disabled={!reportReason || submittingReport}
                          className="w-full rounded-xl py-2 bg-red-500/80 hover:bg-red-500 text-white text-sm font-semibold transition-colors disabled:opacity-50">
                          {submittingReport ? 'Submitting...' : 'Submit Report'}
                        </button>
                      </div>
                    )}
                  </motion.div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Create Post Modal ──────────────────────────────────────────── */}
      <CreatePostModal open={showCreateModal} onClose={() => setShowCreateModal(false)} />

      {/* Host edited their post, then clicked away — don't bin the edits silently */}
      <ConfirmBubble
        open={showDiscardEdits}
        icon={<Edit3 className="w-4 h-4 text-primary" />}
        title="Discard your changes?"
        message="You've edited this post but haven't saved yet. Closing now loses those edits."
        destructiveLabel={<><Trash2 className="w-3.5 h-3.5" /> Discard</>}
        onDestructive={closeModalNow}
        cancelLabel="Keep editing"
        onCancel={() => setShowDiscardEdits(false)}
      />

    </div>
  );
}

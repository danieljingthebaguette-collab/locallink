import { useState, useEffect, useRef } from 'react';
import { useLocation } from 'wouter';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { Plus, MapPin, Users, Clock, Search, Loader2, Heart, Flag, X, Share2, Edit3, Save, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { getCardSize, isLargeCard, getTitleSize } from '@/lib/cardUtils';
import { getCategoryColor, getModalGradient, getCategoryBorder, getCategoryLabel } from '@/lib/categoryUtils';
import { useAuthStore, useOpportunitiesStore, useFavoritesStore, getRecurringStatus } from '@/lib/store';
import { CATEGORIES, type Category, type Opportunity } from '@/lib/mockData';
import CreatePostModal from '@/components/CreatePostModal';
import CropEditor, {
  type ImageTransform,
  DEFAULT_TRANSFORM,
  parseImageTransform,
  serializeImageTransform,
  imageTransformStyle,
} from '@/components/CropEditor';

// Module-level cache so host profile images survive re-renders and modal re-opens
const hostProfileCache = new Map<string, { profileImage: string | null }>();

const SORT_OPTIONS: { value: 'newest' | 'oldest' | 'soonest' | 'popular'; label: string }[] = [
  { value: 'newest',  label: 'Newest' },
  { value: 'oldest',  label: 'Oldest' },
  { value: 'soonest', label: 'Soonest' },
  { value: 'popular', label: 'Popular' },
];

// Easing curve used throughout — smooth deceleration
const EASE_OUT = [0.25, 0.1, 0.25, 1] as const;

export default function Home() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { isLoggedIn, currentUser } = useAuthStore();
  const {
    setSearchQuery, setCategory, setSortBy, getFiltered,
    currentCategory, searchQuery, sortBy,
    signup, cancelSignup, fetchOpportunities, updateOpportunity,
    loading, loaded, opportunities,
  } = useOpportunitiesStore();
  // Destructure `favorites` array directly so React re-renders when it changes
  const { favorites, fetchFavorites, addFavorite, removeFavorite } = useFavoritesStore();
  const isFavorited = (orgId: string) => favorites.some(f => f.id === orgId);

  // Card / modal state
  const [selectedCard, setSelectedCard] = useState<Opportunity | null>(null);
  const [hostProfile, setHostProfile] = useState<{ profileImage: string | null } | null>(null);
  const [hostProfileLoading, setHostProfileLoading] = useState(false);
  const [signingUp, setSigningUp] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [togglingFav, setTogglingFav] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [reportNote, setReportNote] = useState('');
  const [submittingReport, setSubmittingReport] = useState(false);
  // Edit post state
  const [showEditForm, setShowEditForm] = useState(false);
  const [editForm, setEditForm] = useState<{
    title: string; description: string; location: string; date: string;
    duration: number; spots: number; category: Category;
    spotsType: 'limited' | 'unlimited' | 'none';
    recurringDay?: number; recurringTime?: string;
    cardTransform: ImageTransform;
    modalTransform: ImageTransform;
  }>({
    title: '', description: '', location: '', date: '', duration: 2, spots: 0,
    category: 'volunteer',
    spotsType: 'none',
    cardTransform: DEFAULT_TRANSFORM,
    modalTransform: DEFAULT_TRANSFORM,
  });
  const [savingEdit, setSavingEdit] = useState(false);
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
        const profile = data ? { profileImage: data.profileImage || null } : { profileImage: null };
        hostProfileCache.set(selectedCard.hostId, profile);
        setHostProfile(profile);
      })
      .catch(() => setHostProfile(null))
      .finally(() => setHostProfileLoading(false));
  }, [selectedCard?.hostId]);

  const filteredOpportunities = getFiltered();

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
  const formatRecurringShort = (opp: Opportunity) => {
    const day = DAY_SHORT[opp.recurringDay ?? 0];
    if (!opp.recurringTime) return `🔁 ${day}`;
    const [h, m] = opp.recurringTime.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hr = h % 12 || 12;
    const min = m === 0 ? '' : `:${m.toString().padStart(2, '0')}`;
    return `🔁 ${day} ${hr}${min}${ampm}`;
  };

  // Returns capacity/availability string shown on cards (left side).
  const getAvailabilityDisplay = (opp: Opportunity) => {
    if (opp.spotsType === 'limited' && opp.spots > 0) {
      if (opp.signups.length >= opp.spots) return 'Full';
      return `~${opp.spots} spots`;
    }
    if (opp.spotsType === 'unlimited') return 'Unlimited';
    return '';
  };

  // Returns the bottom-right label on a card:
  // "X spots left" when there's a real cap and space remaining,
  // or "X interested" as the fallback.
  const getInterestedDisplay = (opp: Opportunity) => {
    if (opp.spotsType === 'limited' && opp.spots > 0 && opp.signups.length < opp.spots) {
      const left = opp.spots - opp.signups.length;
      return `${left} spot${left === 1 ? '' : 's'} left`;
    }
    return `${opp.signups.length} interested`;
  };

  // ── Open create modal with guard ───────────────────────────────────
  const openCreateModal = () => {
    if (!isLoggedIn) {
      toast({ title: 'Please login first', description: 'You need to be logged in to create a post.' });
      navigate('/account');
      return;
    }
    if (!currentUser?.isAdmin && currentUser?.accountType !== 'organization') {
      toast({ title: 'Organization accounts only', description: 'Only organization accounts can create posts. Update your account type in settings.' });
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
      const success = await signup(oppId, currentUser.id);
      if (success) {
        toast({ title: "You're interested! ✓", description: 'You can view this in My Events.' });
        const fresh = useOpportunitiesStore.getState().opportunities.find(o => o.id === oppId);
        if (fresh) setSelectedCard(fresh); else setSelectedCard(null);
      } else {
        toast({ title: 'Could not register interest', description: 'You may already be interested in this opportunity.' });
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
  const handleCloseModal = () => {
    if (showEditForm && window.confirm('You have unsaved changes. Close anyway?')) {
      setSelectedCard(null); setShowReportModal(false); setReportReason(''); setReportNote(''); setShowEditForm(false);
    } else if (!showEditForm) {
      setSelectedCard(null); setShowReportModal(false); setReportReason(''); setReportNote('');
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
      date: opp.date,
      duration: opp.duration,
      spots: opp.spots || 0,
      category: opp.category as Category,
      spotsType: (opp.spotsType as 'limited' | 'unlimited' | 'none') || 'none',
      recurringDay: opp.recurringDay,
      recurringTime: opp.recurringTime,
      cardTransform: parseImageTransform(opp.cardObjectPosition),
      modalTransform: parseImageTransform(opp.modalObjectPosition),
    });
    setShowEditForm(true);
  };

  const handleSaveEdit = async () => {
    if (!selectedCard) return;
    setSavingEdit(true);
    // Build update payload — recurring events update day/time schedule; one-time events update date
    const payload: Record<string, any> = {
      title: editForm.title,
      description: editForm.description,
      location: editForm.location,
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
      <div className="sticky top-16 z-40 bg-background/95 backdrop-blur-lg border-b border-border/40">
        <div className="container mx-auto px-4 py-3 space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search opportunities..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 h-10 rounded-full border-border bg-secondary/50"
            />
          </div>
          <div className="overflow-hidden transition-all duration-300"
            style={{ opacity: selectedCard ? 0 : 1, height: selectedCard ? 0 : 'auto', pointerEvents: selectedCard ? 'none' : 'auto' }}>
            {/* Category pills */}
            <div className="flex items-center gap-2 flex-wrap mb-2">
              {CATEGORIES.map(cat => (
                <button key={cat.value} onClick={() => setCategory(cat.value as Category | 'all')}
                  className={cn("px-4 py-2 rounded-full text-sm font-medium transition-all border",
                    currentCategory === cat.value
                      ? "bg-foreground text-background border-foreground"
                      : "bg-background text-foreground border-border hover:border-foreground/50")}>
                  {cat.label}
                </button>
              ))}
            </div>
            {/* Sort toggle + pills */}
            <div>
              <button
                onClick={() => setShowSort(s => !s)}
                className="flex items-center gap-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide hover:text-foreground transition-colors mb-1.5">
                <span>Sort: {SORT_OPTIONS.find(o => o.value === sortBy)?.label}</span>
                <ChevronDown className={cn("w-3.5 h-3.5 transition-transform duration-200", showSort && "rotate-180")} />
              </button>
              <div className={cn(
                "overflow-hidden transition-all duration-300 ease-in-out",
                showSort ? "max-h-20 opacity-100" : "max-h-0 opacity-0 pointer-events-none"
              )}>
                <div className="flex items-center gap-2 flex-wrap pb-1">
                  {SORT_OPTIONS.map(opt => (
                    <button key={opt.value} onClick={() => { setSortBy(opt.value); setShowSort(false); }}
                      className={cn("px-3 py-1 rounded-full text-xs font-semibold transition-all border",
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
        {loading && !loaded && (
          <div className="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-5 gap-2 auto-rows-[200px] grid-flow-dense mb-12">
            <div className="md:col-span-1 md:row-span-1 rounded-3xl border-2 border-dashed border-border/30 bg-secondary/20 animate-pulse" />
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
        )}

        {(!loading || loaded) && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-5 gap-2 auto-rows-[200px] grid-flow-dense mb-12">

              {/* Create Post Card */}
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: EASE_OUT }}
                whileHover={{ y: -4, transition: { duration: 0.18, ease: 'easeOut' } }}
                whileTap={{ scale: 0.97, transition: { duration: 0.1 } }}
                onClick={openCreateModal}
                className="md:col-span-1 md:row-span-1 rounded-3xl border-2 border-dashed border-primary/30 bg-primary/5 hover:bg-primary/10 hover:border-primary/50 transition-colors duration-300 flex items-center justify-center cursor-pointer group">
                <div className="text-center space-y-3">
                  <div className="flex justify-center">
                    <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 group-hover:scale-110 transition-all duration-300">
                      <Plus className="w-7 h-7 text-primary" />
                    </div>
                  </div>
                  <p className="font-semibold text-primary text-sm">Create Post</p>
                </div>
              </motion.div>

              {/* Opportunity Cards */}
              {filteredOpportunities.map((opp, index) => {
                // pinnedSize: admin override → map to a synthetic popularity so the existing
                // cardUtils functions work unchanged ('large'=2×2, 'medium'=2×1, 'small'=1×1)
                const effectivePopularity =
                  opp.pinnedSize === 'large'  ? 30 :
                  opp.pinnedSize === 'medium' ? 15 :
                  opp.pinnedSize === 'small'  ?  0 :
                  opp.popularity;
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
                      "group relative rounded-3xl overflow-hidden cursor-pointer border-4 shadow-sm hover:shadow-2xl transition-shadow duration-300",
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
                      <div className={cn("absolute inset-0 bg-gradient-to-br", getCategoryColor(opp.category))} />
                    )}
                    <div className="relative h-full p-6 flex flex-col justify-between z-10 text-white">
                      {/* TOP — always visible, separator sits right below the tags */}
                      <div className="space-y-2 border-b border-white/20 pb-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-xs font-bold tracking-widest uppercase opacity-80">{getCategoryLabel(opp.category)}</p>
                          {!!opp.isRecurring && <span className="text-[10px] font-bold bg-blue-500/80 text-white px-2 py-0.5 rounded-full">{formatRecurringShort(opp)}</span>}
                          {isPast && !opp.isRecurring && <span className="text-[10px] font-bold bg-white/20 text-white px-2 py-0.5 rounded-full">ENDED</span>}
                          {isClosed && !!opp.isRecurring && <span className="text-[10px] font-bold bg-orange-500/80 text-white px-2 py-0.5 rounded-full">CLOSED</span>}
                          {alreadyInterested && (
                            <motion.span
                              initial={{ scale: 0.7, opacity: 0 }}
                              animate={{ scale: 1, opacity: 1 }}
                              className="text-[10px] font-bold bg-green-500/80 text-white px-2 py-0.5 rounded-full">
                              INTERESTED ✓
                            </motion.span>
                          )}
                        </div>
                        <h3 className={cn("font-heading font-bold leading-tight", getTitleSize(effectivePopularity))}>{opp.title}</h3>
                        {opp.tags && opp.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 pt-1">
                            {opp.tags.slice(0, 2).map(tag => (
                              <span key={tag} className="text-[10px] font-semibold bg-white/20 px-2 py-0.5 rounded-full">{tag}</span>
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
                            className="text-xs opacity-70 font-medium hover:opacity-100 hover:underline transition-opacity text-left"
                          >
                            by {opp.hostName}
                          </button>
                          <div className="flex items-center justify-between pt-3 border-t border-white/20">
                            {availabilityDisplay ? (
                              <div className="flex items-center gap-2">
                                <Users className="w-4 h-4" />
                                <span className="font-bold text-sm">{availabilityDisplay}</span>
                              </div>
                            ) : <span />}
                            <span className="text-xs opacity-70">{getInterestedDisplay(opp)}</span>
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
                          <span className="text-xs opacity-70">{opp.signups.length} interested</span>
                        </div>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </div>

            {filteredOpportunities.length === 0 && loaded && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, ease: EASE_OUT }}
                className="text-center py-16 space-y-4">
                <Search className="w-12 h-12 text-muted-foreground mx-auto opacity-50" />
                <p className="text-muted-foreground text-lg">No opportunities found.</p>
                <Button onClick={() => { setSearchQuery(''); setCategory('all'); }} className="rounded-full">Clear Filters</Button>
              </motion.div>
            )}

            <div className="rounded-3xl border-2 border-border bg-secondary/40 backdrop-blur-sm p-8 md:p-12 text-center">
              <h2 className="font-heading text-2xl md:text-3xl font-bold text-foreground mb-3">Ready to make a difference?</h2>
              <p className="text-muted-foreground text-lg mb-6 max-w-2xl mx-auto">Discover local volunteer opportunities and connect with people in your community.</p>
              <Button size="lg" className="rounded-full px-8 h-11 font-semibold" onClick={openCreateModal}>Create an Opportunity</Button>
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
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.88, opacity: 0, y: 36 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 24 }}
              transition={{ type: 'spring', stiffness: 420, damping: 36 }}
              onClick={e => e.stopPropagation()}
              className={cn("bg-gradient-to-br rounded-3xl w-full max-w-3xl overflow-hidden border-2 border-white/20 shadow-2xl max-h-[90vh] flex flex-col", getModalGradient(selectedCard.category))}>

              {/* Modal header image area */}
              <div className="relative h-48 md:h-64 overflow-hidden flex-shrink-0">
                {selectedCard.image ? (
                  <><img src={selectedCard.image} alt={selectedCard.title} className="absolute inset-0 w-full h-full" style={imageTransformStyle(parseImageTransform(selectedCard.modalObjectPosition))} />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" /></>
                ) : <div className="absolute inset-0 bg-gradient-to-br opacity-30" />}
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
                      className="p-2 rounded-full bg-white/20 hover:bg-white/30 text-white transition-colors"
                      title="Copy link">
                      <Share2 className="w-4 h-4" />
                    </button>
                    {/* Edit button — host or admin only */}
                    {(currentUser?.id === selectedCard.hostId || currentUser?.isAdmin) && (
                      <button
                        onClick={() => showEditForm ? setShowEditForm(false) : openEditForm(selectedCard)}
                        className="p-2 rounded-full bg-white/20 hover:bg-white/30 text-white transition-colors"
                        title="Edit post">
                        <Edit3 className="w-4 h-4" />
                      </button>
                    )}
                    <button onClick={handleCloseModal} className="p-2 rounded-full bg-white/20 hover:bg-white/30 text-white transition-colors text-lg leading-none">
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
                      className="bg-white/15 backdrop-blur-md rounded-2xl p-4 border border-white/20 space-y-3 overflow-hidden">
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
                        <input
                          value={editForm.location}
                          onChange={e => setEditForm(f => ({ ...f, location: e.target.value }))}
                          placeholder="Location"
                          className="rounded-xl bg-white/80 text-foreground border-0 text-sm h-9 px-3"
                        />
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
                  className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {/* Location — full width on mobile, 1/3 on desktop */}
                  <div className="col-span-2 md:col-span-1 bg-white/15 backdrop-blur-md rounded-2xl p-3 md:p-4 border border-white/20">
                    <p className="text-xs font-bold tracking-widest uppercase opacity-75 mb-1.5">Location</p>
                    <p className="text-sm md:text-base font-semibold">{selectedCard.location}</p>
                  </div>
                  {/* Date & Time / Schedule */}
                  <div className="bg-white/15 backdrop-blur-md rounded-2xl p-3 md:p-4 border border-white/20">
                    {!!selectedCard.isRecurring ? (
                      <>
                        <p className="text-xs font-bold tracking-widest uppercase opacity-75 mb-1.5">🔁 Weekly Schedule</p>
                        <p className="text-sm md:text-base font-semibold">
                          Every {DAY_FULL[selectedCard.recurringDay ?? 0]} at {formatRecurringTime(selectedCard.recurringTime ?? '00:00')}
                        </p>
                        {(() => {
                          const rs = getRecurringStatus(selectedCard);
                          if (!rs) return null;
                          const label = rs.isOpen ? 'Open now · Next closes' : 'Closed · Reopens';
                          return (
                            <p className="text-xs opacity-70 mt-1">
                              {label}: {formatDate(rs.nextOccurrence.toISOString())} at {formatTime(rs.nextOccurrence.toISOString())}
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
                  {/* Duration — half width on mobile */}
                  <div className="bg-white/15 backdrop-blur-md rounded-2xl p-3 md:p-4 border border-white/20">
                    <p className="text-xs font-bold tracking-widest uppercase opacity-75 mb-1.5">Duration</p>
                    <p className="text-sm md:text-base font-semibold">{selectedCard.duration} hours</p>
                  </div>
                </motion.div>

                {/* Host */}
                <motion.div
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.17, duration: 0.32, ease: EASE_OUT }}>
                  <div className="relative bg-white/15 backdrop-blur-md rounded-2xl p-3 md:p-4 border border-white/20">
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
                      <button
                        onClick={() => { setSelectedCard(null); navigate(`/org/${selectedCard.hostId}`); }}
                        className="text-base font-semibold truncate hover:underline text-left"
                      >
                        {selectedCard.hostName}
                      </button>
                    </div>
                    {isLoggedIn && currentUser?.id !== selectedCard.hostId && (
                      <motion.button
                        whileHover={{ scale: 1.15 }}
                        whileTap={{ scale: 0.85 }}
                        onClick={() => handleFavToggle(selectedCard.hostId)}
                        disabled={togglingFav}
                        className="absolute top-2.5 right-2.5 p-1.5 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
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
                  className="bg-white/15 backdrop-blur-md rounded-2xl p-6 border border-white/20 space-y-3">
                  <h3 className="text-sm font-bold tracking-widest uppercase opacity-75">About This Opportunity</h3>
                  <p className="text-white/95 leading-relaxed text-base">{selectedCard.description}</p>
                </motion.div>

                {/* Tags */}
                {selectedCard.tags && selectedCard.tags.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.26, duration: 0.3, ease: EASE_OUT }}
                    className="flex flex-wrap gap-2">
                    {selectedCard.tags.map(tag => (
                      <span key={tag} className="px-3 py-1 bg-white/20 border border-white/30 rounded-full text-xs font-semibold">{tag}</span>
                    ))}
                  </motion.div>
                )}

                {/* Interest count + CTA */}
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.29, duration: 0.3, ease: EASE_OUT }}>
                  {/* Show "X spots left" when capped, "Event Full" when at capacity, or plain count */}
                  {(() => {
                    const { spotsType, spots, signups: sups } = selectedCard;
                    const hasCap = spotsType === 'limited' && spots > 0;
                    const isFull = hasCap && sups.length >= spots;
                    let countText: string;
                    if (isFull) {
                      countText = 'Event Full';
                    } else if (hasCap) {
                      const left = spots - sups.length;
                      countText = `${left} spot${left === 1 ? '' : 's'} left`;
                    } else {
                      countText = `${sups.length} ${sups.length === 1 ? 'person' : 'people'} interested`;
                    }
                    return <p className="text-white/60 text-sm text-center mb-4">{countText}</p>;
                  })()}
                  {(() => {
                    const { spotsType, spots, signups: sups } = selectedCard;
                    const isFull = spotsType === 'limited' && spots > 0 && sups.length >= spots;
                    if (isInterested(selectedCard)) {
                      return (
                        <div className="space-y-2">
                          <motion.div
                            initial={{ scale: 0.95 }}
                            animate={{ scale: 1 }}
                            className="rounded-2xl py-3 font-semibold text-center bg-green-500/30 border border-green-300/40 text-white text-lg">
                            Interested ✓
                          </motion.div>
                          <button onClick={() => handleCancelSignup(selectedCard.id)} disabled={signingUp}
                            className="w-full rounded-2xl py-2 font-medium text-white/60 hover:text-white/80 text-sm transition-colors">
                            {signingUp ? 'Removing...' : 'Remove interest'}
                          </button>
                        </div>
                      );
                    }
                    if (isFull) {
                      return (
                        <div className="w-full rounded-2xl py-3 font-semibold text-center bg-white/10 border border-white/20 text-white/50 text-lg cursor-not-allowed">
                          Event Full
                        </div>
                      );
                    }
                    return (
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
                    );
                  })()}
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
                          <button onClick={() => setShowReportModal(false)} className="p-1 rounded-full hover:bg-white/10">
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
    </div>
  );
}

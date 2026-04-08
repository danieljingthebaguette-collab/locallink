import { useEffect, useState } from 'react';
import { useParams, useLocation } from 'wouter';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { Building2, Globe, Mail, Phone, Calendar, MapPin, Clock, Users, ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuthStore, useFavoritesStore } from '@/lib/store';
import { Heart } from 'lucide-react';
import { getCategoryColor, getCategoryLabel } from '@/lib/categoryUtils';
import type { Opportunity } from '@/lib/mockData';

interface OrgProfile {
  id: string;
  username: string;
  profileImage: string | null;
  accountType: string;
  orgDescription: string | null;
  orgWebsite: string | null;
  orgEmail: string | null;
  orgPhone: string | null;
  createdAt: string;
  posts: Opportunity[];
}

export default function OrgProfilePage() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { isLoggedIn, currentUser } = useAuthStore();
  const { favorites, fetchFavorites, addFavorite, removeFavorite } = useFavoritesStore();
  const isFavorited = (orgId: string) => favorites.some(f => f.id === orgId);

  const [org, setOrg] = useState<OrgProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [togglingFav, setTogglingFav] = useState(false);

  const orgId = params.id;

  useEffect(() => {
    if (!orgId) return;
    setLoading(true);
    fetch(`/api/org/${orgId}`)
      .then(r => r.ok ? r.json() : Promise.reject('Not found'))
      .then(data => { setOrg(data); setLoading(false); })
      .catch(() => { setError('Organization not found'); setLoading(false); });
  }, [orgId]);

  useEffect(() => {
    if (isLoggedIn) fetchFavorites();
  }, [isLoggedIn, fetchFavorites]);

  const handleFavToggle = async () => {
    if (!isLoggedIn || !orgId) return;
    setTogglingFav(true);
    if (isFavorited(orgId)) {
      await removeFavorite(orgId);
    } else {
      await addFavorite(orgId);
    }
    setTogglingFav(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background pb-24 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !org) {
    return (
      <div className="min-h-screen bg-background pb-24 font-sans">
        <main className="container mx-auto px-4 py-16 text-center">
          <Building2 className="w-16 h-16 text-muted-foreground mx-auto opacity-50 mb-4" />
          <h2 className="text-2xl font-heading font-bold text-foreground mb-2">Organization Not Found</h2>
          <p className="text-muted-foreground mb-6">This organization profile doesn't exist or isn't available.</p>
          <Button onClick={() => navigate('/')} className="rounded-full px-8">← Back to Home</Button>
        </main>
      </div>
    );
  }

  const now = new Date();
  const activePosts = org.posts.filter(p => p.isRecurring || new Date(p.date) >= now);
  const pastPosts = org.posts.filter(p => !p.isRecurring && new Date(p.date) < now);

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  };

  return (
    <div className="min-h-screen bg-background pb-24 font-sans">
      <main className="container mx-auto px-4 py-8 max-w-3xl">

        {/* Back button */}
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Board
        </button>

        {/* Org Header Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-3xl border-2 border-border bg-card p-8 mb-6"
        >
          <div className="flex items-start gap-5">
            {/* Logo */}
            <div className="w-20 h-20 rounded-2xl overflow-hidden flex-shrink-0 bg-primary/10 flex items-center justify-center ring-2 ring-border">
              {org.profileImage ? (
                <img src={org.profileImage} alt={org.username} className="w-full h-full object-cover" />
              ) : (
                <span className="text-3xl font-bold text-primary">{org.username.charAt(0).toUpperCase()}</span>
              )}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h1 className="text-2xl font-heading font-bold text-foreground">{org.username}</h1>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    🏢 Organization · Member since {new Date(org.createdAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                  </p>
                </div>
                {/* Favorite button — only for logged-in non-owners */}
                {isLoggedIn && currentUser?.id !== orgId && (
                  <motion.button
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={handleFavToggle}
                    disabled={togglingFav}
                    className={cn(
                      'flex-shrink-0 p-2.5 rounded-full border-2 transition-all',
                      isFavorited(orgId!)
                        ? 'bg-red-50 border-red-300 text-red-500'
                        : 'bg-secondary border-border text-muted-foreground hover:border-red-300'
                    )}
                    title={isFavorited(orgId!) ? 'Remove from favorites' : 'Save to favorites'}
                  >
                    <Heart className={cn('w-4 h-4 transition-colors', isFavorited(orgId!) && 'fill-red-500')} />
                  </motion.button>
                )}
              </div>

              {/* Stats */}
              <div className="flex gap-4 mt-3">
                <div className="text-center">
                  <p className="text-lg font-bold text-foreground">{org.posts.length}</p>
                  <p className="text-[10px] text-muted-foreground font-medium">Posts</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-bold text-foreground">{activePosts.length}</p>
                  <p className="text-[10px] text-muted-foreground font-medium">Active</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-bold text-foreground">
                    {org.posts.reduce((sum, p) => sum + (p.signups?.length || 0), 0)}
                  </p>
                  <p className="text-[10px] text-muted-foreground font-medium">Interested</p>
                </div>
              </div>
            </div>
          </div>

          {/* Description */}
          {org.orgDescription && (
            <div className="mt-5 pt-5 border-t border-border">
              <p className="text-sm font-bold text-muted-foreground uppercase tracking-wide mb-2">About</p>
              <p className="text-foreground leading-relaxed">{org.orgDescription}</p>
            </div>
          )}

          {/* Contact & Website */}
          {(org.orgWebsite || org.orgEmail || org.orgPhone) && (
            <div className="mt-4 pt-4 border-t border-border space-y-2">
              <p className="text-sm font-bold text-muted-foreground uppercase tracking-wide mb-3">Contact</p>
              <div className="flex flex-wrap gap-3">
                {org.orgWebsite && (
                  <a
                    href={org.orgWebsite.startsWith('http') ? org.orgWebsite : `https://${org.orgWebsite}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium hover:bg-primary/20 transition-colors"
                  >
                    <Globe className="w-3.5 h-3.5" />
                    {org.orgWebsite.replace(/^https?:\/\//, '')}
                  </a>
                )}
                {org.orgEmail && (
                  <a
                    href={`mailto:${org.orgEmail}`}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-secondary text-foreground text-sm font-medium hover:bg-secondary/80 transition-colors"
                  >
                    <Mail className="w-3.5 h-3.5 text-muted-foreground" />
                    {org.orgEmail}
                  </a>
                )}
                {org.orgPhone && (
                  <a
                    href={`tel:${org.orgPhone}`}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-secondary text-foreground text-sm font-medium hover:bg-secondary/80 transition-colors"
                  >
                    <Phone className="w-3.5 h-3.5 text-muted-foreground" />
                    {org.orgPhone}
                  </a>
                )}
              </div>
            </div>
          )}
        </motion.div>

        {/* Active / Upcoming Posts */}
        <section className="mb-6">
          <h2 className="font-heading font-bold text-lg text-foreground mb-4 flex items-center gap-2">
            <Calendar className="w-5 h-5 text-green-500" />
            Active & Upcoming ({activePosts.length})
          </h2>
          {activePosts.length === 0 ? (
            <div className="rounded-2xl border-2 border-border bg-card p-8 text-center">
              <Calendar className="w-8 h-8 text-muted-foreground mx-auto opacity-40 mb-2" />
              <p className="text-sm text-muted-foreground">No active posts right now</p>
            </div>
          ) : (
            <div className="space-y-3">
              {activePosts.map((post, idx) => (
                <PostCard key={post.id} post={post} idx={idx} formatDate={formatDate} />
              ))}
            </div>
          )}
        </section>

        {/* Past Posts */}
        {pastPosts.length > 0 && (
          <section>
            <h2 className="font-heading font-bold text-lg text-foreground mb-4 flex items-center gap-2">
              <Clock className="w-5 h-5 text-muted-foreground" />
              Past Posts ({pastPosts.length})
            </h2>
            <div className="space-y-3 opacity-70">
              {pastPosts.map((post, idx) => (
                <PostCard key={post.id} post={post} idx={idx} formatDate={formatDate} past />
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function PostCard({ post, idx, formatDate, past = false }: { post: Opportunity; idx: number; formatDate: (s: string) => string; past?: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: idx * 0.05 }}
      className={cn(
        'rounded-2xl border-2 border-border bg-card p-4 flex gap-4',
        past && 'opacity-80'
      )}
    >
      {post.image && (
        <div className="w-16 h-16 rounded-xl overflow-hidden flex-shrink-0">
          <img src={post.image} alt={post.title} className="w-full h-full object-cover" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2 mb-1">
          <h3 className="font-semibold text-foreground text-sm leading-tight">{post.title}</h3>
          <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-bold flex-shrink-0', getCategoryColor(post.category))}>
            {getCategoryLabel(post.category)}
          </span>
        </div>
        <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{post.description}</p>
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Calendar className="w-3 h-3" />
            {post.isRecurring ? `🔁 Weekly ${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][post.recurringDay ?? 0]}` : formatDate(post.date)}
          </span>
          <span className="flex items-center gap-1">
            <MapPin className="w-3 h-3" />
            {post.location}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {post.duration}h
          </span>
          <span className="flex items-center gap-1">
            <Users className="w-3 h-3" />
            {post.signups?.length || 0} interested
          </span>
        </div>
      </div>
    </motion.div>
  );
}

import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { MapPin, Users, Bell, Star, ArrowRight } from 'lucide-react';
import type { Opportunity } from '@/lib/mockData';
import { getCategoryColor, getCategoryLabel } from '@/lib/categoryUtils';
import Logo from '@/components/Logo';

const SKIP_KEY = 'locallink_skip_landing';

export function shouldShowLanding(): boolean {
  return !localStorage.getItem(SKIP_KEY);
}

export function skipLanding() {
  localStorage.setItem(SKIP_KEY, '1');
}

export default function LandingPage() {
  const [, navigate] = useLocation();
  const [featuredPosts, setFeaturedPosts] = useState<Opportunity[]>([]);

  useEffect(() => {
    fetch('/api/featured-posts')
      .then(r => r.ok ? r.json() : [])
      .then((data: Opportunity[]) => setFeaturedPosts(data.slice(0, 6)))
      .catch(() => {});
  }, []);

  const handleSkip = () => {
    skipLanding();
    window.location.reload();
  };

  const handleCTA = (type: 'volunteer' | 'organization') => {
    skipLanding();
    navigate(`/account?type=${type}`);
  };

  return (
    <div className="min-h-screen bg-background font-sans pb-24">
      {/* Skip button top-right */}
      <div className="fixed top-4 right-4 z-50">
        <button
          onClick={handleSkip}
          className="text-xs font-medium text-muted-foreground hover:text-foreground bg-card border border-border rounded-full px-4 py-2 shadow-sm transition-colors"
        >
          Skip to Feed →
        </button>
      </div>

      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-primary/90 via-primary to-indigo-700 text-white py-20 px-4">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-20 -right-20 w-96 h-96 bg-white/5 rounded-full" />
          <div className="absolute -bottom-10 -left-10 w-64 h-64 bg-white/5 rounded-full" />
        </div>
        <div className="container mx-auto max-w-3xl text-center relative z-10">
          <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <div className="flex items-center justify-center gap-2 mb-6">
              <Logo size={44} />
              <span className="text-2xl font-heading font-bold">LocalLink</span>
            </div>
            <h1 className="text-4xl md:text-5xl font-heading font-bold leading-tight mb-4">
              Your community<br />needs you.
            </h1>
            <p className="text-white/80 text-lg mb-8 max-w-xl mx-auto">
              Discover local volunteer opportunities and connect with organizations making a real difference in your community.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button
                onClick={() => handleCTA('volunteer')}
                className="h-12 px-8 rounded-full font-semibold bg-white text-primary hover:bg-white/90 text-base"
              >
                🤝 I want to volunteer <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
              <Button
                onClick={() => handleCTA('organization')}
                variant="outline"
                className="h-12 px-8 rounded-full font-semibold border-white/40 text-white hover:bg-white/10 bg-transparent text-base"
              >
                🏢 I represent an org
              </Button>
            </div>
          </motion.div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-16 px-4">
        <div className="container mx-auto max-w-3xl">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
            <h2 className="text-2xl font-heading font-bold text-foreground text-center mb-10">How LocalLink works</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[
                { icon: '🔍', title: 'Browse', desc: 'Explore volunteer opportunities near you, filtered by category and date.' },
                { icon: '✋', title: 'Sign Up', desc: 'Express interest in events that fit your schedule with one click.' },
                { icon: '🌟', title: 'Make an Impact', desc: 'Show up, volunteer, and track your journey on your profile.' },
              ].map((step, i) => (
                <motion.div
                  key={step.title}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 + i * 0.1 }}
                  className="rounded-2xl border-2 border-border bg-card p-6 text-center"
                >
                  <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center text-2xl mx-auto mb-4">{step.icon}</div>
                  <h3 className="font-heading font-bold text-foreground mb-2">{step.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{step.desc}</p>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* Perks bar */}
      <section className="py-6 px-4">
        <div className="container mx-auto max-w-3xl">
          <div className="rounded-3xl bg-gradient-to-br from-primary/10 to-indigo-500/10 border-2 border-primary/20 p-8">
            <h2 className="text-xl font-heading font-bold text-foreground text-center mb-6">Everything you need</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { icon: <Bell className="w-5 h-5" />, label: '24h Reminders' },
                { icon: <Star className="w-5 h-5" />, label: 'Save Favorites' },
                { icon: <MapPin className="w-5 h-5" />, label: 'Local Events' },
                { icon: <Users className="w-5 h-5" />, label: 'Real Orgs' },
              ].map(perk => (
                <div key={perk.label} className="flex flex-col items-center gap-2 text-center">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">{perk.icon}</div>
                  <span className="text-xs font-semibold text-foreground">{perk.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Featured Posts */}
      {featuredPosts.length > 0 && (
        <section className="py-12 px-4">
          <div className="container mx-auto max-w-3xl">
            <h2 className="text-2xl font-heading font-bold text-foreground text-center mb-2">What's happening nearby</h2>
            <p className="text-muted-foreground text-sm text-center mb-8">Join these active opportunities</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {featuredPosts.map((post, i) => (
                <motion.div
                  key={post.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.07 }}
                  className="rounded-2xl border-2 border-border bg-card overflow-hidden"
                >
                  {post.image && (
                    <div className="h-36 overflow-hidden">
                      <img src={post.image} alt={post.title} className="w-full h-full object-cover" />
                    </div>
                  )}
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <h3 className="font-semibold text-foreground text-sm leading-tight">{post.title}</h3>
                      <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-bold flex-shrink-0', getCategoryColor(post.category))}>
                        {getCategoryLabel(post.category)}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2 mb-3">{post.description}</p>
                    <div className="flex gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{post.location}</span>
                      <span className="flex items-center gap-1"><Users className="w-3 h-3" />{post.signups?.length || 0} interested</span>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Final CTA */}
      <section className="py-12 px-4 text-center">
        <div className="container mx-auto max-w-md">
          <h2 className="text-2xl font-heading font-bold text-foreground mb-3">Ready to get started?</h2>
          <p className="text-muted-foreground mb-6">Join LocalLink for free and start making a difference today.</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button onClick={() => handleCTA('volunteer')} className="h-12 px-8 rounded-full font-semibold">
              Create Free Account <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
            <Button onClick={handleSkip} variant="outline" className="h-12 px-8 rounded-full font-semibold">
              Browse First
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLocation } from 'wouter';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Bell, Star, MapPin, Users, CheckCircle2, ArrowRight } from 'lucide-react';

export default function WelcomeOverlay() {
  const [, navigate] = useLocation();
  const { currentUser, markWelcomeSeen } = useAuthStore();
  const [dismissing, setDismissing] = useState(false);

  const handleDismiss = async (path?: string) => {
    setDismissing(true);
    await markWelcomeSeen();
    if (path) navigate(path);
  };

  const isOrg = currentUser?.accountType === 'organization';

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      >
        <motion.div
          initial={{ scale: 0.92, opacity: 0, y: 24 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.92, opacity: 0, y: 24 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-3xl bg-card border-2 border-border shadow-2xl"
        >
          {/* Header */}
          <div className={cn(
            'p-8 rounded-t-3xl text-white text-center',
            isOrg
              ? 'bg-gradient-to-br from-indigo-600 to-purple-700'
              : 'bg-gradient-to-br from-primary to-primary/80'
          )}>
            <div className="w-16 h-16 rounded-2xl bg-white/20 flex items-center justify-center mx-auto mb-4">
              <span className="text-3xl">{isOrg ? '🏢' : '🤝'}</span>
            </div>
            <h1 className="text-2xl font-heading font-bold mb-2">
              Welcome to LocalLink{currentUser?.username ? `, ${currentUser.username}` : ''}!
            </h1>
            <p className="text-white/80 text-sm leading-relaxed">
              {isOrg
                ? "You're all set to start connecting with local volunteers."
                : "You're ready to discover volunteer opportunities near you."}
            </p>
          </div>

          {/* Body */}
          <div className="p-6 space-y-6">
            {/* How it works */}
            <div>
              <h2 className="font-heading font-bold text-foreground mb-4">How it works</h2>
              <div className="space-y-3">
                {isOrg ? (
                  <>
                    <WelcomeStep icon="📋" title="Complete Your Profile" desc="Add your org description, website, and contact info so volunteers can find and trust you." />
                    <WelcomeStep icon="📣" title="Post Opportunities" desc="Create event posts — they go through a quick admin review before going live." />
                    <WelcomeStep icon="🔔" title="Get Notified" desc="Receive email and in-app notifications when volunteers sign up for your events." />
                  </>
                ) : (
                  <>
                    <WelcomeStep icon="🔍" title="Browse the Board" desc="Explore local volunteer opportunities filtered by category, location, and date." />
                    <WelcomeStep icon="✋" title="Express Interest" desc="Click 'Interested' on events you'd like to attend — the organizer will see you." />
                    <WelcomeStep icon="⏰" title="Get Reminders" desc="We'll email you 24 hours before events you've signed up for so you never miss out." />
                  </>
                )}
              </div>
            </div>

            {/* Perks */}
            <div className="rounded-2xl bg-secondary/50 border border-border p-4">
              <h3 className="text-sm font-bold text-foreground mb-3">
                {isOrg ? 'What you get' : 'Your account includes'}
              </h3>
              <div className="grid grid-cols-2 gap-2">
                {isOrg ? (
                  <>
                    <WelcomePerk icon={<Users className="w-3.5 h-3.5" />} label="Volunteer tracking" />
                    <WelcomePerk icon={<Bell className="w-3.5 h-3.5" />} label="Email notifications" />
                    <WelcomePerk icon={<Star className="w-3.5 h-3.5" />} label="Public org profile" />
                    <WelcomePerk icon={<MapPin className="w-3.5 h-3.5" />} label="Recurring events" />
                  </>
                ) : (
                  <>
                    <WelcomePerk icon={<Bell className="w-3.5 h-3.5" />} label="24h event reminders" />
                    <WelcomePerk icon={<Star className="w-3.5 h-3.5" />} label="Save favorite orgs" />
                    <WelcomePerk icon={<MapPin className="w-3.5 h-3.5" />} label="Local opportunities" />
                    <WelcomePerk icon={<CheckCircle2 className="w-3.5 h-3.5" />} label="Track your events" />
                  </>
                )}
              </div>
            </div>

            {/* CTAs */}
            <div className="flex flex-col gap-3">
              {isOrg ? (
                <>
                  <Button onClick={() => handleDismiss('/profile')} disabled={dismissing} className="w-full h-12 rounded-full font-semibold">
                    Complete My Profile <ArrowRight className="w-4 h-4 ml-1" />
                  </Button>
                  <button onClick={() => handleDismiss('/')} disabled={dismissing} className="text-sm text-muted-foreground hover:text-foreground transition-colors text-center">
                    Explore the board first →
                  </button>
                </>
              ) : (
                <>
                  <Button onClick={() => handleDismiss('/')} disabled={dismissing} className="w-full h-12 rounded-full font-semibold">
                    Browse Opportunities <ArrowRight className="w-4 h-4 ml-1" />
                  </Button>
                  <button onClick={() => handleDismiss('/profile')} disabled={dismissing} className="text-sm text-muted-foreground hover:text-foreground transition-colors text-center">
                    Go to my profile →
                  </button>
                </>
              )}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

function WelcomeStep({ icon, title, desc }: { icon: string; title: string; desc: string }) {
  return (
    <div className="flex gap-3 items-start">
      <span className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center text-lg flex-shrink-0">{icon}</span>
      <div>
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
      </div>
    </div>
  );
}

function WelcomePerk({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-foreground font-medium">
      <span className="text-primary">{icon}</span>
      {label}
    </div>
  );
}

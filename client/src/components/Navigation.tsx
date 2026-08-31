import { useLocation } from 'wouter';
import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useAuthStore, useNotificationStore } from '@/lib/store';
import { Home, Calendar, Info, User, LogOut, Shield, Bell, Users, X, Trash2, Edit3, UserMinus, RefreshCw, CheckCircle2, XCircle, Sun, Moon, Sparkles, MessageSquare } from 'lucide-react';
import Logo from './Logo';
import { useScrolled } from '@/hooks/use-scrolled';

const NAV_ITEMS = [
  { path: '/', label: 'Home', mobileLabel: 'Home', icon: Home },
  { path: '/my-events', label: 'My Events', mobileLabel: 'Events', icon: Calendar },
  { path: '/about', label: 'About', mobileLabel: 'About', icon: Info },
  { path: '/profile', label: 'Profile', mobileLabel: 'Profile', icon: User },
];

export default function Navigation() {
  const [location, navigate] = useLocation();
  const { isLoggedIn, currentUser, logout, showOnboardingPrompt } = useAuthStore();
  const { notifications, unreadCount, fetchNotifications, markRead, markAllRead } = useNotificationStore();
  const [notifOpen, setNotifOpen] = useState(false);
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'));
  const scrolled = useScrolled();
  const notifRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLDivElement>(null);
  const [navIndicator, setNavIndicator] = useState<{ left: number; width: number } | null>(null);

  // Position the underline from the active link's own offsets. offsetLeft is
  // already relative to navRef (it's the positioned ancestor), so it is used
  // as-is — subtracting the container's offset would double-count it.
  //
  // Nothing renders until there's a measurement, so the first paint puts the
  // underline straight where it belongs instead of transitioning in from left: 0.
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const measure = () => {
      const active = nav.querySelector<HTMLElement>('[data-active="true"]');
      // offsetWidth is 0 while the nav is display:none below md — don't pin a
      // stale position we'd then animate away from when it becomes visible.
      if (!active || active.offsetWidth === 0) return setNavIndicator(null);
      setNavIndicator({ left: active.offsetLeft, width: active.offsetWidth });
    };
    measure();
    // Label widths move with viewport size and with late-loading fonts; the
    // container resizes in both cases.
    const ro = new ResizeObserver(measure);
    ro.observe(nav);
    return () => ro.disconnect();
  }, [location]);

  // Fetch notifications when logged in, poll every 30s
  useEffect(() => {
    if (!isLoggedIn) return;
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30_000);
    return () => clearInterval(interval);
  }, [isLoggedIn, fetchNotifications]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const formatTimeAgo = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  return (
    <>
      {/* Desktop Header */}
      {/* Condenses on scroll: 64px -> 52px. The board's filter bar is pinned
          directly beneath this and shrinks by the same 12px, so the two stay
          flush — see HEADER_H / HEADER_H_SCROLLED in home.tsx. */}
      <header className="sticky top-0 z-50 bg-background relative">
        <div className="container mx-auto px-4">
          <div className={cn(
            "flex items-center justify-between transition-[height] duration-200 ease-out",
            scrolled ? "h-[52px]" : "h-16"
          )}>
            {/* Logo */}
            <div className="flex items-center gap-2 cursor-pointer" onClick={() => navigate('/')}>
              <Logo size={scrolled ? 30 : 38} />
              <div className="flex flex-col">
                <h1 className={cn(
                  "font-heading font-semibold tracking-tight text-foreground leading-none transition-[font-size] duration-200 ease-out",
                  scrolled ? "text-lg" : "text-xl"
                )}>
                  LocalLink
                </h1>
                {/* Tagline is the first thing to go — it's orientation, not navigation.
                    whitespace-nowrap is load-bearing: the collapse animation runs on
                    max-height, so a second line has nowhere to go and gets silently
                    eaten by overflow-hidden — the tagline reads "…to Local" with
                    "Action" invisible. One line always, or none. */}
                <p className={cn(
                  "text-[10px] font-medium text-muted-foreground tracking-wide whitespace-nowrap hidden sm:block overflow-hidden transition-all duration-200 ease-out",
                  scrolled ? "max-h-0 opacity-0" : "max-h-4 opacity-100"
                )}>
                  Linking People to Local Action
                </p>
              </div>
            </div>

            {/* Desktop Nav — one persistent underline that slides between links.
                Deliberately NOT a Framer layoutId: that snapshots the outgoing
                element's box at unmount, before any effect runs, and route changes
                here always coincide with ScrollToTop resetting the scroll. The
                snapshot was therefore taken at the old scroll offset and the line
                flew up from below the fold by the full scroll distance.
                This element never unmounts, so there is nothing to snapshot — it
                just transitions left/width, driven by offsets inside this
                container, which the header's scroll condense doesn't affect. */}
            {/* lg, not md. Five tabs + logo + tagline + auth cluster needs ~810px of
                container; at md (768) that is 24px short, so flex shrank the logo
                column and the labels wrapped to two lines inside a 64px header.
                Below 1024 the bottom nav carries the same five destinations. */}
            <div ref={navRef} className="relative hidden lg:flex items-center gap-6">
              {navIndicator && (
                <span
                  className="absolute -bottom-px h-0.5 rounded-md bg-foreground transition-[left,width] duration-300 ease-out"
                  style={{ left: navIndicator.left, width: navIndicator.width }}
                />
              )}
              {NAV_ITEMS.map((item) => {
                const active = location === item.path;
                return (
                  <button
                    key={item.path}
                    onClick={() => navigate(item.path)}
                    aria-current={active ? 'page' : undefined}
                    data-active={active ? 'true' : undefined}
                    className={cn(
                      "relative font-medium text-sm transition-colors duration-150 pb-1.5",
                      active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>

            {/* Auth */}
            <div className="flex items-center gap-3">
              {/* Theme toggle — class + localStorage; main.tsx applies it pre-render */}
              <button
                onClick={() => {
                  const dark = document.documentElement.classList.toggle('dark');
                  localStorage.setItem('locallink_theme', dark ? 'dark' : 'light');
                  setIsDark(dark);
                }}
                className="w-11 h-11 flex items-center justify-center rounded-full hover:bg-secondary transition-colors"
                aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
                title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              >
                {isDark ? <Sun className="w-5 h-5 text-muted-foreground" /> : <Moon className="w-5 h-5 text-muted-foreground" />}
              </button>
              {isLoggedIn && currentUser ? (
                <>
                  {currentUser.isAdmin && (
                    <button
                      onClick={() => navigate('/admin')}
                      className={cn(
                        'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all',
                        location === '/admin'
                          ? 'bg-red-500 text-white shadow-md'
                          : 'bg-red-500/10 text-red-500 hover:bg-red-500/20'
                      )}
                    >
                      <Shield className="w-3.5 h-3.5" />
                      Admin
                    </button>
                  )}

                  {/* Notification Bell */}
                  <div className="relative" ref={notifRef}>
                    <button
                      onClick={() => setNotifOpen(o => !o)}
                      className="relative w-11 h-11 flex items-center justify-center rounded-full hover:bg-secondary transition-colors"
                      aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
                      title="Notifications"
                    >
                      <Bell className="w-5 h-5 text-muted-foreground" />
                      {unreadCount > 0 && (
                        <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                          {unreadCount > 9 ? '9+' : unreadCount}
                        </span>
                      )}
                    </button>

                    <AnimatePresence>
                      {notifOpen && (
                        <motion.div
                          initial={{ opacity: 0, y: 8, scale: 0.95 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: 8, scale: 0.95 }}
                          transition={{ duration: 0.15 }}
                          className="absolute right-0 top-full mt-2 w-80 bg-card border border-border rounded-2xl shadow-md overflow-hidden z-50"
                        >
                          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                            <h3 className="font-semibold text-sm text-foreground">Notifications</h3>
                            <div className="flex items-center gap-2">
                              {unreadCount > 0 && (
                                <button onClick={markAllRead} className="text-xs text-primary hover:underline">
                                  Mark all read
                                </button>
                              )}
                              <button onClick={() => setNotifOpen(false)} className="p-1 rounded-md hover:bg-secondary">
                                <X className="w-3.5 h-3.5 text-muted-foreground" />
                              </button>
                            </div>
                          </div>
                          <div className="max-h-72 overflow-y-auto divide-y divide-border">
                            {notifications.length === 0 ? (
                              /* Says what the panel is for, not merely that it's
                                 empty -- three words in a blank box leave you
                                 unsure whether it's working or broken. */
                              <div className="py-8 px-6 text-center text-muted-foreground">
                                <Bell className="w-8 h-8 mx-auto mb-2 opacity-30" />
                                <p className="text-sm font-medium text-foreground">No notifications yet</p>
                                <p className="text-xs mt-1 leading-relaxed">
                                  You'll hear here when an organization posts an update, when a
                                  post you made is approved, or when a weekly event opens again.
                                </p>
                              </div>
                            ) : (
                              notifications.map(n => (
                                <button
                                  key={n.id}
                                  onClick={() => {
                                    markRead(n.id);
                                    // The one type that isn't "here's something that happened" --
                                    // it's a standing invitation, so clicking it re-opens the thing
                                    // it's reminding about rather than just filing it as read.
                                    // Harmless to call unconditionally: the modal itself won't open
                                    // once onboardingCompletedAt is set, whoever asks it to.
                                    if (n.type === 'onboarding_reminder') showOnboardingPrompt();
                                    setNotifOpen(false);
                                  }}
                                  className={cn(
                                    'w-full text-left px-4 py-3 hover:bg-secondary/50 transition-colors flex gap-3 items-start',
                                    !n.read && 'bg-primary/5'
                                  )}
                                >
                                  <div className={cn(
                                    'w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5',
                                    n.type === 'interest' ? 'bg-green-500/15 text-green-600' :
                                    n.type === 'cancel' ? 'bg-orange-500/15 text-orange-500' :
                                    n.type === 'admin_delete' ? 'bg-red-500/15 text-red-500' :
                                    n.type === 'admin_edit' ? 'bg-amber-500/15 text-amber-600' :
                                    n.type === 'reopen' ? 'bg-blue-500/15 text-blue-500' :
                                    n.type === 'post_approved' ? 'bg-green-500/15 text-green-600' :
                                    n.type === 'post_denied' ? 'bg-red-500/15 text-red-500' :
                                    n.type === 'admin_message' ? 'bg-primary/15 text-primary' :
                                    'bg-primary/10 text-primary'
                                  )}>
                                    {n.type === 'interest' && <Users className="w-4 h-4" />}
                                    {n.type === 'cancel' && <UserMinus className="w-4 h-4" />}
                                    {n.type === 'admin_delete' && <Trash2 className="w-4 h-4" />}
                                    {n.type === 'admin_edit' && <Edit3 className="w-4 h-4" />}
                                    {n.type === 'reopen' && <RefreshCw className="w-4 h-4" />}
                                    {n.type === 'post_approved' && <CheckCircle2 className="w-4 h-4" />}
                                    {n.type === 'post_denied' && <XCircle className="w-4 h-4" />}
                                    {n.type === 'onboarding_reminder' && <Sparkles className="w-4 h-4" />}
                                    {n.type === 'admin_message' && <MessageSquare className="w-4 h-4" />}
                                    {!['interest','cancel','admin_delete','admin_edit','reopen','post_approved','post_denied','onboarding_reminder','admin_message'].includes(n.type) && <Bell className="w-4 h-4" />}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm text-foreground leading-snug">{n.message}</p>
                                    <p className="text-[11px] text-muted-foreground mt-0.5">{formatTimeAgo(n.createdAt)}</p>
                                  </div>
                                  {!n.read && <div className="w-2 h-2 rounded-full bg-primary mt-1.5 flex-shrink-0" />}
                                </button>
                              ))
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  <button
                    onClick={() => { logout(); navigate('/'); }}
                    aria-label="Log out"
                    className="min-h-[44px] min-w-[44px] justify-center px-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                  >
                    <LogOut className="w-4 h-4" />
                    <span className="hidden sm:inline">Logout</span>
                  </button>
                </>
              ) : (
                <button
                  onClick={() => navigate('/account')}
                  className="text-sm font-medium bg-primary text-primary-foreground rounded-md px-4 py-1.5 hover:bg-primary/90 transition-colors"
                >
                  Login
                </button>
              )}
            </div>
          </div>
        </div>
        {/* Soft trailing edge instead of a hard border-b. A color-only fade
            wasn't enough — the header carries, and a plain
            gradient div has none, so content underneath still snapped from
            blurred to sharp in a single row right at the seam, reading as a
            hard line no matter how gradual the color was. This div carries
            the SAME blur and matches the header's own 95% opacity exactly
            (no opacity jump at the boundary either), then a mask fades the
            whole rendered result — tint and blur together — down to nothing.
            That's what makes the blur itself taper instead of just cutting
            off. Sits right at the header's own bottom edge (top-full) and
            rides along as the header condenses. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-0 right-0 top-full h-12 bg-gradient-to-b from-background/95 to-transparent"
          style={{
            maskImage: 'linear-gradient(to bottom, black, transparent)',
            WebkitMaskImage: 'linear-gradient(to bottom, black, transparent)',
          }}
        />
      </header>

      {/* Mobile Bottom Nav */}
      <nav className="fixed bottom-0 left-0 right-0 bg-background border-t border-border z-50 lg:hidden">
        <div className="container mx-auto px-2 flex items-center justify-around">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className={cn(
                  "flex flex-col items-center gap-0.5 py-2 px-1 flex-1 transition-colors",
                  location === item.path
                    ? "text-primary"
                    : "text-muted-foreground"
                )}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[10px] font-medium">{item.mobileLabel}</span>
              </button>
            );
          })}

          {/* Notification Bell — logged-in users only */}
          {isLoggedIn && currentUser && (
            <button
              onClick={() => setNotifOpen(o => !o)}
              className={cn(
                "flex flex-col items-center gap-0.5 py-2 px-1 flex-1 transition-colors relative",
                "text-muted-foreground"
              )}
            >
              <span className="relative">
                <Bell className="w-5 h-5" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1.5 w-3.5 h-3.5 bg-red-500 text-white text-[8px] font-bold rounded-md flex items-center justify-center leading-none">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </span>
              <span className="text-[10px] font-medium">Alerts</span>
            </button>
          )}

          {/* Admin — admin users only */}
          {isLoggedIn && currentUser?.isAdmin && (
            <button
              onClick={() => navigate('/admin')}
              className={cn(
                "flex flex-col items-center gap-0.5 py-2 px-1 flex-1 transition-colors",
                location === '/admin' ? "text-red-500" : "text-muted-foreground"
              )}
            >
              <Shield className="w-5 h-5" />
              <span className="text-[10px] font-medium">Admin</span>
            </button>
          )}
        </div>
      </nav>
    </>
  );
}

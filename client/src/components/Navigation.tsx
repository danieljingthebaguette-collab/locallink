import { useLocation } from 'wouter';
import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useAuthStore, useNotificationStore } from '@/lib/store';
import { Home, Calendar, Info, User, LogOut, Shield, Bell, Users, X, Trash2, Edit3, UserMinus, RefreshCw, CheckCircle2, XCircle, Sun, Moon } from 'lucide-react';
import Logo from './Logo';

const NAV_ITEMS = [
  { path: '/', label: 'Home', mobileLabel: 'Home', icon: Home },
  { path: '/my-events', label: 'My Events', mobileLabel: 'Events', icon: Calendar },
  { path: '/about', label: 'About', mobileLabel: 'About', icon: Info },
  { path: '/profile', label: 'Profile', mobileLabel: 'Profile', icon: User },
];

export default function Navigation() {
  const [location, navigate] = useLocation();
  const { isLoggedIn, currentUser, logout } = useAuthStore();
  const { notifications, unreadCount, fetchNotifications, markRead, markAllRead } = useNotificationStore();
  const [notifOpen, setNotifOpen] = useState(false);
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'));
  const notifRef = useRef<HTMLDivElement>(null);

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
      <header className="sticky top-0 z-50 bg-background/95 backdrop-blur-lg border-b border-border/40">
        <div className="container mx-auto px-4">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <div className="flex items-center gap-2 cursor-pointer" onClick={() => navigate('/')}>
              <Logo size={38} />
              <div className="flex flex-col">
                <h1 className="font-heading font-semibold tracking-tight text-foreground text-xl leading-none">
                  LocalLink
                </h1>
                <p className="text-[10px] font-medium text-muted-foreground tracking-wide hidden sm:block">
                  Linking People to Local Action
                </p>
              </div>
            </div>

            {/* Desktop Nav */}
            <div className="hidden md:flex items-center gap-6">
              {NAV_ITEMS.map((item) => (
                <button
                  key={item.path}
                  onClick={() => navigate(item.path)}
                  className={cn(
                    "font-medium text-sm transition-colors border-b-2 pb-1",
                    location === item.path
                      ? "text-foreground border-foreground"
                      : "text-muted-foreground border-transparent hover:text-foreground"
                  )}
                >
                  {item.label}
                </button>
              ))}
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
                className="p-2 rounded-full hover:bg-secondary transition-colors"
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
                        'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all',
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
                      className="relative p-2 rounded-full hover:bg-secondary transition-colors"
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
                          className="absolute right-0 top-full mt-2 w-80 bg-card border border-border rounded-2xl shadow-xl overflow-hidden z-50"
                        >
                          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                            <h3 className="font-semibold text-sm text-foreground">Notifications</h3>
                            <div className="flex items-center gap-2">
                              {unreadCount > 0 && (
                                <button onClick={markAllRead} className="text-xs text-primary hover:underline">
                                  Mark all read
                                </button>
                              )}
                              <button onClick={() => setNotifOpen(false)} className="p-1 rounded-full hover:bg-secondary">
                                <X className="w-3.5 h-3.5 text-muted-foreground" />
                              </button>
                            </div>
                          </div>
                          <div className="max-h-72 overflow-y-auto divide-y divide-border">
                            {notifications.length === 0 ? (
                              <div className="py-8 text-center text-sm text-muted-foreground">
                                <Bell className="w-8 h-8 mx-auto mb-2 opacity-30" />
                                No notifications yet
                              </div>
                            ) : (
                              notifications.map(n => (
                                <button
                                  key={n.id}
                                  onClick={() => { markRead(n.id); setNotifOpen(false); }}
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
                                    'bg-primary/10 text-primary'
                                  )}>
                                    {n.type === 'interest' && <Users className="w-4 h-4" />}
                                    {n.type === 'cancel' && <UserMinus className="w-4 h-4" />}
                                    {n.type === 'admin_delete' && <Trash2 className="w-4 h-4" />}
                                    {n.type === 'admin_edit' && <Edit3 className="w-4 h-4" />}
                                    {n.type === 'reopen' && <RefreshCw className="w-4 h-4" />}
                                    {n.type === 'post_approved' && <CheckCircle2 className="w-4 h-4" />}
                                    {n.type === 'post_denied' && <XCircle className="w-4 h-4" />}
                                    {!['interest','cancel','admin_delete','admin_edit','reopen','post_approved','post_denied'].includes(n.type) && <Bell className="w-4 h-4" />}
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
                    className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                  >
                    <LogOut className="w-4 h-4" />
                    <span className="hidden sm:inline">Logout</span>
                  </button>
                </>
              ) : (
                <button
                  onClick={() => navigate('/account')}
                  className="text-sm font-medium bg-primary text-primary-foreground rounded-full px-4 py-1.5 hover:bg-primary/90 transition-colors"
                >
                  Login
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Bottom Nav */}
      <nav className="fixed bottom-0 left-0 right-0 bg-background/95 backdrop-blur-lg border-t border-border z-50 md:hidden">
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
                  <span className="absolute -top-1 -right-1.5 w-3.5 h-3.5 bg-red-500 text-white text-[8px] font-bold rounded-full flex items-center justify-center leading-none">
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

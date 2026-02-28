import { useLocation } from 'wouter';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/lib/store';
import { Home, Calendar, Info, User, LogOut, Shield } from 'lucide-react';
import Logo from './Logo';

const NAV_ITEMS = [
  { path: '/', label: 'Home', icon: Home },
  { path: '/my-events', label: 'My Events', icon: Calendar },
  { path: '/about', label: 'About', icon: Info },
  { path: '/profile', label: 'Profile', icon: User },
];

export default function Navigation() {
  const [location, navigate] = useLocation();
  const { isLoggedIn, currentUser, logout } = useAuthStore();

  return (
    <>
      {/* Desktop Header */}
      <header className="sticky top-0 z-50 bg-background/95 backdrop-blur-lg border-b border-border/40">
        <div className="container mx-auto px-4">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <div className="flex items-center gap-2 cursor-pointer" onClick={() => navigate('/')}>
              <Logo size={30} className="text-primary" />
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
                <span className="text-[10px] font-medium">{item.label.split(' ')[0]}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
}

import { useState } from 'react';
import { useLocation, Redirect } from 'wouter';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Mail, Lock, User, MailCheck, Users, Building2, ShieldOff } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuthStore } from '@/lib/store';
import Logo from '@/components/Logo';

export default function Account() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { isLoggedIn, currentUser, login, register, resendVerification, loading } = useAuthStore();

  // Check for a join-link prefill stored by /join/:slug
  const joinPrefill = (() => {
    try { return JSON.parse(sessionStorage.getItem('locallink_join') || 'null'); } catch { return null; }
  })();

  const [isLoginMode, setIsLoginMode] = useState(!joinPrefill); // open register tab if coming from join link
  const [accountType, setAccountType] = useState<'volunteer' | 'organization'>(joinPrefill ? 'organization' : 'volunteer');
  const [formError, setFormError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ username?: string; email?: string; password?: string }>({});
  const [formData, setFormData] = useState({ username: joinPrefill?.orgName || '', email: '', password: '' });

  // After registration, show the "check your email" screen
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState<string | null>(null);
  // After login is blocked for unverified email, track that email for the resend button
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendSent, setResendSent] = useState(false);

  // Suspension appeal state
  const [suspendedEmail, setSuspendedEmail] = useState<string | null>(null);
  const [appealMessage, setAppealMessage] = useState('');
  const [appealSending, setAppealSending] = useState(false);
  const [appealSent, setAppealSent] = useState(false);

  // If already logged in, redirect to profile. Uses <Redirect> rather than
  // calling navigate() here: navigate() during render updates the router (and
  // Navigation) mid-render, which React flags as a setState-during-render.
  if (isLoggedIn && currentUser) {
    return <Redirect to="/profile" />;
  }

  const validateForm = (): boolean => {
    const errors: { username?: string; email?: string; password?: string } = {};
    setFormError('');

    if (!formData.email.trim()) {
      errors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      errors.email = 'Please enter a valid email address';
    }

    if (!formData.password) {
      errors.password = 'Password is required';
    } else if (!isLoginMode && formData.password.length < 8) {
      // Length rule applies to NEW passwords only — existing accounts may
      // have 6-7 char passwords from before the minimum was raised, and
      // they must still be able to log in.
      errors.password = 'Password must be at least 8 characters';
    }

    if (!isLoginMode && !formData.username.trim()) {
      errors.username = 'Username is required';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;
    setFormError('');
    setUnverifiedEmail(null);
    setSuspendedEmail(null);
    setAppealSent(false);

    if (isLoginMode) {
      const result = await login(formData.email, formData.password);
      if (result.success) {
        toast({ title: 'Logged in successfully!' });
        navigate('/');
      } else if (result.needsVerification) {
        // Email not verified — show inline resend prompt instead of a generic error
        setUnverifiedEmail(result.email || formData.email);
        setResendSent(false);
      } else if (result.suspended) {
        // Account suspended — show appeal form
        setSuspendedEmail(result.email || formData.email);
        setAppealMessage('');
      } else {
        setFormError(result.error || 'Login failed');
      }
    } else {
      const result = await register(formData.username, formData.email, formData.password, accountType, joinPrefill?.slug);
      if (result.success) {
        sessionStorage.removeItem('locallink_join');
        if (result.needsVerification) {
          setPendingVerificationEmail(result.email || formData.email);
        } else {
          // Account is immediately active (join link or no email configured).
          // Sign them straight in rather than bouncing them to the login form to
          // retype the password they just chose. If that sign-in somehow fails,
          // fall back to the old behaviour rather than stranding them.
          const signedIn = await login(formData.email, formData.password);
          if (signedIn.success) {
            toast({ title: 'Welcome to LocalLink!' });
            // The board shows the first-run walkthrough via hasSeenWelcome
            navigate('/');
          } else {
            toast({ title: 'Account created!', description: 'You can now log in.' });
            setIsLoginMode(true);
            setFormData(d => ({ ...d, password: '' }));
          }
        }
      } else {
        setFormError(result.error || 'Registration failed');
      }
    }
  };

  const handleResend = async (email: string) => {
    setResendLoading(true);
    const result = await resendVerification(email);
    setResendLoading(false);
    if (result.success) {
      setResendSent(true);
      toast({ title: 'Verification email resent! Check your inbox.' });
    } else {
      toast({ title: result.error || 'Failed to resend', variant: 'destructive' });
    }
  };

  const clearFieldError = (field: 'username' | 'email' | 'password') => {
    if (fieldErrors[field]) setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const handleSubmitAppeal = async () => {
    if (!suspendedEmail || !appealMessage.trim()) return;
    setAppealSending(true);
    try {
      const res = await fetch('/api/appeals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: suspendedEmail, message: appealMessage.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setAppealSent(true);
        toast({ title: 'Appeal submitted! The admin will review it shortly.' });
      } else {
        toast({ title: data.error || 'Failed to submit appeal', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Network error. Please try again.', variant: 'destructive' });
    }
    setAppealSending(false);
  };

  // ── "Check your email" screen shown after successful registration ──
  if (pendingVerificationEmail) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-primary/5 via-background to-background pb-24 font-sans">
        <main className="container mx-auto px-4 py-12">
          <div className="max-w-md mx-auto">
            <div className="rounded-3xl bg-card border border-border shadow-lg p-8 md:p-10 text-center space-y-6">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mx-auto">
                <MailCheck className="w-8 h-8 text-primary" />
              </div>
              <div className="space-y-2">
                <h2 className="text-2xl font-bold text-foreground">Check your inbox</h2>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  We sent a verification link to{' '}
                  <span className="font-semibold text-foreground">{pendingVerificationEmail}</span>.
                  Click the link in the email to activate your account.
                </p>
              </div>
              <div className="rounded-xl bg-muted/50 px-4 py-3 text-xs text-muted-foreground text-left space-y-1">
                <p>• The link expires in <strong>24 hours</strong></p>
                <p>• Check your spam folder if you don't see it</p>
              </div>
              {resendSent ? (
                <p className="text-sm text-green-600 font-medium">✓ New verification email sent!</p>
              ) : (
                <Button
                  variant="outline"
                  className="w-full rounded-full"
                  disabled={resendLoading}
                  onClick={() => handleResend(pendingVerificationEmail)}
                >
                  {resendLoading ? 'Sending...' : 'Resend verification email'}
                </Button>
              )}
              <button
                onClick={() => {
                  setPendingVerificationEmail(null);
                  setIsLoginMode(true);
                  setFormData({ username: '', email: '', password: '' });
                }}
                className="text-sm text-primary hover:text-primary/80 font-medium transition-colors"
              >
                Back to login
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-primary/5 via-background to-background pb-24 font-sans">
      <main className="container mx-auto px-4 py-12">
        <div className="max-w-md mx-auto">
          <div className="space-y-6">
            {/* Logo */}
            <div className="text-center mb-2">
              <div className="inline-flex items-center justify-center w-32 h-32 rounded-2xl bg-primary/10 mb-4">
                <Logo size={80} className="text-primary" />
              </div>
            </div>

            <div className="text-center space-y-2 mb-8">
              <h2 className="text-3xl font-heading font-bold text-foreground">
                {isLoginMode ? 'Welcome Back' : 'Join LocalLink'}
              </h2>
              <p className="text-muted-foreground text-sm">
                {isLoginMode ? 'Sign in to continue making a difference' : 'Create your account and start volunteering'}
              </p>
            </div>

            <div className="rounded-3xl bg-card border border-border shadow-lg p-8 md:p-10 space-y-5">
              {/* API error */}
              {formError && (
                <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                  {formError}
                </div>
              )}

              {/* Suspended account banner with appeal form */}
              {suspendedEmail && (
                <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <ShieldOff className="w-4 h-4 text-red-600 flex-shrink-0" />
                    <p className="text-sm text-red-800 font-semibold">Account suspended</p>
                  </div>
                  <p className="text-xs text-red-700 leading-relaxed">
                    Your account (<span className="font-semibold">{suspendedEmail}</span>) has been suspended.
                    You may submit an appeal below for admin review.
                  </p>
                  {appealSent ? (
                    <div className="rounded-lg bg-green-50 border border-green-200 px-3 py-2">
                      <p className="text-xs text-green-800 font-medium">✓ Appeal submitted — the admin will review it shortly.</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Textarea
                        placeholder="Explain why your account should be reinstated..."
                        value={appealMessage}
                        onChange={(e) => setAppealMessage(e.target.value)}
                        className="text-sm rounded-xl min-h-[80px] border-red-200 focus:border-red-400 resize-none"
                        maxLength={500}
                      />
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[10px] text-red-400">{appealMessage.length}/500</p>
                        <Button
                          size="sm"
                          onClick={handleSubmitAppeal}
                          disabled={appealSending || !appealMessage.trim()}
                          className="rounded-full text-xs h-8 bg-red-600 hover:bg-red-700"
                        >
                          {appealSending ? 'Submitting...' : 'Submit Appeal'}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Email not verified banner with resend option */}
              {unverifiedEmail && (
                <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 space-y-2">
                  <p className="text-sm text-amber-800 font-medium">Email not verified</p>
                  <p className="text-xs text-amber-700">
                    Please verify <span className="font-semibold">{unverifiedEmail}</span> before logging in.
                  </p>
                  {resendSent ? (
                    <p className="text-xs text-green-700 font-medium">✓ New verification email sent!</p>
                  ) : (
                    <button
                      onClick={() => handleResend(unverifiedEmail)}
                      disabled={resendLoading}
                      className="text-xs text-amber-800 underline underline-offset-2 font-semibold disabled:opacity-50"
                    >
                      {resendLoading ? 'Sending...' : 'Resend verification email'}
                    </button>
                  )}
                </div>
              )}

              {/* Account Type toggle (signup only) */}
              {!isLoginMode && (
                <div className="space-y-2">
                  <label className="block text-sm font-semibold text-foreground">I am a...</label>
                  {joinPrefill ? (
                    /* Locked to Organization when arriving from a join link */
                    <div className="flex items-center gap-3 p-4 rounded-2xl border-2 border-primary bg-primary/5">
                      <Building2 className="w-6 h-6 text-primary flex-shrink-0" />
                      <div>
                        <p className="font-semibold text-sm text-primary">Organization</p>
                        <p className="text-xs text-muted-foreground">Set by your invite link</p>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setAccountType('volunteer')}
                        className={cn(
                          'flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all text-left',
                          accountType === 'volunteer'
                            ? 'border-primary bg-primary/5 text-primary'
                            : 'border-border bg-secondary/40 text-foreground hover:border-primary/40'
                        )}
                      >
                        <Users className="w-6 h-6" />
                        <div>
                          <p className="font-semibold text-sm">Volunteer</p>
                          <p className="text-xs text-muted-foreground">Browse & show interest</p>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => setAccountType('organization')}
                        className={cn(
                          'flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all text-left',
                          accountType === 'organization'
                            ? 'border-primary bg-primary/5 text-primary'
                            : 'border-border bg-secondary/40 text-foreground hover:border-primary/40'
                        )}
                      >
                        <Building2 className="w-6 h-6" />
                        <div>
                          <p className="font-semibold text-sm">Organization</p>
                          <p className="text-xs text-muted-foreground">Post opportunities</p>
                        </div>
                      </button>
                    </div>
                  )}
                  {!joinPrefill && (
                    // Honest now that the upgrade exists on the profile page. Note
                    // it's one-way, so the warning belongs on the Organization side.
                    <p className="text-xs text-muted-foreground mt-2">
                      {accountType === 'volunteer'
                        ? 'You can switch to an organization account later from your profile.'
                        : 'Organization accounts cannot be switched back to volunteer.'}
                    </p>
                  )}
                </div>
              )}

              {/* Username (signup only) */}
              {!isLoginMode && (
                <div className="space-y-2">
                  <label className="block text-sm font-semibold text-foreground">Username</label>
                  <div className="relative">
                    <User className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                    <Input
                      type="text"
                      placeholder="Your username"
                      value={formData.username}
                      onChange={(e) => {
                        setFormData({ ...formData, username: e.target.value });
                        clearFieldError('username');
                      }}
                      className={cn(
                        'pl-12 h-12 border-2 rounded-xl bg-white',
                        fieldErrors.username ? 'border-red-400' : 'border-border'
                      )}
                    />
                  </div>
                  {fieldErrors.username && (
                    <p className="text-xs text-red-600 pl-1">{fieldErrors.username}</p>
                  )}
                </div>
              )}

              {/* Email */}
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-foreground">Email Address</label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                  <Input
                    type="email"
                    placeholder="you@example.com"
                    value={formData.email}
                    onChange={(e) => {
                      setFormData({ ...formData, email: e.target.value });
                      clearFieldError('email');
                      setUnverifiedEmail(null);
                    }}
                    className={cn(
                      'pl-12 h-12 border-2 rounded-xl bg-white',
                      fieldErrors.email ? 'border-red-400' : 'border-border'
                    )}
                  />
                </div>
                {fieldErrors.email && (
                  <p className="text-xs text-red-600 pl-1">{fieldErrors.email}</p>
                )}
              </div>

              {/* Password */}
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-foreground">Password</label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                  <Input
                    type="password"
                    placeholder={isLoginMode ? 'Enter your password' : 'Create a password (min. 8 characters)'}
                    value={formData.password}
                    onChange={(e) => {
                      setFormData({ ...formData, password: e.target.value });
                      clearFieldError('password');
                    }}
                    className={cn(
                      'pl-12 h-12 border-2 rounded-xl bg-white',
                      fieldErrors.password ? 'border-red-400' : 'border-border'
                    )}
                    onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                  />
                </div>
                {fieldErrors.password && (
                  <p className="text-xs text-red-600 pl-1">{fieldErrors.password}</p>
                )}
                {isLoginMode && (
                  <div className="flex justify-end">
                    <button
                      onClick={() => navigate('/forgot-password')}
                      className="text-xs text-primary hover:text-primary/80 font-medium transition-colors"
                    >
                      Forgot your password?
                    </button>
                  </div>
                )}
              </div>

              {/* Submit */}
              <Button
                onClick={handleSubmit}
                disabled={loading}
                className="w-full h-12 rounded-full font-semibold mt-2"
              >
                {loading
                  ? (isLoginMode ? 'Signing in...' : 'Creating account...')
                  : (isLoginMode ? 'Sign In' : 'Create Account')}
              </Button>

              {/* Toggle */}
              <div className="text-center pt-2">
                <button
                  onClick={() => {
                    setIsLoginMode(!isLoginMode);
                    setFormData({ username: '', email: '', password: '' });
                    setFormError('');
                    setFieldErrors({});
                    setUnverifiedEmail(null);
                    setResendSent(false);
                    setSuspendedEmail(null);
                    setAppealSent(false);
                    setAppealMessage('');
                    setAccountType('volunteer');
                  }}
                  className="text-sm text-primary hover:text-primary/80 font-medium transition-colors"
                >
                  {isLoginMode ? "Don't have an account? Sign Up" : 'Already have an account? Login'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

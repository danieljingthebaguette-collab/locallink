import { useState } from 'react';
import { useLocation } from 'wouter';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Mail, MailCheck } from 'lucide-react';
import { useAuthStore } from '@/lib/store';

export default function ForgotPassword() {
  const [, navigate] = useLocation();
  const { forgotPassword, loading } = useAuthStore();
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const validate = (): boolean => {
    if (!email.trim()) {
      setEmailError('Email is required');
      return false;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setEmailError('Please enter a valid email address');
      return false;
    }
    setEmailError('');
    return true;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    // Always show success card to avoid email enumeration
    await forgotPassword(email);
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-primary/5 via-background to-background pb-24 font-sans flex items-center justify-center">
        <div className="max-w-md w-full mx-auto px-4">
          <div className="rounded-3xl bg-card border border-border shadow-lg p-8 md:p-10 text-center space-y-6">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mx-auto">
              <MailCheck className="w-8 h-8 text-primary" />
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-bold text-foreground">Check your inbox</h2>
              <p className="text-muted-foreground text-sm leading-relaxed">
                If that email is registered, we've sent a reset link. It expires in{' '}
                <span className="font-semibold text-foreground">1 hour</span>.
              </p>
            </div>
            <div className="rounded-xl bg-muted/50 px-4 py-3 text-xs text-muted-foreground text-left space-y-1">
              <p>• Check your spam folder if you don't see it</p>
              <p>• The link can only be used once</p>
            </div>
            <button
              onClick={() => navigate('/account')}
              className="text-sm text-primary hover:text-primary/80 font-medium transition-colors"
            >
              Back to login
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-primary/5 via-background to-background pb-24 font-sans">
      <main className="container mx-auto px-4 py-12">
        <div className="max-w-md mx-auto">
          <div className="space-y-6">
            <div className="text-center space-y-2 mb-8">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
                <Mail className="w-8 h-8 text-primary" />
              </div>
              <h2 className="text-3xl font-bold text-foreground">Forgot Password?</h2>
              <p className="text-muted-foreground text-sm">
                Enter your email and we'll send you a link to reset your password.
              </p>
            </div>

            <div className="rounded-3xl bg-card border border-border shadow-lg p-8 md:p-10 space-y-5">
              <div className="space-y-2">
                <label htmlFor="forgot-password-email-address" className="block text-sm font-semibold text-foreground">Email Address</label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                  <Input id="forgot-password-email-address"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (emailError) setEmailError('');
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                    className={cn(
                      'pl-12 h-12 border-2 rounded-xl bg-white',
                      emailError ? 'border-red-400' : 'border-border'
                    )}
                  />
                </div>
                {emailError && (
                  <p className="text-xs text-red-600 pl-1">{emailError}</p>
                )}
              </div>

              <Button
                onClick={handleSubmit}
                disabled={loading}
                className="w-full h-12 rounded-full font-semibold mt-2"
              >
                {loading ? 'Sending...' : 'Send Reset Link'}
              </Button>

              <div className="text-center pt-2">
                <button
                  onClick={() => navigate('/account')}
                  className="text-sm text-primary hover:text-primary/80 font-medium transition-colors"
                >
                  Back to login
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

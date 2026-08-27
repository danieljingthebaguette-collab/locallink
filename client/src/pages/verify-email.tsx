import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/lib/store';

type Status = 'loading' | 'success' | 'error';

export default function VerifyEmail() {
  const [, navigate] = useLocation();
  const loadUser = useAuthStore((s) => s.loadUser);
  const [status, setStatus] = useState<Status>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');

    if (!token) {
      setStatus('error');
      setMessage('No verification token found in the link. Please use the link from your email.');
      return;
    }

    fetch(`/api/auth/verify-email?token=${encodeURIComponent(token)}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          // Store JWT and user so they are immediately logged in
          const { token: jwt, success: _s, message: _m, ...user } = data;
          if (jwt) {
            localStorage.setItem('locallink_token', jwt);
            localStorage.setItem('locallink_user', JSON.stringify(user));
            loadUser();
          }
          setStatus('success');
          setMessage(data.message || 'Email verified!');
          // Auto-redirect after a short celebration pause
          setTimeout(() => navigate('/'), 2000);
        } else {
          setStatus('error');
          setMessage(data.error || 'Verification failed.');
        }
      })
      .catch(() => {
        setStatus('error');
        setMessage('Network error. Please try again.');
      });
  }, []);

  return (
    <div className="min-h-screen bg-background pb-24 font-sans flex items-center justify-center">
      <div className="max-w-md w-full mx-auto px-4">
        <div className="rounded-3xl bg-card border border-border shadow-sm p-8 md:p-10 text-center space-y-6">

          {status === 'loading' && (
            <>
              <Loader2 className="w-12 h-12 text-primary animate-spin mx-auto" />
              <h2 className="text-xl font-bold text-foreground">Verifying your email…</h2>
              <p className="text-sm text-muted-foreground">Just a moment.</p>
            </>
          )}

          {status === 'success' && (
            <>
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100 mx-auto">
                <CheckCircle className="w-8 h-8 text-green-600" />
              </div>
              <h2 className="text-2xl font-bold text-foreground">You're in! 🎉</h2>
              <p className="text-sm text-muted-foreground">
                {message} Taking you to LocalLink now…
              </p>
              <Button
                className="w-full h-12 rounded-md font-semibold"
                onClick={() => navigate('/')}
              >
                Go to LocalLink
              </Button>
            </>
          )}

          {status === 'error' && (
            <>
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-100 mx-auto">
                <XCircle className="w-8 h-8 text-red-500" />
              </div>
              <h2 className="text-2xl font-bold text-foreground">Verification Failed</h2>
              <p className="text-sm text-muted-foreground">{message}</p>
              <div className="space-y-3">
                <Button
                  className="w-full h-12 rounded-md font-semibold"
                  onClick={() => navigate('/account')}
                >
                  Back to Login
                </Button>
                <p className="text-xs text-muted-foreground">
                  You can request a new verification link from the login page.
                </p>
              </div>
            </>
          )}

        </div>
      </div>
    </div>
  );
}

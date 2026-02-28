import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Lock, CheckCircle, XCircle } from 'lucide-react';
import { useAuthStore } from '@/lib/store';

export default function ResetPassword() {
  const [, navigate] = useLocation();
  const { resetPassword, loading } = useAuthStore();

  const [token, setToken] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ newPassword?: string; confirmPassword?: string }>({});
  const [apiError, setApiError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get('token');
    setToken(t);
  }, []);

  const validate = (): boolean => {
    const errors: { newPassword?: string; confirmPassword?: string } = {};

    if (!newPassword) {
      errors.newPassword = 'Password is required';
    } else if (newPassword.length < 6) {
      errors.newPassword = 'Password must be at least 6 characters';
    }

    if (!confirmPassword) {
      errors.confirmPassword = 'Please confirm your password';
    } else if (newPassword && confirmPassword !== newPassword) {
      errors.confirmPassword = 'Passwords do not match';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async () => {
    if (!token) return;
    if (!validate()) return;
    setApiError('');

    const result = await resetPassword(token, newPassword);
    if (result.success) {
      setSuccess(true);
    } else {
      setApiError(result.error || 'Failed to reset password. The link may have expired.');
    }
  };

  // No token in URL
  if (token === null && typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    if (!params.get('token')) {
      return (
        <div className="min-h-screen bg-gradient-to-b from-primary/5 via-background to-background pb-24 font-sans flex items-center justify-center">
          <div className="max-w-md w-full mx-auto px-4">
            <div className="rounded-3xl bg-card border-2 border-border shadow-lg p-8 md:p-10 text-center space-y-6">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-100 mx-auto">
                <XCircle className="w-8 h-8 text-red-500" />
              </div>
              <h2 className="text-2xl font-bold text-foreground">Invalid Reset Link</h2>
              <p className="text-sm text-muted-foreground">
                This password reset link is missing a token. Please use the link from your email or request a new one.
              </p>
              <Button
                className="w-full h-12 rounded-full font-semibold"
                onClick={() => navigate('/forgot-password')}
              >
                Request New Link
              </Button>
              <button
                onClick={() => navigate('/account')}
                className="block text-sm text-primary hover:text-primary/80 font-medium transition-colors"
              >
                Back to login
              </button>
            </div>
          </div>
        </div>
      );
    }
  }

  // Success state
  if (success) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-primary/5 via-background to-background pb-24 font-sans flex items-center justify-center">
        <div className="max-w-md w-full mx-auto px-4">
          <div className="rounded-3xl bg-card border-2 border-border shadow-lg p-8 md:p-10 text-center space-y-6">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100 mx-auto">
              <CheckCircle className="w-8 h-8 text-green-600" />
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-bold text-foreground">Password Reset!</h2>
              <p className="text-sm text-muted-foreground">
                Your password has been updated. You can now log in with your new password.
              </p>
            </div>
            <Button
              className="w-full h-12 rounded-full font-semibold"
              onClick={() => navigate('/account')}
            >
              Go to Login
            </Button>
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
                <Lock className="w-8 h-8 text-primary" />
              </div>
              <h2 className="text-3xl font-bold text-foreground">Set New Password</h2>
              <p className="text-muted-foreground text-sm">
                Choose a strong password for your LocalLink account.
              </p>
            </div>

            <div className="rounded-3xl bg-card border-2 border-border shadow-lg p-8 md:p-10 space-y-5">
              {apiError && (
                <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                  {apiError}
                </div>
              )}

              {/* New Password */}
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-foreground">New Password</label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                  <Input
                    type="password"
                    placeholder="Min. 6 characters"
                    value={newPassword}
                    onChange={(e) => {
                      setNewPassword(e.target.value);
                      if (fieldErrors.newPassword) setFieldErrors((prev) => ({ ...prev, newPassword: undefined }));
                    }}
                    className={cn(
                      'pl-12 h-12 border-2 rounded-xl bg-white',
                      fieldErrors.newPassword ? 'border-red-400' : 'border-border'
                    )}
                  />
                </div>
                {fieldErrors.newPassword && (
                  <p className="text-xs text-red-600 pl-1">{fieldErrors.newPassword}</p>
                )}
              </div>

              {/* Confirm Password */}
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-foreground">Confirm Password</label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                  <Input
                    type="password"
                    placeholder="Repeat your new password"
                    value={confirmPassword}
                    onChange={(e) => {
                      setConfirmPassword(e.target.value);
                      if (fieldErrors.confirmPassword) setFieldErrors((prev) => ({ ...prev, confirmPassword: undefined }));
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                    className={cn(
                      'pl-12 h-12 border-2 rounded-xl bg-white',
                      fieldErrors.confirmPassword ? 'border-red-400' : 'border-border'
                    )}
                  />
                </div>
                {fieldErrors.confirmPassword && (
                  <p className="text-xs text-red-600 pl-1">{fieldErrors.confirmPassword}</p>
                )}
              </div>

              <Button
                onClick={handleSubmit}
                disabled={loading || !token}
                className="w-full h-12 rounded-full font-semibold mt-2"
              >
                {loading ? 'Resetting...' : 'Reset Password'}
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

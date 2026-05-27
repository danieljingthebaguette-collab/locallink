import { useEffect, useState } from 'react';
import { useLocation, useParams } from 'wouter';
import { Loader2 } from 'lucide-react';
import Logo from '@/components/Logo';

// This page handles /join/:slug
// It fetches the org details, stores them in sessionStorage, then sends the user to /account
export default function JoinPage() {
  const { slug } = useParams<{ slug: string }>();
  const [, navigate] = useLocation();
  const [error, setError] = useState('');

  useEffect(() => {
    if (!slug) { navigate('/account'); return; }

    fetch(`/api/join/${slug}`)
      .then(res => res.ok ? res.json() : Promise.reject(res.status))
      .then(link => {
        if (link.claimedAt) {
          // Already registered — just send them to login
          sessionStorage.removeItem('locallink_join');
          navigate('/account');
          return;
        }
        // Store the prefill data for the account page to pick up
        sessionStorage.setItem('locallink_join', JSON.stringify({
          slug: link.slug,
          orgName: link.orgName,
          category: link.category,
        }));
        navigate('/account');
      })
      .catch(status => {
        if (status === 404) setError('This join link doesn\'t exist or has expired.');
        else setError('Something went wrong. Please try again.');
      });
  }, [slug, navigate]);

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center space-y-4 max-w-sm">
          <Logo size={48} className="text-primary mx-auto" />
          <h2 className="text-xl font-bold text-foreground">Invalid Link</h2>
          <p className="text-muted-foreground text-sm">{error}</p>
          <button onClick={() => navigate('/account')} className="text-primary text-sm font-medium hover:underline">
            Go to sign up
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-center space-y-4">
        <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto" />
        <p className="text-muted-foreground text-sm">Setting up your account...</p>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Sign in with Google.
 *
 * Renders nothing at all unless the server says a client id is configured, so
 * this can ship long before anybody sets one up and the page looks exactly as
 * it does today until they do.
 *
 * The reason it earns its place is not that it saves a password. It is that
 * Google tells us the address is real, so nobody has to go and find our
 * verification email — the one that currently fails DMARC and may never arrive.
 * For somebody standing at an event who has just scanned a code, "check your
 * inbox" is the step where we lose them.
 */

declare global {
  interface Window { google?: any }
}

interface Props {
  /** Called with the finished user object once they are signed in. */
  onSignedIn: (user: any) => void;
  /** Google verified them but we still need an account type and birth year. */
  onNeedsProfile: (info: { credential: string; email: string; name: string | null }) => void;
  onError: (message: string) => void;
}

export default function GoogleSignIn({ onSignedIn, onNeedsProfile, onError }: Props) {
  const [clientId, setClientId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Google's script can simply not arrive -- an ad blocker, a school network,
  // an outage. Until the button is actually on screen we render nothing, or the
  // page shows a lone "or" divider hanging above an empty space.
  const [rendered, setRendered] = useState(false);
  const holder = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/auth/google/enabled')
      .then(r => (r.ok ? r.json() : { enabled: false }))
      .then(d => setClientId(d.enabled ? (d.clientId ?? 'on') : null))
      .catch(() => setClientId(null));
  }, []);

  useEffect(() => {
    if (!clientId || !holder.current) return;
    let cancelled = false;

    const send = async (credential: string) => {
      setBusy(true);
      try {
        const res = await fetch('/api/auth/google', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ credential }),
        });
        const d = await res.json();
        if (!res.ok) { onError(d.error || 'That did not work'); return; }
        // Verified, but we still need the two things Google cannot tell us.
        if (d.needsProfile) { onNeedsProfile({ credential, email: d.email, name: d.name }); return; }
        onSignedIn(d);
      } catch {
        onError('Could not reach Google just now');
      } finally { setBusy(false); }
    };

    const start = () => {
      if (cancelled || !window.google?.accounts?.id || !holder.current) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (r: any) => send(r.credential),
      });
      window.google.accounts.id.renderButton(holder.current, {
        theme: 'outline', size: 'large', width: 320, text: 'continue_with',
      });
      setRendered(true);
    };

    if (window.google?.accounts?.id) { start(); return () => { cancelled = true; }; }

    // Loaded here rather than in index.html so the script is never fetched at
    // all for people who will never see the button.
    const existing = document.getElementById('gsi-script') as HTMLScriptElement | null;
    if (existing) { existing.addEventListener('load', start); return () => { cancelled = true; }; }
    const script = document.createElement('script');
    script.id = 'gsi-script';
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = start;
    document.head.appendChild(script);
    return () => { cancelled = true; };
  }, [clientId, onSignedIn, onNeedsProfile, onError]);

  if (!clientId) return null;

  return (
    <div className={rendered || busy ? 'space-y-3' : ''}>
      <div className="flex justify-center">
        {busy
          ? <Button disabled className="w-full rounded-xl"><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Signing you in…</Button>
          : <div ref={holder} />}
      </div>
      {/* Only once there is something above it to divide from. */}
      {(rendered || busy) && (
        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-border" />
          <span className="text-xs text-muted-foreground">or</span>
          <div className="h-px flex-1 bg-border" />
        </div>
      )}
    </div>
  );
}

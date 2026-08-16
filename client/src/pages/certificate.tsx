import { useEffect, useState } from 'react';
import { useParams, useLocation } from 'wouter';
import { Loader2, Printer, Award, X } from 'lucide-react';
import Logo from '@/components/Logo';
import { Button } from '@/components/ui/button';
import { hasAppHistory } from '@/lib/history';

interface Certificate {
  id: string;
  tier: number;
  decidedAt: string;
  hoursAtApply: number;
  volunteerName: string;
  orgName: string;
}

/** The issued certificate, as a page meant to be printed.
 *
 * Landscape-ish proportions, one statement, no navigation — a certificate
 * that looks like a web page isn't worth printing. The organization's name
 * carries the sentence because they're the ones who verified the hours;
 * LocalLink only sits in the footer as the issuer of record. */
export default function CertificatePage() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const [cert, setCert] = useState<Certificate | null>(null);
  const [loading, setLoading] = useState(true);
  // 410 means it was genuinely issued and has since been retired, which is a
  // different thing to say than "this link was never real".
  const [retired, setRetired] = useState(false);

  /** Leaving.
   *
   * This page renders without site navigation, so without an explicit exit
   * the only way out is the browser's own back button — and a volunteer who
   * tapped "View" from their profile has no way back to it.
   *
   * Two audiences, two right answers. Someone who arrived from inside the
   * site should land back where they were, so history.back() returns them to
   * the exact scroll position on their profile. Someone who opened the link
   * directly has nothing behind them but the blank page the tab started on,
   * and back would drop them off the site entirely — verified, it really
   * does — so they go to the board instead. */
  const close = () => {
    if (hasAppHistory()) window.history.back();
    else navigate('/');
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Not while a print dialog or some other overlay owns the keyboard.
      if (e.key === 'Escape' && !e.defaultPrevented) close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/certificates/${params.id}`)
      .then(async r => {
        if (r.ok) return r.json();
        if (r.status === 410 && !cancelled) setRetired(true);
        return Promise.reject();
      })
      .then(d => { if (!cancelled) { setCert(d); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [params.id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!cert) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4 text-center">
        <div className="max-w-sm">
          <p className="font-heading font-bold text-xl text-foreground mb-2">
            {retired ? 'This certificate is no longer valid' : 'No certificate here'}
          </p>
          <p className="text-muted-foreground text-sm mb-6">
            {retired
              ? 'It was issued, but the organization has since adjusted the hours behind it. Contact the organization if you think that\u2019s a mistake.'
              : "This certificate hasn't been issued, or the link is wrong."}
          </p>
          {/* A dead end needs an exit more than a working page does. */}
          <Button onClick={close} variant="outline" className="rounded-full px-6">
            <X className="w-4 h-4 mr-1.5" /> Close
          </Button>
        </div>
      </div>
    );
  }

  const issued = new Date(cert.decidedAt).toLocaleDateString(undefined, {
    month: 'long', day: 'numeric', year: 'numeric',
  });

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 print:p-0 print:block">
      {/* Close on the left, actions on the right — and both gone on paper. */}
      <div className="w-full max-w-3xl flex items-center justify-between gap-3 mb-4 print:hidden">
        <Button onClick={close} variant="outline" size="sm" className="rounded-full text-xs" aria-label="Close certificate">
          <X className="w-3.5 h-3.5 mr-1.5" /> Close
        </Button>
        <Button onClick={() => window.print()} variant="outline" size="sm" className="rounded-full text-xs">
          <Printer className="w-3.5 h-3.5 mr-1.5" /> Print
        </Button>
      </div>

      <div className="w-full max-w-3xl rounded-3xl border-2 border-primary/25 bg-card px-8 py-14 md:px-16 md:py-20 text-center print:border print:rounded-none print:shadow-none">
        <div className="flex items-center justify-center gap-2 mb-10">
          <Logo size={30} />
          <span className="font-heading font-bold text-foreground">LocalLink</span>
        </div>

        <div className="w-14 h-14 rounded-full bg-amber-500/15 flex items-center justify-center mx-auto mb-6">
          <Award className="w-7 h-7 text-amber-600 dark:text-amber-400" />
        </div>

        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
          Certificate of Volunteer Service
        </p>

        <h1 className="font-heading font-bold text-3xl md:text-5xl text-foreground mt-6 mb-6">
          {cert.volunteerName}
        </h1>

        <p className="text-muted-foreground leading-relaxed max-w-xl mx-auto">
          has completed <span className="font-bold text-foreground tabular-nums">{cert.tier} hours</span> of
          verified volunteer service with
        </p>
        <p className="font-heading font-bold text-xl md:text-2xl text-foreground mt-3">{cert.orgName}</p>

        <div className="mt-12 pt-8 border-t border-border max-w-lg mx-auto">
          <p className="text-sm text-muted-foreground">Issued {issued}</p>
          <p className="text-[11px] text-muted-foreground mt-3 leading-relaxed">
            Hours were recorded by the organization at the event and verified through LocalLink.
            Volunteers cannot enter or edit their own hours.
          </p>
        </div>
      </div>
    </div>
  );
}

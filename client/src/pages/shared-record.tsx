import { useEffect, useState } from 'react';
import { useParams, useLocation } from 'wouter';
import { Loader2, ShieldCheck, Printer } from 'lucide-react';
import Logo from '@/components/Logo';
import { Button } from '@/components/ui/button';
import { OrgBreakdown, EventHistory, OverallMilestones, fmtDate, type RecordOrg, type RecordEvent } from '@/components/VolunteerRecord';

interface SharedRecord {
  username: string;
  memberSince: string;
  totalHours: number;
  totalEvents: number;
  overallMilestones?: number[];
  orgs: RecordOrg[];
  events: RecordEvent[];
}

/** What a school counselor opens.
 *
 * No login, no nav, no site chrome — someone arriving here has been handed a
 * link and wants one question answered: are these hours real. So the page
 * leads with the number and where it came from, and says plainly that the
 * organizations confirmed it rather than the student typing it in.
 *
 * Deliberately a record, not an achievement page: milestones appear beside
 * the organizations that granted them, but the ledger is the substance. */
export default function SharedRecord() {
  const params = useParams<{ token: string }>();
  const [, navigate] = useLocation();
  const [data, setData] = useState<SharedRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/profile/shared/${params.token}`)
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(d => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch(() => { if (!cancelled) { setNotFound(true); setLoading(false); } });
    return () => { cancelled = true; };
  }, [params.token]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (notFound || !data) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4 text-center">
        <div className="max-w-sm">
          <p className="font-heading font-bold text-xl text-foreground mb-2">This link isn't active</p>
          <p className="text-muted-foreground text-sm mb-6">
            The volunteer may have turned it off. Ask them for a new one.
          </p>
          {/* Someone who followed a dead link has nowhere to go otherwise —
              this page renders without site navigation. */}
          <Button onClick={() => navigate('/about')} variant="outline" className="rounded-full px-6">
            What is LocalLink?
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background py-10 px-4 print:py-0">
      <main className="container mx-auto max-w-2xl">
        {/* Masthead — on paper this is what says where the record came from */}
        <div className="flex items-center justify-between gap-4 mb-8">
          <a
            href="/about"
            onClick={(e) => { e.preventDefault(); navigate('/about'); }}
            className="flex items-center gap-2.5 rounded-xl -m-1 p-1 hover:bg-secondary/50 transition-colors print:hover:bg-transparent"
          >
            <Logo size={34} />
            <div className="text-left">
              <p className="font-heading font-bold text-foreground leading-none">LocalLink</p>
              <p className="text-[11px] text-muted-foreground mt-1">Verified volunteer record</p>
            </div>
          </a>
          <Button
            onClick={() => window.print()}
            variant="outline" size="sm"
            className="rounded-full text-xs print:hidden"
          >
            <Printer className="w-3.5 h-3.5 mr-1.5" /> Print
          </Button>
        </div>

        <div className="rounded-3xl border border-border bg-card p-6 md:p-8 mb-6 print:border-0 print:p-0">
          <h1 className="font-heading font-bold text-2xl md:text-3xl text-foreground">{data.username}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            On LocalLink since {fmtDate(data.memberSince.slice(0, 10))}
          </p>

          <div className="flex flex-wrap gap-8 mt-6">
            <div>
              <p className="font-heading font-bold text-4xl text-foreground tabular-nums">{data.totalHours}</p>
              <p className="text-xs text-muted-foreground font-medium mt-1">Verified hours</p>
            </div>
            <div>
              <p className="font-heading font-bold text-4xl text-foreground tabular-nums">{data.totalEvents}</p>
              <p className="text-xs text-muted-foreground font-medium mt-1">Events completed</p>
            </div>
            <div>
              <p className="font-heading font-bold text-4xl text-foreground tabular-nums">{data.orgs.length}</p>
              <p className="text-xs text-muted-foreground font-medium mt-1">
                {data.orgs.length === 1 ? 'Organization' : 'Organizations'}
              </p>
            </div>
          </div>

          {/* The claim that makes the rest worth reading */}
          <div className="mt-6 rounded-2xl border border-border bg-secondary/30 p-4 flex items-start gap-3">
            <ShieldCheck className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
            <p className="text-sm text-muted-foreground leading-relaxed">
              Every hour below was recorded by the organization that hosted the event — either
              from a check-in at the event itself or confirmed by the organizer afterward.
              Volunteers cannot enter or edit their own hours on LocalLink.
            </p>
          </div>
        </div>

        {(data.overallMilestones?.length ?? 0) > 0 && (
          <section className="mb-6">
            <h2 className="font-heading font-bold text-lg text-foreground mb-3">Total service</h2>
            <OverallMilestones totalHours={data.totalHours} milestones={data.overallMilestones ?? []} />
          </section>
        )}

        {data.orgs.length > 0 && (
          <section className="mb-6">
            <h2 className="font-heading font-bold text-lg text-foreground mb-3">Organizations</h2>
            <OrgBreakdown orgs={data.orgs} />
          </section>
        )}

        {data.events.length > 0 && (
          <section className="mb-6">
            <h2 className="font-heading font-bold text-lg text-foreground mb-3">
              Events ({data.events.length})
            </h2>
            <EventHistory events={data.events} />
          </section>
        )}

        {data.events.length === 0 && (
          <p className="text-muted-foreground text-center py-10">No verified hours recorded yet.</p>
        )}

        <p className="text-[11px] text-muted-foreground text-center mt-8">
          Generated by LocalLink · {new Date().toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
        </p>
      </main>
    </div>
  );
}

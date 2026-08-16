import { Award, Building2, Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface RecordOrg {
  hostId?: string;
  hostName: string;
  hours: number;
  events: number;
  milestones: number[];
}

export interface RecordEvent {
  title: string;
  hostName: string;
  date: string;
  hours: number;
  category?: string;
}

/** Standard tiers, identical at every organization — that sameness is what
 * makes a milestone mean anything outside the site. */
export const MILESTONE_TIERS = [10, 25, 50, 100];

export function fmtDate(d: string): string {
  // Dates are stored as plain YYYY-MM-DD. Appending a time keeps the browser
  // from reading a bare date as UTC and rendering the day before.
  return new Date(`${d}T00:00:00`).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

/** One earned tier. The organization's name sits above these, so the badge
 * reads as something they granted rather than a platform sticker. */
export function MilestoneBadge({ tier, compact }: { tier: number; compact?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full font-bold whitespace-nowrap',
        'bg-amber-500/15 text-amber-700 dark:text-amber-400',
        compact ? 'text-[10px] px-2 py-0.5' : 'text-xs px-2.5 py-1'
      )}
    >
      <Award className={compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
      {tier} hrs
    </span>
  );
}

/** Hours grouped by organization, with whatever tiers that org's hours have
 * reached. Shared by the volunteer's own profile and the link they hand to
 * a school, so the two can never drift apart. */
export function OrgBreakdown({ orgs, onOrgClick }: { orgs: RecordOrg[]; onOrgClick?: (id: string) => void }) {
  if (!orgs.length) return null;
  return (
    <ul className="rounded-2xl border border-border divide-y divide-border overflow-hidden">
      {orgs.map(o => {
        const clickable = !!(onOrgClick && o.hostId);
        return (
          <li key={o.hostName} className="px-4 py-3.5">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                {clickable ? (
                  <button
                    onClick={() => onOrgClick!(o.hostId!)}
                    className="font-semibold text-foreground hover:underline text-left"
                  >
                    {o.hostName}
                  </button>
                ) : (
                  <p className="font-semibold text-foreground">{o.hostName}</p>
                )}
                <p className="text-xs text-muted-foreground mt-0.5 tabular-nums">
                  {o.hours} hrs · {o.events} {o.events === 1 ? 'event' : 'events'}
                </p>
              </div>
              {o.milestones.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {o.milestones.map(t => <MilestoneBadge key={t} tier={t} compact />)}
                </div>
              )}
            </div>
            {/* Progress toward the next tier — the point of a milestone is
                knowing how far off the next one is. */}
            {(() => {
              const next = MILESTONE_TIERS.find(t => o.hours < t);
              if (!next) return null;
              const prev = [...MILESTONE_TIERS].reverse().find(t => o.hours >= t) ?? 0;
              const pct = Math.max(2, Math.round(((o.hours - prev) / (next - prev)) * 100));
              return (
                <div className="mt-2.5">
                  <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                    <div className="h-full rounded-full bg-amber-500/60" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1 tabular-nums">
                    {Math.round((next - o.hours) * 10) / 10} hrs to {next}
                  </p>
                </div>
              );
            })()}
          </li>
        );
      })}
    </ul>
  );
}

/** Every credited event, newest first. */
export function EventHistory({ events, limit }: { events: RecordEvent[]; limit?: number }) {
  const shown = limit ? events.slice(0, limit) : events;
  if (!shown.length) return null;
  return (
    <ul className="rounded-2xl border border-border divide-y divide-border overflow-hidden">
      {shown.map((e, i) => (
        <li key={`${e.title}-${e.date}-${i}`} className="flex items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="font-medium text-foreground truncate">{e.title}</p>
            <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
              <Building2 className="w-3 h-3 flex-shrink-0" />
              <span className="truncate">{e.hostName}</span>
              <span aria-hidden="true">·</span>
              <Calendar className="w-3 h-3 flex-shrink-0" />
              {fmtDate(e.date)}
            </p>
          </div>
          <span className="text-sm font-bold text-foreground tabular-nums flex-shrink-0">{e.hours} hrs</span>
        </li>
      ))}
    </ul>
  );
}

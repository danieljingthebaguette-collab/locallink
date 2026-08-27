import { Category } from './mockData';

// Flat fills, not gradients. These stand in for a post's photo, so their whole
// job is to say which category it is -- a same-hue ramp added nothing except
// the look of a generated site.
const CATEGORY_COLOR_MAP: Record<Category, string> = {
  'volunteer': 'bg-cat-vol',
  'education': 'bg-cat-edu',
  'fitness': 'bg-cat-sports',
  'community': 'bg-cat-community',
  'environment': 'bg-cat-environment',
};

const CATEGORY_MODAL_MAP: Record<Category, string> = {
  'volunteer': 'bg-cat-vol',
  'education': 'bg-cat-edu',
  'fitness': 'bg-cat-sports',
  'community': 'bg-cat-community',
  'environment': 'bg-cat-environment',
};

const CATEGORY_BORDER_MAP: Record<Category, string> = {
  'volunteer': 'border-cat-vol',
  'education': 'border-cat-edu',
  'fitness': 'border-cat-sports',
  'community': 'border-cat-community',
  'environment': 'border-cat-environment',
};

export const getCategoryBorder = (category: Category): string => {
  return CATEGORY_BORDER_MAP[category] || 'border-primary';
};

export const getCategoryColor = (category: Category): string => {
  return CATEGORY_COLOR_MAP[category] || 'bg-primary';
};

export const getModalGradient = (category: Category): string => {
  return CATEGORY_MODAL_MAP[category] || 'bg-primary';
};

export const getCategoryLabel = (category: Category): string => {
  return category.charAt(0).toUpperCase() + category.slice(1);
};

/**
 * Which of the questionnaire's three coarse time buckets a post falls into --
 * weekday daytime, weekday evening, or weekend. Not a real calendar: just
 * enough to answer "would this actually fit someone's schedule" without
 * asking them to fill in a full week grid.
 *
 * A recurring post's own weekly slot is what's checked, not "today" -- it
 * happens every week, so there's no single date to derive a bucket from. A
 * one-time post uses its actual date and hour. Mirrors the exact three ids
 * in VALID_AVAILABILITY on the server and AVAILABILITY_OPTIONS in
 * mockData.ts; all three must stay in sync.
 */
export function getPostTimeBucket(
  opp: { date: string; isRecurring?: boolean; recurringDay?: number; recurringTime?: string },
): 'weekday-day' | 'weekday-evening' | 'weekend' | null {
  let dayOfWeek: number;
  let hour: number;
  if (opp.isRecurring && opp.recurringDay !== undefined && opp.recurringTime) {
    dayOfWeek = opp.recurringDay;
    hour = Number(opp.recurringTime.split(':')[0]);
  } else {
    const d = new Date(opp.date);
    if (Number.isNaN(d.getTime())) return null;
    dayOfWeek = d.getDay();
    hour = d.getHours();
  }
  if (dayOfWeek === 0 || dayOfWeek === 6) return 'weekend';
  return hour >= 17 ? 'weekday-evening' : 'weekday-day';
}

/** Everything the onboarding questionnaire can now say a volunteer prefers. */
export interface VolunteerPrefs {
  interests?: string[] | null;
  towns?: string[] | null;
  availability?: string[] | null;
}

/**
 * How well a post matches a volunteer's stated preferences.
 *
 * The onboarding questionnaire promises "opportunities that actually fit",
 * which for a long time was a promise nothing kept -- the answers were
 * written to the database and never read back. This is that read side,
 * covering all three preferences the questionnaire now collects.
 *
 * Field tags and interests come from the same FIELD_TAGS list by design, so
 * matching is a plain set intersection rather than anything fuzzy. Category
 * is counted too, since someone who said "Education" should match education
 * posts that carry no tags at all. Town and availability are each worth one
 * point on a match, same weight as a single tag -- none of the three signals
 * is treated as more decisive than the others.
 */
export function getMatchScore(
  opp: { tags?: string[] | null; category: Category; town?: string | null; date: string; isRecurring?: boolean; recurringDay?: number; recurringTime?: string },
  prefs: VolunteerPrefs,
): number {
  let n = 0;

  const interests = prefs.interests;
  if (interests && interests.length > 0) {
    const wanted = new Set(interests.map(i => i.toLowerCase()));
    for (const tag of opp.tags ?? []) {
      if (wanted.has(tag.toLowerCase())) n++;
    }
    if (wanted.has(getCategoryLabel(opp.category).toLowerCase())) n++;
  }

  if (prefs.towns && prefs.towns.length > 0 && opp.town && prefs.towns.includes(opp.town)) {
    n++;
  }

  if (prefs.availability && prefs.availability.length > 0) {
    const bucket = getPostTimeBucket(opp);
    if (bucket && prefs.availability.includes(bucket)) n++;
  }

  return n;
}

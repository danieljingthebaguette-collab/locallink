import { Category, ActivityCategory, LegacyCategory, ACTIVITY_CATEGORIES } from './mockData';

// Flat fills, not gradients. These stand in for a post's photo, so their whole
// job is to say which category it is -- a same-hue ramp added nothing except
// the look of a generated site.
// Each legacy category hands its colour to the activity that replaced it --
// education/teaching keep the teal, environment/hands-on keep the green,
// fitness/events keep the coral, community/care keep the purple, and the old
// catch-all's blue goes to backstage. That is why no palette value changed:
// during the changeover a green card still means roughly the same thing
// whether it is labelled ENVIRONMENT or HANDS-ON.
const CATEGORY_COLOR_MAP: Record<Category, string> = {
  'hands-on': 'bg-cat-environment',
  'teaching': 'bg-cat-edu',
  'events': 'bg-cat-sports',
  'care': 'bg-cat-community',
  'backstage': 'bg-cat-vol',
  // legacy
  'volunteer': 'bg-cat-vol',
  'education': 'bg-cat-edu',
  'fitness': 'bg-cat-sports',
  'community': 'bg-cat-community',
  'environment': 'bg-cat-environment',
};

const CATEGORY_MODAL_MAP: Record<Category, string> = CATEGORY_COLOR_MAP;

const CATEGORY_BORDER_MAP: Record<Category, string> = {
  'hands-on': 'border-cat-environment',
  'teaching': 'border-cat-edu',
  'events': 'border-cat-sports',
  'care': 'border-cat-community',
  'backstage': 'border-cat-vol',
  // legacy
  'volunteer': 'border-cat-vol',
  'education': 'border-cat-edu',
  'fitness': 'border-cat-sports',
  'community': 'border-cat-community',
  'environment': 'border-cat-environment',
};

/**
 * Which activity filter a legacy post answers to. Nothing is written back --
 * the post keeps its own label on the card -- but without this an existing
 * post would match no filter chip at all and only ever surface under "All",
 * which on a board that is mostly legacy posts reads as a broken filter.
 *
 * 'volunteer' is a genuine guess: it was the catch-all, so its posts could be
 * anything. Hands-On is the likeliest home for general help.
 */
const LEGACY_TO_ACTIVITY: Record<LegacyCategory, ActivityCategory> = {
  'environment': 'hands-on',
  'volunteer': 'hands-on',
  'education': 'teaching',
  'fitness': 'events',
  'community': 'care',
};

/** The activity a post filters under, whichever taxonomy it was published in. */
export const getFilterCategory = (category: Category): ActivityCategory =>
  (LEGACY_TO_ACTIVITY as Record<string, ActivityCategory>)[category] ?? (category as ActivityCategory);

const CATEGORY_LABELS: Record<Category, string> = {
  'hands-on': 'Hands-On',
  'teaching': 'Teaching & Mentoring',
  'events': 'Events & Hosting',
  'care': 'Care & Company',
  'backstage': 'Behind the Scenes',
  // legacy -- unchanged, so an existing post reads exactly as it was published
  'volunteer': 'Volunteer',
  'education': 'Education',
  'fitness': 'Fitness',
  'community': 'Community',
  'environment': 'Environment',
};

/**
 * Faint tinted-chip variant of the category colour, for the admin list. It
 * replaces an if-chain that named only the five legacy categories, so every
 * new one fell through its final else and came out green.
 *
 * Written out as whole literal class strings on purpose: Tailwind generates
 * CSS by scanning source for complete class names, so a composed
 * `bg-${x}/10` compiles to nothing at all and the chip renders unstyled.
 */
const CATEGORY_TINT_MAP: Record<Category, string> = {
  'hands-on':  'bg-cat-environment/10 text-cat-environment',
  'teaching':  'bg-cat-edu/10 text-cat-edu',
  'events':    'bg-cat-sports/10 text-cat-sports',
  'care':      'bg-cat-community/10 text-cat-community',
  'backstage': 'bg-cat-vol/10 text-cat-vol',
  // legacy
  'volunteer':   'bg-cat-vol/10 text-cat-vol',
  'education':   'bg-cat-edu/10 text-cat-edu',
  'fitness':     'bg-cat-sports/10 text-cat-sports',
  'community':   'bg-cat-community/10 text-cat-community',
  'environment': 'bg-cat-environment/10 text-cat-environment',
};

export const getCategoryTint = (category: Category): string =>
  CATEGORY_TINT_MAP[category] ?? 'bg-primary/10 text-primary';

export const getCategoryBorder = (category: Category): string => {
  return CATEGORY_BORDER_MAP[category] || 'border-primary';
};

export const getCategoryColor = (category: Category): string => {
  return CATEGORY_COLOR_MAP[category] || 'bg-primary';
};

export const getModalGradient = (category: Category): string => {
  return CATEGORY_MODAL_MAP[category] || 'bg-primary';
};

/**
 * Options for a category <select> when editing an existing post: the five
 * activities, plus the post's own legacy category when it still has one.
 *
 * Without the second part the dropdown holds no option matching the post's
 * actual value, so the browser renders the first one as selected and the
 * control confidently displays a category the post is not in -- while leaving
 * the real value untouched underneath if nobody opens it.
 */
export const getEditCategoryOptions = (current: Category): { value: Category; label: string }[] => {
  const opts: { value: Category; label: string }[] =
    ACTIVITY_CATEGORIES.map(v => ({ value: v, label: getCategoryLabel(v) }));
  if (!ACTIVITY_CATEGORIES.includes(current as ActivityCategory)) {
    opts.push({ value: current, label: `${getCategoryLabel(current)} (original)` });
  }
  return opts;
};

export const getCategoryLabel = (category: Category): string => {
  // Was charAt(0).toUpperCase() + slice(1), which would render 'hands-on' as
  // "Hands-on" and 'backstage' as "Backstage" rather than "Behind the Scenes".
  return CATEGORY_LABELS[category] ?? category;
};

/**
 * Is this an ongoing role rather than a one-time event?
 *
 * Worth one shared helper because of what's underneath it: `date` is NOT NULL
 * on the opportunities table, so a role -- which has no date -- stores its own
 * creation time there to satisfy the column. That value is always in the past,
 * which means every `new Date(o.date) < new Date()` in the codebase silently
 * answers "yes, ended" for every role ever posted. Anything reading `date`
 * has to ask this first.
 */
export const isRolePost = (o: { commitmentType?: string | null }): boolean =>
  (o.commitmentType ?? 'event') === 'role';

/**
 * Has this post's date gone by? The single answer to "is it over", so the
 * three things that are never past -- roles, recurring posts, and anything
 * whose date won't parse -- are excluded in one place instead of in each
 * caller's own condition.
 */
export const hasEnded = (o: { date: string; commitmentType?: string | null; isRecurring?: boolean }): boolean => {
  if (isRolePost(o) || o.isRecurring) return false;
  const t = new Date(o.date).getTime();
  return !Number.isNaN(t) && t < Date.now();
};

/**
 * Which of the questionnaire's three coarse time buckets a post falls into --
 * weekday daytime, weekday evening, or weekend. Not a real calendar: just
 * enough to answer "would this actually fit someone's schedule" without
 * asking them to fill in a full week grid.
 *
 * A recurring post's own weekly slot is what's checked, not "today" -- it
 * happens every week, so there's no single date to derive a bucket from. A
 * one-time post uses its actual date and hour. A role gets no bucket at all:
 * its stored date is the moment it was published, so deriving one would
 * score an ongoing commitment as a "weekend" match purely because the
 * organization happened to hit Publish on a Saturday. Mirrors the exact
 * three ids in VALID_AVAILABILITY on the server and AVAILABILITY_OPTIONS in
 * mockData.ts; all three must stay in sync.
 */
export function getPostTimeBucket(
  opp: { date: string; commitmentType?: string | null; isRecurring?: boolean; recurringDay?: number; recurringTime?: string },
): 'weekday-day' | 'weekday-evening' | 'weekend' | null {
  if (isRolePost(opp)) return null;
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
  majors?: string | null;
}

// Words too short or too common to mean anything on their own -- without this,
// someone who wrote "art" would match any post whose description happens to
// contain "start" or "part", and "and"/"the"/"for" would match everything.
// Four characters is a blunt line, not a real stopword list, but it kills the
// worst false positives without needing one.
const MAJOR_STOPWORDS = new Set(['this', 'that', 'with', 'from', 'undecided', 'still', 'maybe']);

/**
 * Splits a free-text "majors" answer into words worth matching against a
 * post. Free text, not a whitelist like interests/towns/availability -- there
 * is no fixed list of majors to constrain it to -- so this is the one signal
 * in getMatchScore that is a real substring search rather than a set
 * intersection, and the one most likely to miss a real match or catch a
 * coincidental one. "Biology" matching a post that happens to mention
 * biology is a reasonable trade for not requiring a curated majors list that
 * would need maintaining forever.
 */
function majorWords(majors: string): string[] {
  return majors.toLowerCase().split(/[^a-z]+/).filter(w => w.length >= 4 && !MAJOR_STOPWORDS.has(w));
}

/** A tag as the two sides can be compared: no leading emoji, no case.
 *  Every FIELD_TAGS entry starts with an ASCII letter, so trimming to the
 *  first one is enough and avoids the /u flag this build target rejects. */
function normaliseTag(t: string): string {
  return t.replace(/^[^A-Za-z0-9]+/, '').toLowerCase();
}

/**
 * How well a post matches a volunteer's stated preferences.
 *
 * The onboarding questionnaire promises "opportunities that actually fit",
 * which for a long time was a promise nothing kept -- the answers were
 * written to the database and never read back. This is that read side,
 * covering every preference the questionnaire now collects.
 *
 * Field tags and interests come from the same FIELD_TAGS list by design, so
 * that match is a plain set intersection rather than anything fuzzy -- but
 * only for posts written against the current list. Posts from before it
 * stored the label with an emoji glued to the front ("🌿 Environment"),
 * which no questionnaire answer can ever equal, so every one of those posts
 * scored zero on interests no matter what someone picked. normaliseTag drops
 * that prefix on both sides so the old posts match on the same terms as new
 * ones, without rewriting anyone's data. Category
 * is counted too, since someone who said "Education" should match education
 * posts that carry no tags at all. Town, availability, and majors are each
 * worth one point on a match, same weight as a single tag -- none of the
 * signals is treated as more decisive than the others.
 */
export function getMatchScore(
  opp: { title: string; description: string; tags?: string[] | null; category: Category; town?: string | null; date: string; commitmentType?: string | null; isRecurring?: boolean; recurringDay?: number; recurringTime?: string },
  prefs: VolunteerPrefs,
): number {
  let n = 0;

  const interests = prefs.interests;
  if (interests && interests.length > 0) {
    const wanted = new Set(interests.map(normaliseTag));
    for (const tag of opp.tags ?? []) {
      if (wanted.has(normaliseTag(tag))) n++;
    }
    if (wanted.has(normaliseTag(getCategoryLabel(opp.category)))) n++;
  }

  if (prefs.towns && prefs.towns.length > 0 && opp.town && prefs.towns.includes(opp.town)) {
    n++;
  }

  if (prefs.availability && prefs.availability.length > 0) {
    const bucket = getPostTimeBucket(opp);
    if (bucket && prefs.availability.includes(bucket)) n++;
  }

  if (prefs.majors && prefs.majors.trim()) {
    const words = majorWords(prefs.majors);
    if (words.length > 0) {
      const haystack = `${opp.title} ${opp.description} ${(opp.tags ?? []).join(' ')} ${getCategoryLabel(opp.category)}`.toLowerCase();
      if (words.some(w => haystack.includes(w))) n++;
    }
  }

  return n;
}

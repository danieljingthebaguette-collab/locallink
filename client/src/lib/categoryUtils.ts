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
 * How many of a volunteer's stated interests a post matches.
 *
 * The onboarding questionnaire promises "opportunities that actually fit", and
 * until now nothing read the answers back -- they were written to the database
 * and forgotten. This is the read side of that promise.
 *
 * Field tags and interests come from the same FIELD_TAGS list by design, so
 * matching is a plain set intersection rather than anything fuzzy. Category is
 * counted too, since someone who said "Education" should match education posts
 * that carry no tags at all.
 */
export function countInterestMatches(
  opp: { tags?: string[] | null; category: Category },
  interests: string[] | null | undefined,
): number {
  if (!interests || interests.length === 0) return 0;
  const wanted = new Set(interests.map(i => i.toLowerCase()));
  let n = 0;
  for (const tag of opp.tags ?? []) {
    if (wanted.has(tag.toLowerCase())) n++;
  }
  if (wanted.has(getCategoryLabel(opp.category).toLowerCase())) n++;
  return n;
}

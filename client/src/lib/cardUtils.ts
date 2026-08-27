const CARD_SIZE_THRESHOLDS = {
  VERY_LARGE: 30,
  LARGE: 15,
} as const;

/**
 * Returns a grid cell size based on popularity.
 * Higher popularity = larger card, reflecting engagement visually.
 */
// IMPORTANT: card widths are 1 or 2 columns. The board grid must stay at
// md:grid-cols-4 — adding a 5th column creates unfillable 1-col gaps (2+2≠5).
export const getCardSize = (popularity: number): string => {
  if (popularity >= CARD_SIZE_THRESHOLDS.VERY_LARGE) return 'md:col-span-2 md:row-span-2';
  if (popularity >= CARD_SIZE_THRESHOLDS.LARGE)      return 'md:col-span-2 md:row-span-1';
  return 'md:col-span-1 md:row-span-1';
};

/**
 * Large cards (for showing hero images) are determined by popularity.
 */
export const isLargeCard = (popularity: number): boolean => {
  return popularity >= CARD_SIZE_THRESHOLDS.LARGE;
};

/**
 * Whether a card is the full 2x2 tile, and so has the room to carry the
 * description, host, location and duration.
 *
 * Deliberately not isLargeCard: that one is true from LARGE upward, which
 * lumps the 2x1 in with the 2x2. A 2x1 is half the height, so the description
 * it was being given had to be clamped to two lines and pushed the location
 * and duration off the bottom edge. The board reads better when the smaller
 * two tiles answer only "what is this and when" -- category, title, tags, and
 * the recurring slot -- and leave the detail to the post itself.
 */
export const isFullDetailCard = (popularity: number): boolean => {
  return popularity >= CARD_SIZE_THRESHOLDS.VERY_LARGE;
};

export const getTitleSize = (popularity: number): string => {
  return popularity >= CARD_SIZE_THRESHOLDS.VERY_LARGE ? 'text-3xl' : 'text-xl';
};

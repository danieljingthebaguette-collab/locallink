const CARD_SIZE_THRESHOLDS = {
  VERY_LARGE: 30,
  LARGE: 15,
} as const;

/**
 * Returns a grid cell size based on popularity.
 * Higher popularity = larger card, reflecting engagement visually.
 */
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

export const getTitleSize = (popularity: number): string => {
  return popularity >= CARD_SIZE_THRESHOLDS.VERY_LARGE ? 'text-3xl' : 'text-xl';
};

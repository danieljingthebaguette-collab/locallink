import { Category } from './mockData';

const CATEGORY_COLOR_MAP: Record<Category, string> = {
  'volunteer': 'from-cat-vol/80 to-cat-vol',
  'education': 'from-cat-edu/80 to-cat-edu',
  'sports': 'from-cat-sports/80 to-cat-sports',
  'community': 'from-cat-community/80 to-cat-community',
  'environment': 'from-cat-environment/80 to-cat-environment',
};

const CATEGORY_MODAL_MAP: Record<Category, string> = {
  'volunteer': 'from-cat-vol/90 to-cat-vol',
  'education': 'from-cat-edu/90 to-cat-edu',
  'sports': 'from-cat-sports/90 to-cat-sports',
  'community': 'from-cat-community/90 to-cat-community',
  'environment': 'from-cat-environment/90 to-cat-environment',
};

const CATEGORY_BORDER_MAP: Record<Category, string> = {
  'volunteer': 'border-cat-vol',
  'education': 'border-cat-edu',
  'sports': 'border-cat-sports',
  'community': 'border-cat-community',
  'environment': 'border-cat-environment',
};

const CATEGORY_EMOJI_MAP: Record<Category, string> = {
  'volunteer': '\u{1F91D}',
  'education': '\u{1F4DA}',
  'sports': '\u26BD',
  'community': '\u{1F3D8}\uFE0F',
  'environment': '\u{1F331}',
};

export const getCategoryBorder = (category: Category): string => {
  return CATEGORY_BORDER_MAP[category] || 'border-primary';
};

export const getCategoryColor = (category: Category): string => {
  return CATEGORY_COLOR_MAP[category] || 'from-primary/80 to-primary';
};

export const getModalGradient = (category: Category): string => {
  return CATEGORY_MODAL_MAP[category] || 'from-primary/80 to-primary';
};

export const getCategoryEmoji = (category: Category): string => {
  return CATEGORY_EMOJI_MAP[category] || '\u{1F4CC}';
};

export const getCategoryLabel = (category: Category): string => {
  return category.charAt(0).toUpperCase() + category.slice(1);
};

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

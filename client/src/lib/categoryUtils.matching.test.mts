/** Legacy posts store their field tag with an emoji prefix ("🌿 Environment")
 *  while the questionnaire offers the bare label ("Environment"). If the two
 *  are compared raw, every pre-existing post scores zero on interests and the
 *  questionnaire's whole promise quietly does nothing. Run: npx tsx <this file> */
import assert from 'node:assert';
import { getMatchScore } from './categoryUtils';

const post = {
  title: 'Harvest day', description: 'Pick produce', category: 'volunteer' as const,
  tags: ['🌿 Environment', '🍽️ Food & Hunger'], town: 'Princeton', date: '2026-10-01T14:00:00.000Z',
};
const prefs = { interests: ['Environment'], towns: [], availability: [], majors: null };

assert.ok(getMatchScore(post, prefs) > 0,
  'a legacy emoji-prefixed tag must still match the bare questionnaire answer');
assert.strictEqual(getMatchScore(post, { ...prefs, interests: ['Environment', 'Food & Hunger'] }), 2,
  'both emoji-prefixed tags must match');
assert.strictEqual(getMatchScore(post, { ...prefs, interests: ['Animals'] }), 0,
  'an unrelated interest must still not match');
assert.ok(getMatchScore({ ...post, tags: ['Environment'] }, prefs) > 0,
  'new-style tags without emoji must keep matching');
console.log('OK  categoryUtils matching: legacy and current tags both match');

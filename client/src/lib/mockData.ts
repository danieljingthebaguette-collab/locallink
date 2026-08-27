/**
 * What volunteers will actually be doing. Every option is a verb, which is the
 * whole point: the old set asked "what are you offering?" and listed
 * "Volunteer Hours" beside four topics, so on a volunteering site one option
 * was true of every post and absorbed nearly all of them. Removing it alone
 * would only have moved the catch-all to Community — a list stops collecting
 * everything in one bucket when no option is broader than the rest, not when
 * the broadest one is deleted.
 *
 * Cause now lives entirely in FIELD_TAGS, so the two axes stop competing:
 * a river cleanup is Hands-On, tagged Environment.
 */
export type ActivityCategory = 'hands-on' | 'teaching' | 'events' | 'care' | 'backstage';

/**
 * The categories posts used before the change. Nothing was migrated — existing
 * posts keep the label they were published with — so every colour, label and
 * filter lookup still has to answer for these.
 */
export type LegacyCategory = 'volunteer' | 'education' | 'fitness' | 'community' | 'environment';

export type Category = ActivityCategory | LegacyCategory;

/** Only these can be chosen for a new post; the legacy ones are read-only history. */
export const ACTIVITY_CATEGORIES: ActivityCategory[] = ['hands-on', 'teaching', 'events', 'care', 'backstage'];

// Fixed town list for post tagging and board filtering — the single source of
// truth for every town dropdown. Mirrored server-side as VALID_TOWNS in
// routes.ts (client and server don't share modules, same as VALID_CATEGORIES).
export const TOWNS = [
  'Montgomery/Skillman',
  'Hillsborough',
  'Princeton',
  'Bridgewater',
  'Somerville',
  'Franklin Township',
  'Manville',
  'Raritan',
  'Belle Mead/Rocky Hill',
  'Flemington',
] as const;

export interface Opportunity {
  id: string;
  title: string;
  description: string;
  category: Category;
  location: string;
  town?: string | null; // fixed-list town tag; null on posts created before the field existed
  date: string;
  duration: number;
  spots: number;
  spotsRemaining: number;
  spotsType: 'limited' | 'unlimited' | 'none';
  image?: string;
  hostId: string;
  hostName: string;
  signups: string[];
  popularity: number;
  tags: string[];
  createdAt: string;
  isAvailable?: boolean;  // true (default) = accepting sign-ups; false = closed by host
  adultsOnly?: boolean;   // organization marked this 18+; blocks signing up for known minors
  isRecurring?: boolean;  // true = repeats every week on recurringDay at recurringTime
  recurringDay?: number;  // 0 = Sunday … 6 = Saturday
  recurringTime?: string; // "HH:MM" (24-hour), e.g. "12:00"
  pinnedSize?: 'small' | 'medium' | 'large' | null; // admin-only card size override (null = auto)
  cardObjectPosition?: string | null;   // CSS object-position for the board card image
  modalObjectPosition?: string | null;  // CSS object-position for the post detail banner
  status?: 'pending' | 'approved' | 'denied'; // approval status (default 'approved' for existing posts)
  steps?: string[];  // Volunteer steps/instructions
  isFeatured?: boolean;
  hostVerified?: boolean;
  externalSignupUrl?: string | null;  // org's own registration page, if volunteers must sign up there instead
}

export interface AppUser {
  id: string;
  username: string;
  email: string;
  isAdmin: boolean;
  emailVerified: boolean;
  accountType: 'volunteer' | 'organization';
  verified?: boolean;
  banned?: boolean;
  notifyOnInterest?: boolean;
  notifyOnReopen?: boolean;
  profileImage?: string | null;
  createdAt: string;
  orgDescription?: string | null;
  orgWebsite?: string | null;
  orgEmail?: string | null;
  orgPhone?: string | null;
  emailReminders?: boolean;
  hasSeenWelcome?: boolean;
  unsubToken?: string | null;
  // Onboarding questionnaire -- volunteers only. onboardingCompletedAt is the
  // one field anything actually reads: null means the prompt is still owed,
  // regardless of whether this is a brand-new account or a five-month-old
  // one that skipped it every time.
  onboardingHoursSoFar?: number | null;
  onboardingInterests?: string[] | null;
  onboardingMajors?: string | null;
  onboardingGoalHours?: number | null;
  onboardingGoalEvents?: number | null;
  onboardingTowns?: string[] | null;
  onboardingAvailability?: string[] | null;
  onboardingCompletedAt?: string | null;
}

// Shared between the post-creation form (what field is this event in?) and
// the volunteer onboarding questionnaire (what do you enjoy?) -- one list,
// so an org's field tags and a volunteer's stated interests are directly
// comparable rather than two vocabularies that happen to look similar.
export const FIELD_TAGS = [
  'Environment',
  'Animals',
  'Food & Hunger',
  'Housing',
  'Health & Medical',
  'Emergency Services',
  'Senior Services',
  'Education',
  'Arts & Culture',
  'Sports & Fitness',
  'Faith & Spiritual',
  'Youth & Children',
  'Social Services',
  'Technology',
  'Tutoring',
  'Workforce Dev',
  'Civic Engagement',
  'Disability Services',
  'Cultural Diversity',
  'Mental Health',
  'Financial Aid',
  'Legal Aid',
  'Agriculture',
  'Transportation',
  'After-School',
  'Family Support',
  'Performing Arts',
  'Media',
  'Science & Research',
  'Conflict Resolution',
  'Global Outreach',
  'Events & Festivals',
  'History & Heritage',
  'Sustainability',
  'Community Dev',
  'Advocacy',
  'School Supplies',
  'Behavioral Health',
  'Public Safety',
  'Early Childhood',
  'Outdoor Education',
  'Maternal Health',
  'Peer Mentorship',
  'Digital Literacy',
  'Music',
  'Skilled Trades',
  'Urban Gardening',
  'Service Animals',
  'Chronic Illness',
  'Econ. Empowerment',
] as const;

// The onboarding questionnaire's availability answer. Three buckets, not a
// full weekly calendar -- coarse enough to actually be worth filling in, and
// matched against a post's own schedule by getPostTimeBucket in
// categoryUtils.ts. Mirrored server-side as VALID_AVAILABILITY in routes.ts;
// the id strings must stay identical across all three places, or an answer
// here silently stops matching anything.
export const AVAILABILITY_OPTIONS: { id: string; label: string }[] = [
  { id: 'weekday-day', label: 'Weekday daytime' },
  { id: 'weekday-evening', label: 'Weekday evenings' },
  { id: 'weekend', label: 'Weekends' },
];

/**
 * Board filter chips. Short labels, not the full category names — these sit in
 * a row that has to survive a phone screen, and the longer form is on the card
 * itself anyway.
 */
export const CATEGORIES: { value: Category | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'hands-on', label: 'Hands-On' },
  { value: 'teaching', label: 'Teaching' },
  { value: 'events', label: 'Events' },
  { value: 'care', label: 'Care' },
  { value: 'backstage', label: 'Backstage' },
];

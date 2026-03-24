export type Category = 'volunteer' | 'education' | 'fitness' | 'community' | 'environment';

export interface Opportunity {
  id: string;
  title: string;
  description: string;
  category: Category;
  location: string;
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
  isRecurring?: boolean;  // true = repeats every week on recurringDay at recurringTime
  recurringDay?: number;  // 0 = Sunday … 6 = Saturday
  recurringTime?: string; // "HH:MM" (24-hour), e.g. "12:00"
  pinnedSize?: 'small' | 'medium' | 'large' | null; // admin-only card size override (null = auto)
  cardObjectPosition?: string | null;   // CSS object-position for the board card image
  modalObjectPosition?: string | null;  // CSS object-position for the post detail banner
}

export interface AppUser {
  id: string;
  username: string;
  email: string;
  isAdmin: boolean;
  emailVerified: boolean;
  accountType: 'volunteer' | 'organization';
  banned?: boolean;
  notifyOnInterest?: boolean;
  notifyOnReopen?: boolean;
  profileImage?: string | null;
  createdAt: string;
}

export const SAMPLE_OPPORTUNITIES: Opportunity[] = [
  {
    id: '1',
    title: 'Community Clean-up',
    description: 'Join us for a community clean-up event at Lake Accotink Park. Help make our neighborhood cleaner and greener!',
    category: 'volunteer',
    location: 'Lake Accotink Park, Montgomery',
    date: '2026-02-15T09:00',
    duration: 3,
    spots: 50,
    spotsRemaining: 12,
    image: 'https://images.unsplash.com/photo-1618477388954-7852f32655ec?w=800',
    hostId: '1',
    hostName: 'EcoWarriors',
    signups: [],
    popularity: 38,
    spotsType: 'limited',
    tags: [],
    createdAt: new Date().toISOString()
  },
  {
    id: '2',
    title: 'Math Tutoring Session',
    description: 'Free tutoring for middle school students. Help students excel in mathematics!',
    category: 'education',
    location: 'Montgomery Public Library',
    date: '2026-02-18T14:00',
    duration: 2,
    spots: 20,
    spotsRemaining: 15,
    image: 'https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=800',
    hostId: '2',
    hostName: 'MathGenius',
    signups: [],
    popularity: 5,
    spotsType: 'limited',
    tags: [],
    createdAt: new Date().toISOString()
  },
  {
    id: '3',
    title: 'Youth Soccer Tournament',
    description: 'Coach and mentor young athletes at our annual youth soccer tournament!',
    category: 'fitness',
    location: 'Sports Complex',
    date: '2026-02-20T10:00',
    duration: 6,
    spots: 30,
    spotsRemaining: 8,
    image: 'https://images.unsplash.com/photo-1431324155629-1a6deb1dec8d?w=800',
    hostId: '3',
    hostName: 'SportsClub',
    signups: [],
    popularity: 22,
    spotsType: 'limited',
    tags: [],
    createdAt: new Date().toISOString()
  },
  {
    id: '4',
    title: 'Food Bank Packaging',
    description: 'Help package and distribute food to families in need in our community.',
    category: 'community',
    location: '123 Charity Street',
    date: '2026-02-17T08:00',
    duration: 4,
    spots: 100,
    spotsRemaining: 75,
    image: 'https://images.unsplash.com/photo-1593113598332-cd288d649433?w=800',
    hostId: '4',
    hostName: 'FoodForAll',
    signups: [],
    popularity: 25,
    spotsType: 'limited',
    tags: [],
    createdAt: new Date().toISOString()
  },
  {
    id: '5',
    title: 'Environmental Workshop',
    description: 'Learn about climate change and sustainable practices in this interactive workshop.',
    category: 'environment',
    location: 'Green Center',
    date: '2026-02-22T13:00',
    duration: 3,
    spots: 40,
    spotsRemaining: 22,
    image: 'https://images.unsplash.com/photo-1542601906990-b4d3fb778b09?w=800',
    hostId: '5',
    hostName: 'GreenFuture',
    signups: [],
    popularity: 18,
    spotsType: 'limited',
    tags: [],
    createdAt: new Date().toISOString()
  },
  {
    id: '6',
    title: 'Community Garden Setup',
    description: 'Help build and plant a new community garden in downtown Montgomery.',
    category: 'environment',
    location: 'Downtown Plaza',
    date: '2026-02-25T09:00',
    duration: 3,
    spots: 25,
    spotsRemaining: 10,
    image: 'https://images.unsplash.com/photo-1464226184884-fa280b87c399?w=800',
    hostId: '6',
    hostName: 'GreenThumb',
    signups: [],
    popularity: 15,
    spotsType: 'limited',
    tags: [],
    createdAt: new Date().toISOString()
  }
];

export const CATEGORIES: { value: Category | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'volunteer', label: 'Volunteer' },
  { value: 'education', label: 'Education' },
  { value: 'fitness', label: 'Sports' },
  { value: 'community', label: 'Community' },
  { value: 'environment', label: 'Environment' },
];

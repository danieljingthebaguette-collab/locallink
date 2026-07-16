import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Light guardrails on the location field — it renders as a Google Maps link,
// so catch obvious non-addresses (placeholder notes, schedule text) without
// blocking real-but-unusual addresses. Mirrored server-side in routes.ts.
const LOCATION_BLOCKLIST = ['will be given', 'sign up', 'tbd', 'beginning'];

export function getLocationError(location: string): string | null {
  const trimmed = location.trim();
  if (trimmed.length < 5) return 'Location must be at least 5 characters';
  if (trimmed.length > 100) return 'Location must be under 100 characters';
  const lower = trimmed.toLowerCase();
  if (LOCATION_BLOCKLIST.some(phrase => lower.includes(phrase))) {
    return "Location must be a real address or place name, not a note (avoid phrases like 'sign up' or 'TBD')";
  }
  return null;
}

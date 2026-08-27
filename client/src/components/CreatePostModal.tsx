import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn, getLocationError, getExternalSignupUrlError, LIMITS, getLengthError } from '@/lib/utils';
import {
  X, Upload, ChevronRight, Loader2, Trash2, FileText, RotateCcw,
  BookOpen, Sprout, PartyPopper, HeartHandshake, Laptop,
  Calendar, Repeat, AlertTriangle, Info,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useModalA11y } from '@/hooks/use-modal-a11y';
import { useAuthStore, useOpportunitiesStore } from '@/lib/store';
import ConfirmBubble from '@/components/ConfirmBubble';
import { type Category, type ActivityCategory, TOWNS, FIELD_TAGS } from '@/lib/mockData';
import { useLocation } from 'wouter';

// ── Questionnaire config ─────────────────────────────────────────────
// Icons are components, not emoji: emoji render as a different picture on every
// OS, so the same board looked different on Windows and Mac.
// Every option is something a volunteer DOES, so none of them can quietly mean
// "this is volunteering" and swallow the rest -- which is exactly what the old
// "Volunteer Hours" option did on a site where that is true of every post.
// What the work is *for* is asked separately, on the tags step.
const POST_TYPES: { id: ActivityCategory; label: string; Icon: LucideIcon; desc: string }[] = [
  { id: 'hands-on',  label: 'Hands-On',           Icon: Sprout,         desc: 'Cleanups, planting, building, sorting, packing' },
  { id: 'teaching',  label: 'Teaching & Mentoring', Icon: BookOpen,     desc: 'Tutoring, coaching, advising, workshops' },
  { id: 'events',    label: 'Events & Hosting',   Icon: PartyPopper,    desc: 'Festivals, races, setup, greeting, registration' },
  { id: 'care',      label: 'Care & Company',     Icon: HeartHandshake, desc: 'Seniors, hospitals, animal shelters, visiting' },
  { id: 'backstage', label: 'Behind the Scenes',  Icon: Laptop,         desc: 'Admin, design, data, social media — often remote' },
];

// Shared with the onboarding questionnaire -- see mockData.ts.

type CreateStep = 'type' | 'tags' | 'details';
type SpotsType = 'limited' | 'unlimited' | 'none';

// ── Draft autosave ───────────────────────────────────────────────────
// A half-filled post is real work; closing the modal shouldn't silently bin it.
// ponytail: localStorage, not the server — one draft per browser, no schema
// change, no API. The chosen image is a File object and can't be serialised, so
// drafts never carry it; the restore banner says so. Move this server-side only
// if hosts start asking for drafts across devices.
const DRAFT_KEY = 'locallink_post_draft';

interface PostDraft {
  savedAt: number;
  createStep: CreateStep;
  selectedType: Category | null;
  selectedTags: string[];
  formData: { title: string; description: string; location: string; town: string; date: string; duration: number; spots: number; externalSignupUrl: string };
  spotsType: SpotsType;
  isRecurring: boolean;
  recurringDay: number;
  recurringTime: string;
  steps: string[];
  hasSignupPage: boolean | null;
}

function readDraft(): PostDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as PostDraft;
    // Guard against a shape change shipping a crash to anyone holding an old draft
    return d && d.formData && Array.isArray(d.steps) ? d : null;
  } catch {
    return null;
  }
}

/** "3 minutes ago" / "2 days ago" — coarse on purpose, exact time isn't useful here. */
function timeAgo(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Returns the ISO datetime string for the next upcoming occurrence of dayOfWeek at time "HH:MM" */
function nextOccurrenceISO(day: number, time: string): string {
  const [h, m] = time.split(':').map(Number);
  const now = new Date();
  let daysUntil = (day - now.getDay() + 7) % 7;
  const next = new Date(now);
  next.setDate(now.getDate() + daysUntil);
  next.setHours(h, m, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 7); // already passed today → next week
  return next.toISOString().slice(0, 16);
}

// ── Upload helper ────────────────────────────────────────────────────
async function uploadImage(file: File): Promise<string | null> {
  const fd = new FormData();
  fd.append('image', file);
  const token = localStorage.getItem('locallink_token');
  try {
    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: fd,
    });
    if (res.ok) return (await res.json()).url as string;
    return null;
  } catch {
    return null;
  }
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function CreatePostModal({ open, onClose }: Props) {
  const { toast } = useToast();
  const { currentUser } = useAuthStore();
  const { addOpportunity } = useOpportunitiesStore();
  const [, navigate] = useLocation();
  const isOrgProfileComplete = currentUser?.accountType === 'organization'
    ? !!(currentUser.orgDescription && currentUser.orgEmail)
    : true;

  const [createStep, setCreateStep] = useState<CreateStep>('type');
  const [selectedType, setSelectedType] = useState<Category | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagSearch, setTagSearch] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState('');
  const [uploading, setUploading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [spotsType, setSpotsType] = useState<SpotsType>('limited');
  const [adultsOnly, setAdultsOnly] = useState(false);
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurringDay, setRecurringDay] = useState(1);   // default: Monday
  const [recurringTime, setRecurringTime] = useState('12:00');
  const [steps, setSteps] = useState<string[]>(['']);
  // null, not false: "no" is an answer the organizer has to actually give.
  const [hasSignupPage, setHasSignupPage] = useState<boolean | null>(null);
  const [formData, setFormData] = useState({
    title: '', description: '', location: '', town: '', date: '', duration: 2, spots: 20, externalSignupUrl: '',
  });
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [pendingDraft, setPendingDraft] = useState<PostDraft | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const todayStr = new Date().toISOString().slice(0, 16);

  // Revoke blob URL when the preview changes or modal unmounts to prevent memory leaks
  useEffect(() => {
    return () => { if (imagePreview) URL.revokeObjectURL(imagePreview); };
  }, [imagePreview]);

  const filteredTags = FIELD_TAGS.filter(t => t.toLowerCase().includes(tagSearch.toLowerCase()));
  // Split into up to 5 rows; adapts when search reduces the list so no empty ghost cells appear
  const TAG_ROWS = 5;
  const effectiveRows = Math.min(TAG_ROWS, filteredTags.length || 1);
  const chunkSize = Math.ceil(filteredTags.length / effectiveRows);
  const tagRows = Array.from({ length: effectiveRows }, (_, i) =>
    filteredTags.slice(i * chunkSize, (i + 1) * chunkSize)
  );

  // Offer to restore a saved draft when the modal is (re)opened
  useEffect(() => {
    if (open) setPendingDraft(readDraft());
  }, [open]);

  const handleClose = () => {
    // Reset state on close
    setCreateStep('type');
    setSelectedType(null);
    setSelectedTags([]);
    setTagSearch('');
    setImageFile(null);
    setImagePreview('');
    setFormData({ title: '', description: '', location: '', town: '', date: '', duration: 2, spots: 20, externalSignupUrl: '' });
    setFormErrors({});
    setSpotsType('limited');
    setIsRecurring(false);
    setRecurringDay(1);
    setRecurringTime('12:00');
    setSteps(['']);
    setHasSignupPage(null);
    setShowCloseConfirm(false);
    onClose();
  };

  /** Anything the host would be annoyed to lose. */
  const hasContent = () =>
    selectedType !== null ||
    selectedTags.length > 0 ||
    imageFile !== null ||
    steps.some(s => s.trim()) ||
    formData.title.trim() !== '' ||
    formData.description.trim() !== '' ||
    formData.location.trim() !== '' ||
    formData.town !== '' ||
    formData.date !== '' ||
    formData.externalSignupUrl.trim() !== '';

  /** Every dismissal path routes through here so nothing closes silently. */
  const requestClose = () => {
    if (hasContent()) setShowCloseConfirm(true);
    else handleClose();
  };

  const saveDraftAndClose = () => {
    const draft: PostDraft = {
      savedAt: Date.now(),
      createStep, selectedType, selectedTags, formData,
      spotsType, isRecurring, recurringDay, recurringTime, steps, hasSignupPage,
    };
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      toast({
        title: 'Draft saved',
        description: imageFile
          ? 'Pick up where you left off next time. You\'ll need to re-add the photo.'
          : 'Pick up where you left off next time you open this.',
      });
    } catch {
      // Private mode / quota — better to say so than to pretend it saved
      toast({ title: 'Could not save draft', description: 'Your browser blocked local storage.', variant: 'destructive' });
    }
    handleClose();
  };

  const discardAndClose = () => {
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* nothing to clean up */ }
    handleClose();
  };

  const resumeDraft = (d: PostDraft) => {
    setCreateStep(d.createStep);
    setSelectedType(d.selectedType);
    setSelectedTags(d.selectedTags);
    setFormData(d.formData);
    setSpotsType(d.spotsType);
    setIsRecurring(d.isRecurring);
    setRecurringDay(d.recurringDay);
    setRecurringTime(d.recurringTime);
    setSteps(d.steps);
    setHasSignupPage(d.hasSignupPage ?? null);
    setPendingDraft(null);
  };

  const dismissDraft = () => {
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* nothing to clean up */ }
    setPendingDraft(null);
  };

  // Escape, scroll lock and focus handling, shared with every other overlay.
  // The nested "save as draft?" bubble registers its own layer, so while that
  // is up it owns Escape and this one stays quiet -- no explicit check needed.
  const modalRef = useModalA11y(open, requestClose);

  const handleTypeSelect = (type: Category) => {
    setSelectedType(type);
    setCreateStep('tags');
  };

  const toggleTag = (tag: string) =>
    setSelectedTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
    setFormErrors(prev => ({ ...prev, image: '' }));
  };

  const clearImage = () => {
    setImageFile(null);
    setImagePreview('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const validateDetails = () => {
    const errors: Record<string, string> = {};
    if (!formData.title.trim()) errors.title = 'Title is required';
    else errors.title = getLengthError('title', formData.title) || '';
    if (!formData.description.trim()) errors.description = 'Description is required';
    else errors.description = getLengthError('description', formData.description) || '';
    if (!formData.location.trim()) errors.location = 'Location is required';
    else {
      const locationError = getLocationError(formData.location) || getLengthError('location', formData.location);
      if (locationError) errors.location = locationError;
    }
    // Blank strings above mean "checked, fine" -- drop them so the caller's
    // Object.keys length check doesn't treat a passing field as a failure.
    for (const k of Object.keys(errors)) if (!errors[k]) delete errors[k];
    if (!formData.town) errors.town = 'Please select a town';
    if (!imageFile && !imagePreview) errors.image = 'A photo is required';
    if (hasSignupPage === null) errors.hasSignupPage = 'Please answer yes or no';
    if (hasSignupPage === true && !formData.externalSignupUrl.trim()) {
      errors.externalSignupUrl = 'Add the link volunteers should register on';
    }
    if (formData.externalSignupUrl.trim()) {
      const signupUrlError = getExternalSignupUrlError(formData.externalSignupUrl);
      if (signupUrlError) errors.externalSignupUrl = signupUrlError;
    }
    if (!isRecurring) {
      if (!formData.date) errors.date = 'Date is required';
      else if (new Date(formData.date) <= new Date()) errors.date = 'Date must be in the future';
    }
    if (spotsType === 'limited' && formData.spots < 1) errors.spots = 'At least 1 spot required';
    // Written as !(x >= 0.5) rather than (x < 0.5) so a cleared field catches
    // too: parseFloat('') is NaN, and NaN < 0.5 is false, so the old form let
    // an empty duration through to the server and came back "Missing required
    // fields" with nothing pointing at the box that caused it.
    if (!(formData.duration >= 0.5)) errors.duration = 'Enter at least 0.5 hours';
    const nonEmptySteps = steps.filter(s => s.trim());
    if (nonEmptySteps.length === 0) errors.steps = 'At least one step is required';
    if (steps.some(s => s.trim() === '')) errors.steps = 'All steps must be filled in';
    return errors;
  };

  const handleCreate = async () => {
    const errors = validateDetails();
    setFormErrors(errors);
    if (Object.keys(errors).length > 0) {
      // Publish sits at the bottom of a long scrolling form, and the field
      // that blocked it is often far above — a missing photo is at the very
      // top. Without this, clicking Publish looked like it did nothing at
      // all: no toast, no movement, the only marker off-screen. Every error
      // marks itself data-post-error, so the first one in DOM order is the
      // first one on the form.
      requestAnimationFrame(() => {
        document.querySelector('[data-post-error]')
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      return;
    }

    setCreating(true);
    let imageUrl: string | undefined;
    if (imageFile) {
      setUploading(true);
      const url = await uploadImage(imageFile);
      setUploading(false);
      if (url) imageUrl = url;
      else toast({ title: 'Image upload failed', description: 'Post will be created without an image.', variant: 'destructive' });
    }

    const spots = spotsType === 'limited' ? formData.spots : 0;
    // For recurring posts use the computed next occurrence as the stored date
    const resolvedDate = isRecurring ? nextOccurrenceISO(recurringDay, recurringTime) : formData.date;
    const result = await addOpportunity({
      title: formData.title.trim(),
      description: formData.description.trim(),
      category: selectedType!,
      location: formData.location.trim(),
      town: formData.town,
      date: resolvedDate,
      duration: formData.duration,
      spots,
      spotsRemaining: spots,
      spotsType,
      adultsOnly,
      image: imageUrl,
      tags: selectedTags,
      steps: steps.filter(s => s.trim()),
      externalSignupUrl: formData.externalSignupUrl.trim() || null,
      hasSignupPage: hasSignupPage ?? false,
      hostId: currentUser?.id || '',
      hostName: currentUser?.username || '',
      ...(isRecurring && { isRecurring: true, recurringDay, recurringTime }),
    });
    setCreating(false);

    if (result) {
      // Published — the draft has served its purpose
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* nothing to clean up */ }
      const isPending = result.status === 'pending';
      toast({
        title: isPending ? 'Post submitted for review!' : 'Post published! 🎉',
        description: isPending
          ? 'An admin will review your post. You\'ll be notified once it\'s approved.'
          : 'Your opportunity is now live on the board.',
      });
      handleClose();
    } else {
      toast({ title: 'Failed to create post', description: 'Only organization accounts can create posts.', variant: 'destructive' });
    }
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={requestClose}
          className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4">
          <motion.div initial={{ scale: 0.92, opacity: 0, y: 24 }} animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.92, opacity: 0, y: 24 }} transition={{ type: 'spring', stiffness: 320, damping: 32 }}
            onClick={e => e.stopPropagation()}
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-label="Create an opportunity"
            className="w-full max-w-2xl max-h-[92vh] overflow-y-auto relative focus:outline-none">

            {/* Profile incomplete gate */}
            {!isOrgProfileComplete && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                className="rounded-3xl bg-card border-2 border-orange-400/40 shadow-md p-8 space-y-4 text-center relative"
              >
                <button onClick={handleClose} className="absolute top-4 right-4 p-2 rounded-md hover:bg-secondary transition-all">
                  <X className="w-5 h-5 text-muted-foreground" />
                </button>
                <div className="w-16 h-16 rounded-full bg-orange-500/15 flex items-center justify-center mx-auto">
                  <AlertTriangle className="w-7 h-7 text-orange-500" />
                </div>
                <h2 className="text-2xl font-heading font-bold text-foreground">Complete Your Profile First</h2>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  Before posting an opportunity, you need to complete your organization profile. Add a description and contact email so volunteers know who you are.
                </p>
                <div className="flex gap-3 pt-2">
                  <Button variant="outline" onClick={handleClose} className="flex-1 h-11 rounded-md font-semibold">
                    Cancel
                  </Button>
                  <Button onClick={() => { handleClose(); navigate('/profile'); }} className="flex-1 h-11 rounded-md font-semibold">
                    Go to Profile →
                  </Button>
                </div>
              </motion.div>
            )}

            {/* Step indicator */}
            {isOrgProfileComplete && (
              <div className="flex items-center justify-center gap-2 mb-4">
                {(['type', 'tags', 'details'] as CreateStep[]).map((s) => (
                  <div key={s} className={cn("h-1.5 rounded-full transition-all duration-300",
                    createStep === s ? "w-8 bg-white" : "w-4 bg-white/30")} />
                ))}
              </div>
            )}

            {isOrgProfileComplete && <AnimatePresence mode="wait">
              {/* ── STEP 1: Type ── */}
              {createStep === 'type' && (
                <motion.div key="type"
                  initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }}
                  transition={{ duration: 0.22 }}
                  className="rounded-3xl bg-card border border-border shadow-md p-8 md:p-10 space-y-6">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-xs font-bold tracking-widest uppercase text-muted-foreground mb-1">Step 1 of 3</p>
                      {/* Asks about the work, not the topic. "Volunteer" is not an
                          option because it is the premise of the whole site --
                          the subtitle carries that so the question doesn't have to. */}
                      <h2 className="text-2xl font-heading font-bold text-foreground">What will volunteers be doing?</h2>
                      <p className="text-sm text-muted-foreground mt-1.5 max-w-md">
                        Every post here is a volunteer opportunity — this is about the kind of
                        work. You'll pick what it's for next.
                      </p>
                    </div>
                    <button onClick={requestClose} aria-label="Close" className="p-2 rounded-md hover:bg-secondary transition-all -mt-1 -mr-1">
                      <X className="w-5 h-5 text-muted-foreground" />
                    </button>
                  </div>
                  {/* Unfinished work from a previous session */}
                  {pendingDraft && (
                    <motion.div
                      initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
                      className="rounded-2xl border border-primary/30 bg-primary/5 p-4 flex items-start gap-3">
                      <RotateCcw className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                      <div className="flex-1 space-y-2.5">
                        <div>
                          <p className="text-sm font-semibold text-foreground">You have an unfinished post</p>
                          <p className="text-xs text-muted-foreground">
                            Saved {timeAgo(pendingDraft.savedAt)} — photos aren't kept in drafts.
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => resumeDraft(pendingDraft)}
                            className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors">
                            Resume
                          </button>
                          <button onClick={dismissDraft}
                            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-muted-foreground hover:text-red-500 transition-colors">
                            Discard
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                  <div className="space-y-3">
                    {POST_TYPES.map((type, idx) => (
                      <motion.button key={type.id}
                        initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: idx * 0.07 }}
                        whileHover={{ x: 6 }} whileTap={{ scale: 0.98 }}
                        onClick={() => handleTypeSelect(type.id)}
                        className="w-full px-5 py-4 rounded-2xl bg-secondary/60 border border-border hover:border-primary/40 hover:bg-primary/5 text-foreground font-medium transition-all text-left flex items-center gap-4 group">
                        <span className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center flex-shrink-0 transition-transform group-hover:scale-110">
                          <type.Icon className="w-5 h-5" />
                        </span>
                        <div>
                          <p className="font-semibold text-foreground">{type.label}</p>
                          <p className="text-xs text-muted-foreground">{type.desc}</p>
                        </div>
                        <ChevronRight className="w-4 h-4 text-muted-foreground ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
                      </motion.button>
                    ))}
                  </div>
                </motion.div>
              )}

              {/* ── STEP 2: Tags ── */}
              {createStep === 'tags' && (
                <motion.div key="tags"
                  initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }}
                  transition={{ duration: 0.22 }}
                  className="rounded-3xl bg-card border border-border shadow-md p-8 md:p-10 space-y-6">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-xs font-bold tracking-widest uppercase text-muted-foreground mb-1">Step 2 of 3</p>
                      <h2 className="text-2xl font-heading font-bold text-foreground">What field is this in?</h2>
                      <p className="text-sm text-muted-foreground mt-1">
                        Pick at least one — this is what volunteers filter and search by.
                      </p>
                    </div>
                    <button onClick={requestClose} aria-label="Close" className="p-2 rounded-md hover:bg-secondary transition-all -mt-1 -mr-1">
                      <X className="w-5 h-5 text-muted-foreground" />
                    </button>
                  </div>

                  <Input placeholder="Search fields..." value={tagSearch}
                    onChange={e => setTagSearch(e.target.value)}
                    className="rounded-xl border-border" />

                  <div className="overflow-x-auto pb-2" style={{ scrollbarWidth: 'thin' }}>
                    <div className="flex flex-col gap-2" style={{ minWidth: 'max-content' }}>
                      {tagRows.map((row, rowIdx) => (
                        <div key={rowIdx} className="flex gap-2">
                          {row.map(tag => (
                            <motion.button key={tag} whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
                              onClick={() => toggleTag(tag)}
                              className={cn("w-36 flex-shrink-0 px-3 py-2 rounded-xl border-2 text-xs font-medium transition-all text-center leading-tight",
                                selectedTags.includes(tag)
                                  ? "bg-primary border-primary text-primary-foreground shadow-sm"
                                  : "bg-secondary/60 border-border text-foreground hover:border-primary/40")}>
                              {tag}
                            </motion.button>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>

                  {selectedTags.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {selectedTags.map(tag => (
                        <span key={tag} className="inline-flex items-center gap-1 px-3 py-1 bg-primary/10 border border-primary/20 rounded-md text-xs font-semibold text-primary">
                          {tag}
                          <button onClick={() => toggleTag(tag)} className="hover:text-red-500 transition-colors"><X className="w-3 h-3" /></button>
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Disabled rather than erroring on click: there is one thing to do
                      on this step and the button says why it can't be pressed, so a
                      validation message would be telling you what the screen shows. */}
                  <div className="space-y-2 pt-2">
                    {selectedTags.length === 0 && (
                      <p className="text-xs text-muted-foreground">Pick a field above to continue.</p>
                    )}
                    <div className="flex gap-3">
                      <Button variant="outline" onClick={() => setCreateStep('type')} className="flex-1 rounded-md font-semibold">← Back</Button>
                      <Button
                        onClick={() => setCreateStep('details')}
                        disabled={selectedTags.length === 0}
                        className="flex-1 rounded-md font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Continue →
                      </Button>
                    </div>
                  </div>
                </motion.div>
              )}

              {/* ── STEP 3: Details ── */}
              {createStep === 'details' && (
                <motion.div key="details"
                  initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }}
                  transition={{ duration: 0.22 }}
                  className="rounded-3xl overflow-hidden border-2 border-white/20 shadow-md bg-primary">

                  {/* Image upload area */}
                  <div className="relative h-52 overflow-hidden cursor-pointer group" onClick={() => fileInputRef.current?.click()}>
                    {imagePreview ? (
                      <>
                        <img src={imagePreview} alt="Preview" className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <p className="text-white font-semibold text-sm">Click to change image</p>
                        </div>
                        {/* Bottom-LEFT, and labelled. This used to be a bare X at
                            top-3 right-3, four pixels from the modal's own close X
                            at top-4 right-4 — two 28px targets overlapping by 24px,
                            with close painting on top because it comes later in the
                            DOM. So the X you could actually hit threw away the whole
                            post rather than the photo. Two destructive actions of
                            different scope must not share a corner. */}
                        <button onClick={e => { e.stopPropagation(); clearImage(); }}
                          className="absolute bottom-3 left-3 bg-black/60 rounded-md pl-2 pr-3 py-1.5 text-white text-xs font-semibold hover:bg-black/80 transition-colors inline-flex items-center gap-1.5">
                          <X className="w-3.5 h-3.5" />
                          Remove photo
                        </button>
                      </>
                    ) : (
                      <div data-post-error={formErrors.image || undefined} className={cn(
                        "absolute inset-0 flex flex-col items-center justify-center gap-3 transition-colors",
                        formErrors.image
                          ? "bg-red-900/40 ring-2 ring-inset ring-red-400"
                          : "bg-black/20 group-hover:bg-black/30"
                      )}>
                        <Upload className="w-12 h-12 text-white/70 group-hover:text-white transition-colors" />
                        <div className="text-center">
                          <p className="font-semibold text-white text-sm tracking-widest uppercase opacity-75">Add a Photo *</p>
                          <p className={cn("text-xs mt-1", formErrors.image ? "text-red-100 font-semibold" : "text-white/60")}>
                            {formErrors.image || 'Click to upload'}
                          </p>
                        </div>
                      </div>
                    )}
                    <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageSelect} />

                    <div className="absolute top-4 left-4 right-4 flex items-center justify-between">
                      <span className="text-xs font-bold tracking-widest uppercase text-white/70 bg-black/30 rounded-md px-3 py-1">Step 3 of 3</span>
                      <button onClick={e => { e.stopPropagation(); requestClose(); }} aria-label="Close" className="p-1.5 rounded-md bg-black/40 hover:bg-black/60 transition-colors">
                        <X className="w-4 h-4 text-white" />
                      </button>
                    </div>
                  </div>

                  {/* Form fields */}
                  <div className="p-6 md:p-8 space-y-5 text-white">
                    <div>
                      <label htmlFor="createpostmodal-post-title" className="text-xs font-bold tracking-widest uppercase opacity-75 mb-2 block">Post Title *</label>
                      <Input id="createpostmodal-post-title" placeholder="Give your opportunity a name..." maxLength={LIMITS.title}
                        value={formData.title}
                        onChange={e => { setFormData({ ...formData, title: e.target.value }); setFormErrors({ ...formErrors, title: '' }); }}
                        className={cn("rounded-2xl bg-white/90 text-slate-900 font-semibold border-0 h-12", formErrors.title && "ring-2 ring-red-400")} />
                      {formErrors.title && <p data-post-error className="text-red-200 text-xs mt-1">{formErrors.title}</p>}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="bg-white/15 rounded-2xl p-4 border border-white/20 space-y-2">
                        <label htmlFor="createpostmodal-description" className="text-xs font-bold tracking-widest uppercase opacity-75 block">Description *</label>
                        <Textarea id="createpostmodal-description" placeholder="Describe this opportunity..." maxLength={LIMITS.description}
                          value={formData.description}
                          onChange={e => { setFormData({ ...formData, description: e.target.value }); setFormErrors({ ...formErrors, description: '' }); }}
                          className={cn("rounded-xl bg-white/80 text-slate-900 border-0 text-sm resize-none min-h-[90px]", formErrors.description && "ring-2 ring-red-400")} />
                        {formErrors.description && <p data-post-error className="text-red-200 text-xs">{formErrors.description}</p>}
                      </div>

                      <div className="bg-white/15 rounded-2xl p-4 border border-white/20 space-y-3">
                        <div>
                          <label htmlFor="createpostmodal-location" className="text-xs font-bold tracking-widest uppercase opacity-75 block mb-1">Location *</label>
                          <Input id="createpostmodal-location" placeholder="Full address or place name — shown as a map link" maxLength={LIMITS.location}
                            value={formData.location}
                            onChange={e => { setFormData({ ...formData, location: e.target.value }); setFormErrors({ ...formErrors, location: '' }); }}
                            className={cn("rounded-xl bg-white/80 text-slate-900 border-0 text-sm h-9", formErrors.location && "ring-2 ring-red-400")} />
                          {formErrors.location && <p data-post-error className="text-red-200 text-xs">{formErrors.location}</p>}
                          {/* No geocoding — the human is the address validator. Show them
                              exactly what volunteers will see so mistakes surface pre-publish. */}
                          {formData.location.trim().length >= 5 && (
                            <p className="text-white/70 text-xs mt-1">
                              Are you sure this is right?{' '}
                              <a
                                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(formData.location.trim())}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="underline hover:text-white"
                              >
                                Check it on Google Maps ↗
                              </a>
                            </p>
                          )}
                        </div>

                        <div>
                          <label htmlFor="createpostmodal-town" className="text-xs font-bold tracking-widest uppercase opacity-75 block mb-1">Town *</label>
                          <select id="createpostmodal-town"
                            value={formData.town}
                            onChange={e => { setFormData({ ...formData, town: e.target.value }); setFormErrors({ ...formErrors, town: '' }); }}
                            className={cn("w-full rounded-xl bg-white/80 text-slate-900 border-0 text-sm h-9 px-3", formErrors.town && "ring-2 ring-red-400")}>
                            <option value="">Select a town…</option>
                            {TOWNS.map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                          {formErrors.town && <p data-post-error className="text-red-200 text-xs">{formErrors.town}</p>}
                        </div>

                        {/* ── Schedule type toggle ── */}
                        <div>
                          <span id="post-schedule-label" className="text-xs font-bold tracking-widest uppercase opacity-75 block mb-1.5">Schedule</span>
                          <div role="group" aria-labelledby="post-schedule-label" className="flex gap-2 mb-2">
                            <button type="button"
                              onClick={() => setIsRecurring(false)}
                              className={cn(
                                "flex-1 h-9 rounded-xl text-sm font-semibold border transition-all inline-flex items-center justify-center gap-1.5",
                                !isRecurring ? "bg-white text-primary border-white" : "bg-white/20 text-white border-white/30 hover:bg-white/30"
                              )}>
                              <Calendar className="w-3.5 h-3.5" /> One-time
                            </button>
                            <button type="button"
                              onClick={() => setIsRecurring(true)}
                              className={cn(
                                "flex-1 h-9 rounded-xl text-sm font-semibold border transition-all inline-flex items-center justify-center gap-1.5",
                                isRecurring ? "bg-white text-primary border-white" : "bg-white/20 text-white border-white/30 hover:bg-white/30"
                              )}>
                              <Repeat className="w-3.5 h-3.5" /> Weekly
                            </button>
                          </div>

                          {/* One-time: regular date picker */}
                          {!isRecurring && (
                            <div>
                              <Input type="datetime-local" min={todayStr}
                                value={formData.date}
                                onChange={e => { setFormData({ ...formData, date: e.target.value }); setFormErrors({ ...formErrors, date: '' }); }}
                                className={cn("rounded-xl bg-white/80 text-slate-900 border-0 text-sm h-9", formErrors.date && "ring-2 ring-red-400")} />
                              {formErrors.date && <p data-post-error className="text-red-200 text-xs mt-1">{formErrors.date}</p>}
                            </div>
                          )}

                          {/* Weekly: day-of-week + time */}
                          {isRecurring && (
                            <div className="space-y-2">
                              <div className="grid grid-cols-7 gap-1">
                                {DAY_NAMES.map((name, idx) => (
                                  <button key={name} type="button"
                                    onClick={() => setRecurringDay(idx)}
                                    className={cn(
                                      "py-1.5 rounded-lg text-xs font-bold transition-all",
                                      recurringDay === idx
                                        ? "bg-white text-primary"
                                        : "bg-white/20 text-white hover:bg-white/35"
                                    )}>
                                    {name}
                                  </button>
                                ))}
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-xs opacity-75 font-semibold whitespace-nowrap">At time:</span>
                                <Input type="time"
                                  value={recurringTime}
                                  onChange={e => setRecurringTime(e.target.value)}
                                  className="rounded-xl bg-white/80 text-slate-900 border-0 text-sm h-9 flex-1" />
                              </div>
                              <p className="text-white/60 text-xs">
                                Opens every Monday at midnight — closes at {recurringTime} on {DAY_FULL[recurringDay]} — reopens the following Monday.
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="bg-white/15 rounded-2xl p-4 border border-white/20 space-y-2">
                        <label htmlFor="createpostmodal-duration-hours" className="text-xs font-bold tracking-widest uppercase opacity-75 block">Duration (hours)</label>
                        <Input id="createpostmodal-duration-hours" type="number" min={0.5} max={24} step={0.5}
                          value={Number.isNaN(formData.duration) ? '' : formData.duration}
                          onChange={e => { const v = parseFloat(e.target.value); setFormData({ ...formData, duration: v }); setFormErrors({ ...formErrors, duration: '' }); }}
                          className={cn("rounded-xl bg-white/80 text-slate-900 border-0 text-sm h-9", formErrors.duration && "ring-2 ring-red-400")} />
                        {formErrors.duration && <p data-post-error className="text-red-200 text-xs">{formErrors.duration}</p>}
                      </div>
                      <div className="bg-white/15 rounded-2xl p-4 border border-white/20 space-y-2">
                        <label className="flex items-start gap-2.5 mb-3 cursor-pointer">
                          <input type="checkbox" checked={adultsOnly} onChange={e => setAdultsOnly(e.target.checked)} className="mt-0.5" />
                          <span className="text-xs opacity-90">
                            <span className="font-bold">Adults only (18+)</span> — for work a minor can’t do, like power tools or late shifts. Volunteers under 18 won’t be able to sign up.
                          </span>
                        </label>
                        <span id="post-spots-label" className="text-xs font-bold tracking-widest uppercase opacity-75 block">Spots</span>
                        <div role="group" aria-labelledby="post-spots-label" className="flex gap-1.5 mb-2 flex-wrap">
                          {(['limited', 'unlimited', 'none'] as SpotsType[]).map(st => (
                            <button key={st} type="button"
                              onClick={() => setSpotsType(st)}
                              className={cn("flex-1 min-w-[60px] rounded-lg py-1.5 text-xs font-semibold transition-all border",
                                spotsType === st
                                  ? "bg-white text-primary border-white"
                                  : "bg-white/20 text-white border-white/30 hover:bg-white/30")}>
                              {st.charAt(0).toUpperCase() + st.slice(1)}
                            </button>
                          ))}
                        </div>
                        {spotsType === 'limited' && (
                          <Input type="number" min={1} max={1000}
                            value={formData.spots}
                            onChange={e => setFormData({ ...formData, spots: parseInt(e.target.value) || 0 })}
                            className={cn("rounded-xl bg-white/80 text-slate-900 border-0 text-sm h-9", formErrors.spots && "ring-2 ring-red-400")} />
                        )}
                        {formErrors.spots && <p data-post-error className="text-red-200 text-xs">{formErrors.spots}</p>}
                        {spotsType === 'unlimited' && <p className="text-white/70 text-xs">Open to all</p>}
                        {spotsType === 'none' && <p className="text-white/70 text-xs">Not specified</p>}
                      </div>
                    </div>

                    {selectedTags.length > 0 && (
                      <div className="bg-white/15 rounded-2xl p-4 border border-white/20 space-y-2">
                        <p className="text-xs font-bold tracking-widest uppercase opacity-75">Your Tags</p>
                        <div className="flex flex-wrap gap-2">
                          {selectedTags.map(tag => (
                            <span key={tag} className="px-3 py-1 bg-white/25 border border-white/40 rounded-md text-xs font-semibold">{tag}</span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Volunteer Steps */}
                    <div className="bg-white/15 rounded-2xl p-4 border border-white/20 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold tracking-widest uppercase opacity-75">How to Participate *</span>
                        <button
                          type="button"
                          onClick={() => setSteps(s => [...s, ''])}
                          className="text-xs font-semibold bg-white/20 hover:bg-white/30 text-white px-2 py-1 rounded-lg transition-colors"
                        >
                          + Add Step
                        </button>
                      </div>
                      <div className="space-y-2">
                        {steps.map((step, idx) => (
                          <div key={idx} className="flex items-center gap-2">
                            <span className="w-6 h-6 rounded-full bg-white/30 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">{idx + 1}</span>
                            <Input
                              placeholder={`Step ${idx + 1}...`} maxLength={LIMITS.step}
                              value={step}
                              onChange={e => {
                                const updated = [...steps];
                                updated[idx] = e.target.value;
                                setSteps(updated);
                                setFormErrors({ ...formErrors, steps: '' });
                              }}
                              className="rounded-xl bg-white/80 text-slate-900 border-0 text-sm h-9 flex-1"
                            />
                            {steps.length > 1 && (
                              <button
                                type="button"
                                onClick={() => setSteps(s => s.filter((_, i) => i !== idx))}
                                className="text-white/60 hover:text-white transition-colors flex-shrink-0"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                      {formErrors.steps && <p data-post-error className="text-red-200 text-xs">{formErrors.steps}</p>}
                      <div className="flex gap-2 items-start bg-white/10 rounded-xl p-3">
                        <Info className="w-3.5 h-3.5 text-white/70 mt-0.5 flex-shrink-0" />
                        <p className="text-white/70 text-xs leading-relaxed">
                          <span className="font-semibold text-white/90">Cover the whole path</span>, not just "sign up here" — what does a volunteer actually need to do between signing up and showing up? e.g. "Fill out our waiver form," "Wear closed-toe shoes," "Check in at the front desk when you arrive."
                        </p>
                      </div>
                    </div>

                    {/* External signup. Asked as a question with no default rather
                        than left as a blank optional box: plenty of organizations
                        genuinely have no signup page, and the ones that DO were
                        skipping the field and stranding volunteers who thought
                        signing up here was enough. Answering is required; giving a
                        URL is required only if the answer is yes. */}
                    <div className="bg-white/15 rounded-2xl p-4 border border-white/20 space-y-3">
                      <p className="text-xs font-bold tracking-widest uppercase opacity-75">
                        Do volunteers register on your own site? *
                      </p>
                      <div className="flex gap-2">
                        <button type="button"
                          onClick={() => { setHasSignupPage(true); setFormErrors({ ...formErrors, hasSignupPage: '' }); }}
                          className={cn("flex-1 h-10 rounded-md text-sm font-semibold transition-colors",
                            hasSignupPage === true ? "bg-white text-primary" : "bg-white/15 text-white hover:bg-white/25")}>
                          Yes
                        </button>
                        <button type="button"
                          onClick={() => {
                            setHasSignupPage(false);
                            setFormData(f => ({ ...f, externalSignupUrl: '' }));
                            setFormErrors({ ...formErrors, hasSignupPage: '', externalSignupUrl: '' });
                          }}
                          className={cn("flex-1 h-10 rounded-md text-sm font-semibold transition-colors",
                            hasSignupPage === false ? "bg-white text-primary" : "bg-white/15 text-white hover:bg-white/25")}>
                          No
                        </button>
                      </div>
                      {formErrors.hasSignupPage && <p data-post-error className="text-red-200 text-xs">{formErrors.hasSignupPage}</p>}

                      {hasSignupPage === true && (
                        <div className="space-y-2 pt-1">
                          <label htmlFor="createpostmodal-field" className="text-xs font-bold tracking-widest uppercase opacity-75 block">
                            Signup page *
                          </label>
                          <Input id="createpostmodal-field" placeholder="https://your-site.org/signup"
                            value={formData.externalSignupUrl}
                            onChange={e => { setFormData({ ...formData, externalSignupUrl: e.target.value }); setFormErrors({ ...formErrors, externalSignupUrl: '' }); }}
                            className={cn("rounded-xl bg-white/80 text-slate-900 border-0 text-sm h-9", formErrors.externalSignupUrl && "ring-2 ring-red-400")} />
                          {formErrors.externalSignupUrl && <p data-post-error className="text-red-200 text-xs">{formErrors.externalSignupUrl}</p>}
                        </div>
                      )}
                      {hasSignupPage === false && (
                        <p className="text-white/60 text-xs">
                          Volunteers just sign up here — nothing else to do before the event.
                        </p>
                      )}
                    </div>

                    <div className="bg-white/15 rounded-2xl p-4 border border-white/20 text-center">
                      <p className="text-xs font-bold tracking-widest uppercase opacity-75 mb-1">Posted by</p>
                      <p className="font-semibold">{currentUser?.username || 'You'}</p>
                    </div>

                    <div className="flex gap-3 pt-2">
                      <Button variant="outline" onClick={() => setCreateStep('tags')}
                        className="flex-1 rounded-md h-11 font-semibold border-white/30 text-white hover:bg-white/20 bg-transparent">
                        ← Back
                      </Button>
                      <Button onClick={handleCreate} disabled={creating || uploading}
                        className="flex-1 rounded-md h-11 font-semibold bg-white text-primary hover:bg-white/90">
                        {(creating || uploading) && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                        {uploading ? 'Uploading...' : creating ? 'Publishing...' : 'Publish Post 🚀'}
                      </Button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>}
          </motion.div>

          {/* Close confirmation — a half-filled post shouldn't vanish on a stray backdrop click */}
          <ConfirmBubble
            open={showCloseConfirm}
            icon={<FileText className="w-4 h-4 text-primary" />}
            title="Save this as a draft?"
            message="You haven't published it yet. Save it and pick up right where you left off."
            destructiveLabel={<><Trash2 className="w-3.5 h-3.5" /> Discard</>}
            onDestructive={discardAndClose}
            confirmLabel="Save draft"
            onConfirm={saveDraftAndClose}
            cancelLabel="Keep editing"
            onCancel={() => setShowCloseConfirm(false)}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

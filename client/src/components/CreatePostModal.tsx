import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn, getLocationError, getExternalSignupUrlError } from '@/lib/utils';
import { X, Upload, ChevronRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useAuthStore, useOpportunitiesStore } from '@/lib/store';
import { type Category, TOWNS } from '@/lib/mockData';
import { useLocation } from 'wouter';

// ── Questionnaire config ─────────────────────────────────────────────
const POST_TYPES: { id: Category; label: string; icon: string; desc: string }[] = [
  { id: 'volunteer',    label: 'Volunteer Hours',     icon: '🤝', desc: 'Give your time to help others' },
  { id: 'education',   label: 'Education',            icon: '📚', desc: 'Teach, tutor, or share knowledge' },
  { id: 'fitness',     label: 'Fitness & Recreation',  icon: '🏃', desc: 'Coaching, tournaments, activities' },
  { id: 'community',   label: 'Community',            icon: '🏘️', desc: 'Local events and neighbourhood help' },
  { id: 'environment', label: 'Environment',          icon: '🌱', desc: 'Conservation and green initiatives' },
];

const FIELD_TAGS = [
  '🌿 Environment',
  '🐾 Animals',
  '🍽️ Food & Hunger',
  '🏠 Housing',
  '🏥 Health & Medical',
  '🚒 Emergency Services',
  '👴 Senior Services',
  '📚 Education',
  '🎨 Arts & Culture',
  '🏋️ Sports & Fitness',
  '🛐 Faith & Spiritual',
  '👧 Youth & Children',
  '🤝 Social Services',
  '📱 Technology',
  '🎓 Tutoring',
  '💼 Workforce Dev',
  '🏘️ Civic Engagement',
  '♿ Disability Services',
  '🌍 Cultural Diversity',
  '🧠 Mental Health',
  '💰 Financial Aid',
  '⚖️ Legal Aid',
  '🌾 Agriculture',
  '🚌 Transportation',
  '🏫 After-School',
  '👨‍👩‍👧 Family Support',
  '🎭 Performing Arts',
  '📰 Media',
  '🔬 Science & Research',
  '🕊️ Conflict Resolution',
  '🌐 Global Outreach',
  '🎪 Events & Festivals',
  '🏺 History & Heritage',
  '♻️ Sustainability',
  '🏗️ Community Dev',
  '📣 Advocacy',
  '🎒 School Supplies',
  '🩺 Behavioral Health',
  '👮 Public Safety',
  '🧒 Early Childhood',
  '🏕️ Outdoor Education',
  '🤱 Maternal Health',
  '🧑‍🤝‍🧑 Peer Mentorship',
  '🖥️ Digital Literacy',
  '🎵 Music',
  '🛠️ Skilled Trades',
  '🌱 Urban Gardening',
  '🐕 Service Animals',
  '🎗️ Chronic Illness',
  '🏦 Econ. Empowerment',
];

type CreateStep = 'type' | 'tags' | 'details';
type SpotsType = 'limited' | 'unlimited' | 'none';

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
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurringDay, setRecurringDay] = useState(1);   // default: Monday
  const [recurringTime, setRecurringTime] = useState('12:00');
  const [steps, setSteps] = useState<string[]>(['']);
  const [formData, setFormData] = useState({
    title: '', description: '', location: '', town: '', date: '', duration: 2, spots: 20, externalSignupUrl: '',
  });
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
    onClose();
  };

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
  };

  const clearImage = () => {
    setImageFile(null);
    setImagePreview('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const validateDetails = () => {
    const errors: Record<string, string> = {};
    if (!formData.title.trim()) errors.title = 'Title is required';
    if (!formData.description.trim()) errors.description = 'Description is required';
    if (!formData.location.trim()) errors.location = 'Location is required';
    else {
      const locationError = getLocationError(formData.location);
      if (locationError) errors.location = locationError;
    }
    if (!formData.town) errors.town = 'Please select a town';
    if (formData.externalSignupUrl.trim()) {
      const signupUrlError = getExternalSignupUrlError(formData.externalSignupUrl);
      if (signupUrlError) errors.externalSignupUrl = signupUrlError;
    }
    if (!isRecurring) {
      if (!formData.date) errors.date = 'Date is required';
      else if (new Date(formData.date) <= new Date()) errors.date = 'Date must be in the future';
    }
    if (spotsType === 'limited' && formData.spots < 1) errors.spots = 'At least 1 spot required';
    if (formData.duration < 0.5) errors.duration = 'Minimum 0.5 hrs';
    const nonEmptySteps = steps.filter(s => s.trim());
    if (nonEmptySteps.length === 0) errors.steps = 'At least one step is required';
    if (steps.some(s => s.trim() === '')) errors.steps = 'All steps must be filled in';
    return errors;
  };

  const handleCreate = async () => {
    const errors = validateDetails();
    setFormErrors(errors);
    if (Object.keys(errors).length > 0) return;

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
      image: imageUrl,
      tags: selectedTags,
      steps: steps.filter(s => s.trim()),
      externalSignupUrl: formData.externalSignupUrl.trim() || null,
      hostId: currentUser?.id || '',
      hostName: currentUser?.username || '',
      ...(isRecurring && { isRecurring: true, recurringDay, recurringTime }),
    });
    setCreating(false);

    if (result) {
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
          onClick={handleClose}
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <motion.div initial={{ scale: 0.92, opacity: 0, y: 24 }} animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.92, opacity: 0, y: 24 }} transition={{ type: 'spring', stiffness: 320, damping: 32 }}
            onClick={e => e.stopPropagation()}
            className="w-full max-w-2xl max-h-[92vh] overflow-y-auto relative">

            {/* Profile incomplete gate */}
            {!isOrgProfileComplete && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                className="rounded-3xl bg-card border-2 border-orange-400/40 shadow-2xl p-8 space-y-4 text-center relative"
              >
                <button onClick={handleClose} className="absolute top-4 right-4 p-2 rounded-full hover:bg-secondary transition-all">
                  <X className="w-5 h-5 text-muted-foreground" />
                </button>
                <div className="w-16 h-16 rounded-full bg-orange-500/15 flex items-center justify-center mx-auto">
                  <span className="text-3xl">⚠️</span>
                </div>
                <h2 className="text-2xl font-heading font-bold text-foreground">Complete Your Profile First</h2>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  Before posting an opportunity, you need to complete your organization profile. Add a description and contact email so volunteers know who you are.
                </p>
                <div className="flex gap-3 pt-2">
                  <Button variant="outline" onClick={handleClose} className="flex-1 h-11 rounded-full font-semibold">
                    Cancel
                  </Button>
                  <Button onClick={() => { handleClose(); navigate('/profile'); }} className="flex-1 h-11 rounded-full font-semibold">
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
                  className="rounded-3xl bg-card border-2 border-border shadow-2xl p-8 md:p-10 space-y-6">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-xs font-bold tracking-widest uppercase text-muted-foreground mb-1">Step 1 of 3</p>
                      <h2 className="text-2xl font-heading font-bold text-foreground">What are you offering?</h2>
                    </div>
                    <button onClick={handleClose} className="p-2 rounded-full hover:bg-secondary transition-all -mt-1 -mr-1">
                      <X className="w-5 h-5 text-muted-foreground" />
                    </button>
                  </div>
                  <div className="space-y-3">
                    {POST_TYPES.map((type, idx) => (
                      <motion.button key={type.id}
                        initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: idx * 0.07 }}
                        whileHover={{ x: 6 }} whileTap={{ scale: 0.98 }}
                        onClick={() => handleTypeSelect(type.id)}
                        className="w-full px-5 py-4 rounded-2xl bg-secondary/60 border-2 border-border hover:border-primary/40 hover:bg-primary/5 text-foreground font-medium transition-all text-left flex items-center gap-4 group">
                        <span className="text-2xl group-hover:scale-110 transition-transform">{type.icon}</span>
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
                  className="rounded-3xl bg-card border-2 border-border shadow-2xl p-8 md:p-10 space-y-6">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-xs font-bold tracking-widest uppercase text-muted-foreground mb-1">Step 2 of 3</p>
                      <h2 className="text-2xl font-heading font-bold text-foreground">What field is this in?</h2>
                      <p className="text-sm text-muted-foreground mt-1">Select all that apply (optional)</p>
                    </div>
                    <button onClick={handleClose} className="p-2 rounded-full hover:bg-secondary transition-all -mt-1 -mr-1">
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
                        <span key={tag} className="inline-flex items-center gap-1 px-3 py-1 bg-primary/10 border border-primary/20 rounded-full text-xs font-semibold text-primary">
                          {tag}
                          <button onClick={() => toggleTag(tag)} className="hover:text-red-500 transition-colors"><X className="w-3 h-3" /></button>
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="flex gap-3 pt-2">
                    <Button variant="outline" onClick={() => setCreateStep('type')} className="flex-1 rounded-full font-semibold">← Back</Button>
                    <Button onClick={() => setCreateStep('details')} className="flex-1 rounded-full font-semibold">Continue →</Button>
                  </div>
                </motion.div>
              )}

              {/* ── STEP 3: Details ── */}
              {createStep === 'details' && (
                <motion.div key="details"
                  initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }}
                  transition={{ duration: 0.22 }}
                  className="rounded-3xl overflow-hidden border-2 border-white/20 shadow-2xl bg-gradient-to-br from-primary/90 to-primary">

                  {/* Image upload area */}
                  <div className="relative h-52 overflow-hidden cursor-pointer group" onClick={() => fileInputRef.current?.click()}>
                    {imagePreview ? (
                      <>
                        <img src={imagePreview} alt="Preview" className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <p className="text-white font-semibold text-sm">Click to change image</p>
                        </div>
                        <button onClick={e => { e.stopPropagation(); clearImage(); }}
                          className="absolute top-3 right-3 bg-black/60 rounded-full p-1.5 text-white hover:bg-black/80 transition-colors">
                          <X className="w-4 h-4" />
                        </button>
                      </>
                    ) : (
                      <div className="absolute inset-0 bg-black/20 flex flex-col items-center justify-center gap-3 group-hover:bg-black/30 transition-colors">
                        <Upload className="w-12 h-12 text-white/70 group-hover:text-white transition-colors" />
                        <div className="text-center">
                          <p className="font-semibold text-white text-sm tracking-widest uppercase opacity-75">Add a Photo</p>
                          <p className="text-white/60 text-xs mt-1">Click to upload (optional)</p>
                        </div>
                      </div>
                    )}
                    <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageSelect} />

                    <div className="absolute top-4 left-4 right-4 flex items-center justify-between">
                      <span className="text-xs font-bold tracking-widest uppercase text-white/70 bg-black/30 rounded-full px-3 py-1">Step 3 of 3</span>
                      <button onClick={e => { e.stopPropagation(); handleClose(); }} className="p-1.5 rounded-full bg-black/40 hover:bg-black/60 transition-colors">
                        <X className="w-4 h-4 text-white" />
                      </button>
                    </div>
                  </div>

                  {/* Form fields */}
                  <div className="p-6 md:p-8 space-y-5 text-white">
                    <div>
                      <label className="text-xs font-bold tracking-widest uppercase opacity-75 mb-2 block">Post Title *</label>
                      <Input placeholder="Give your opportunity a name..."
                        value={formData.title}
                        onChange={e => { setFormData({ ...formData, title: e.target.value }); setFormErrors({ ...formErrors, title: '' }); }}
                        className={cn("rounded-2xl bg-white/90 text-foreground font-semibold border-0 h-12", formErrors.title && "ring-2 ring-red-400")} />
                      {formErrors.title && <p className="text-red-200 text-xs mt-1">{formErrors.title}</p>}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="bg-white/15 backdrop-blur-md rounded-2xl p-4 border border-white/20 space-y-2">
                        <label className="text-xs font-bold tracking-widest uppercase opacity-75 block">Description *</label>
                        <Textarea placeholder="Describe this opportunity..."
                          value={formData.description}
                          onChange={e => { setFormData({ ...formData, description: e.target.value }); setFormErrors({ ...formErrors, description: '' }); }}
                          className={cn("rounded-xl bg-white/80 text-foreground border-0 text-sm resize-none min-h-[90px]", formErrors.description && "ring-2 ring-red-400")} />
                        {formErrors.description && <p className="text-red-200 text-xs">{formErrors.description}</p>}
                      </div>

                      <div className="bg-white/15 backdrop-blur-md rounded-2xl p-4 border border-white/20 space-y-3">
                        <div>
                          <label className="text-xs font-bold tracking-widest uppercase opacity-75 block mb-1">Location *</label>
                          <Input placeholder="Full address or place name — shown as a map link"
                            value={formData.location}
                            onChange={e => { setFormData({ ...formData, location: e.target.value }); setFormErrors({ ...formErrors, location: '' }); }}
                            className={cn("rounded-xl bg-white/80 text-foreground border-0 text-sm h-9", formErrors.location && "ring-2 ring-red-400")} />
                          {formErrors.location && <p className="text-red-200 text-xs">{formErrors.location}</p>}
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
                          <label className="text-xs font-bold tracking-widest uppercase opacity-75 block mb-1">Town *</label>
                          <select
                            value={formData.town}
                            onChange={e => { setFormData({ ...formData, town: e.target.value }); setFormErrors({ ...formErrors, town: '' }); }}
                            className={cn("w-full rounded-xl bg-white/80 text-foreground border-0 text-sm h-9 px-3", formErrors.town && "ring-2 ring-red-400")}>
                            <option value="">Select a town…</option>
                            {TOWNS.map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                          {formErrors.town && <p className="text-red-200 text-xs">{formErrors.town}</p>}
                        </div>

                        {/* ── Schedule type toggle ── */}
                        <div>
                          <label className="text-xs font-bold tracking-widest uppercase opacity-75 block mb-1.5">Schedule</label>
                          <div className="flex gap-2 mb-2">
                            <button type="button"
                              onClick={() => setIsRecurring(false)}
                              className={cn(
                                "flex-1 h-9 rounded-xl text-sm font-semibold border transition-all",
                                !isRecurring ? "bg-white text-primary border-white" : "bg-white/20 text-white border-white/30 hover:bg-white/30"
                              )}>
                              📅 One-time
                            </button>
                            <button type="button"
                              onClick={() => setIsRecurring(true)}
                              className={cn(
                                "flex-1 h-9 rounded-xl text-sm font-semibold border transition-all",
                                isRecurring ? "bg-white text-primary border-white" : "bg-white/20 text-white border-white/30 hover:bg-white/30"
                              )}>
                              🔁 Weekly
                            </button>
                          </div>

                          {/* One-time: regular date picker */}
                          {!isRecurring && (
                            <div>
                              <Input type="datetime-local" min={todayStr}
                                value={formData.date}
                                onChange={e => { setFormData({ ...formData, date: e.target.value }); setFormErrors({ ...formErrors, date: '' }); }}
                                className={cn("rounded-xl bg-white/80 text-foreground border-0 text-sm h-9", formErrors.date && "ring-2 ring-red-400")} />
                              {formErrors.date && <p className="text-red-200 text-xs mt-1">{formErrors.date}</p>}
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
                                  className="rounded-xl bg-white/80 text-foreground border-0 text-sm h-9 flex-1" />
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
                      <div className="bg-white/15 backdrop-blur-md rounded-2xl p-4 border border-white/20 space-y-2">
                        <label className="text-xs font-bold tracking-widest uppercase opacity-75 block">Duration (hours)</label>
                        <Input type="number" min={0.5} max={24} step={0.5}
                          value={formData.duration}
                          onChange={e => setFormData({ ...formData, duration: parseFloat(e.target.value) })}
                          className="rounded-xl bg-white/80 text-foreground border-0 text-sm h-9" />
                      </div>
                      <div className="bg-white/15 backdrop-blur-md rounded-2xl p-4 border border-white/20 space-y-2">
                        <label className="text-xs font-bold tracking-widest uppercase opacity-75 block">Spots</label>
                        <div className="flex gap-1.5 mb-2 flex-wrap">
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
                            className={cn("rounded-xl bg-white/80 text-foreground border-0 text-sm h-9", formErrors.spots && "ring-2 ring-red-400")} />
                        )}
                        {spotsType === 'unlimited' && <p className="text-white/70 text-xs">Open to all</p>}
                        {spotsType === 'none' && <p className="text-white/70 text-xs">Not specified</p>}
                      </div>
                    </div>

                    {selectedTags.length > 0 && (
                      <div className="bg-white/15 backdrop-blur-md rounded-2xl p-4 border border-white/20 space-y-2">
                        <p className="text-xs font-bold tracking-widest uppercase opacity-75">Your Tags</p>
                        <div className="flex flex-wrap gap-2">
                          {selectedTags.map(tag => (
                            <span key={tag} className="px-3 py-1 bg-white/25 border border-white/40 rounded-full text-xs font-semibold">{tag}</span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Volunteer Steps */}
                    <div className="bg-white/15 backdrop-blur-md rounded-2xl p-4 border border-white/20 space-y-3">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold tracking-widest uppercase opacity-75">How to Participate *</label>
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
                              placeholder={`Step ${idx + 1}...`}
                              value={step}
                              onChange={e => {
                                const updated = [...steps];
                                updated[idx] = e.target.value;
                                setSteps(updated);
                                setFormErrors({ ...formErrors, steps: '' });
                              }}
                              className="rounded-xl bg-white/80 text-foreground border-0 text-sm h-9 flex-1"
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
                      {formErrors.steps && <p className="text-red-200 text-xs">{formErrors.steps}</p>}
                    </div>

                    {/* External signup — org's own registration page, if they use one */}
                    <div className="bg-white/15 backdrop-blur-md rounded-2xl p-4 border border-white/20 space-y-2">
                      <label className="text-xs font-bold tracking-widest uppercase opacity-75 block">
                        Signup page (optional)
                      </label>
                      <p className="text-white/60 text-xs">If volunteers need to register on your own site.</p>
                      <Input placeholder="https://your-site.org/signup"
                        value={formData.externalSignupUrl}
                        onChange={e => { setFormData({ ...formData, externalSignupUrl: e.target.value }); setFormErrors({ ...formErrors, externalSignupUrl: '' }); }}
                        className={cn("rounded-xl bg-white/80 text-foreground border-0 text-sm h-9", formErrors.externalSignupUrl && "ring-2 ring-red-400")} />
                      {formErrors.externalSignupUrl && <p className="text-red-200 text-xs">{formErrors.externalSignupUrl}</p>}
                    </div>

                    <div className="bg-white/15 backdrop-blur-md rounded-2xl p-4 border border-white/20 text-center">
                      <p className="text-xs font-bold tracking-widest uppercase opacity-75 mb-1">Posted by</p>
                      <p className="font-semibold">{currentUser?.username || 'You'}</p>
                    </div>

                    <div className="flex gap-3 pt-2">
                      <Button variant="outline" onClick={() => setCreateStep('tags')}
                        className="flex-1 rounded-full h-11 font-semibold border-white/30 text-white hover:bg-white/20 bg-transparent">
                        ← Back
                      </Button>
                      <Button onClick={handleCreate} disabled={creating || uploading}
                        className="flex-1 rounded-full h-11 font-semibold bg-white text-primary hover:bg-white/90">
                        {(creating || uploading) && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                        {uploading ? 'Uploading...' : creating ? 'Publishing...' : 'Publish Post 🚀'}
                      </Button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

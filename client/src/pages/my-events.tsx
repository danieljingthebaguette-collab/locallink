import { useEffect, useState, useRef } from 'react';
import { useLocation } from 'wouter';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useAuthStore, useOpportunitiesStore } from '@/lib/store';
import { getCategoryLabel, getEditCategoryOptions, getCategoryColor } from '@/lib/categoryUtils';
import { CATEGORIES, type Category, type Opportunity } from '@/lib/mockData';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { MapPin, Clock, Users, Calendar, XCircle, Loader2, Edit3, Trash2, ChevronUp, X, Save, Upload, Plus , QrCode } from 'lucide-react';
import CreatePostModal from '@/components/CreatePostModal';
import CropEditor, {
  type ImageTransform,
  DEFAULT_TRANSFORM,
  parseImageTransform,
  serializeImageTransform,
  imageTransformStyle,
} from '@/components/CropEditor';

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
  } catch { return null; }
}

// Was a local copy of the colour map that listed only the five legacy
// categories, so a post in any of the new ones fell through to bg-primary and
// showed up the wrong colour here while being correct everywhere else. One map,
// in categoryUtils, is the only way that stays true.


function isPast(dateStr: string) {
  return new Date(dateStr) < new Date();
}

/**
 * SQLite stores isAvailable as INTEGER 0/1.
 * The frontend may also set it to boolean true/false.
 * undefined/null/1/true → open (default).
 * 0/false → closed.
 */
function isOppClosed(opp: Opportunity): boolean {
  return !opp.isAvailable && opp.isAvailable !== undefined && opp.isAvailable !== null;
}

/**
 * The next time a weekly slot comes round, as a datetime-local string.
 *
 * Used when a recurring post is switched to a one-off: the date stored on it is
 * the first occurrence, typically months back, so carrying it over would hand
 * the organization an event that is already finished. The next Tuesday at 4pm
 * is what they almost always mean, and it is still editable.
 */
function nextOccurrence(day: number | undefined, time: string | undefined): string {
  const [h, m] = (time ?? '09:00').split(':').map(Number);
  const target = day ?? 1;
  const d = new Date();
  d.setSeconds(0, 0);
  d.setHours(h || 0, m || 0);
  // Always forward: if today is the right day but the time has gone, next week.
  let ahead = (target - d.getDay() + 7) % 7;
  if (ahead === 0 && d.getTime() <= Date.now()) ahead = 7;
  d.setDate(d.getDate() + ahead);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function MyEvents() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { isLoggedIn, currentUser } = useAuthStore();
  const { getSignedUpEvents, cancelSignup, updateOpportunity, deleteOwnOpportunity, fetchOpportunities, fetchMyPosts, myPosts, loading } = useOpportunitiesStore();

  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<Opportunity | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Opportunity | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{
    title: string; description: string; category: Category;
    location: string; date: string; duration: number; spots: number;
    spotsType: 'limited' | 'unlimited' | 'none'; image: string;
    isRecurring: boolean;
    recurringDay?: number; recurringTime?: string;
    cardTransform: ImageTransform;
    modalTransform: ImageTransform;
  }>({ title: '', description: '', category: 'volunteer', location: '', date: '', duration: 2, spots: 10, spotsType: 'limited', image: '', isRecurring: false, cardTransform: DEFAULT_TRANSFORM, modalTransform: DEFAULT_TRANSFORM });
  const [savingEdit, setSavingEdit] = useState(false);
  const [editImageFile, setEditImageFile] = useState<File | null>(null);
  const [editImagePreview, setEditImagePreview] = useState('');
  const editFileRef = useRef<HTMLInputElement>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  useEffect(() => {
    fetchOpportunities();
    if (isLoggedIn) fetchMyPosts();
  }, [fetchOpportunities, fetchMyPosts, isLoggedIn]);

  // Revoke blob URL when the preview changes or the component unmounts to prevent memory leaks
  useEffect(() => {
    return () => { if (editImagePreview) URL.revokeObjectURL(editImagePreview); };
  }, [editImagePreview]);

  if (!isLoggedIn || !currentUser) {
    return (
      <div className="min-h-screen bg-background pb-24 font-sans">
        <main className="container mx-auto px-4 py-16 text-center">
          <Calendar className="w-16 h-16 text-muted-foreground mx-auto opacity-50 mb-4" />
          <h2 className="text-2xl font-heading font-bold text-foreground mb-2">Please Login</h2>
          <p className="text-muted-foreground mb-6">You need to be logged in to view your events.</p>
          <Button onClick={() => navigate('/account')} className="rounded-md px-8">Login / Sign Up</Button>
        </main>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background pb-24 font-sans">
        <main className="container mx-auto px-4 py-16 flex flex-col items-center justify-center">
          <Loader2 className="w-10 h-10 text-primary animate-spin mb-4" />
          <p className="text-muted-foreground">Loading your events...</p>
        </main>
      </div>
    );
  }

  const signedUp = getSignedUpEvents(currentUser.id);
  // Use myPosts (all statuses including pending) for the org's own hosted section
  const hostedRaw = myPosts.filter(o => o.hostId === currentUser.id);
  // Sort: active events first, closed & past events pushed to the end
  const hosted = [...hostedRaw].sort((a, b) => {
    // Recurring events are never "past" — only check date for non-recurring
    const aInactive = (!a.isRecurring && isPast(a.date)) || isOppClosed(a);
    const bInactive = (!b.isRecurring && isPast(b.date)) || isOppClosed(b);
    if (aInactive === bInactive) return 0;
    return aInactive ? 1 : -1;
  });
  // Recurring events always stay in "upcoming" — their stored date is the first occurrence
  const upcoming = signedUp.filter(o => o.isRecurring || !isPast(o.date));
  const past = signedUp.filter(o => !o.isRecurring && isPast(o.date));

  const handleCancel = async (opp: Opportunity) => {
    setCancellingId(opp.id);
    try {
      const success = await cancelSignup(opp.id, currentUser.id);
      if (success) {
        toast({ title: 'Interest removed', description: 'You have been removed from this event.' });
      } else {
        toast({ title: 'Error', description: 'Failed to remove interest.', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Something went wrong.', variant: 'destructive' });
    } finally {
      setCancellingId(null);
      setConfirmCancel(null);
    }
  };

  const handleDelete = async (opp: Opportunity) => {
    setDeletingId(opp.id);
    const success = await deleteOwnOpportunity(opp.id);
    setDeletingId(null);
    setConfirmDelete(null);
    if (success) {
      toast({ title: 'Event deleted' });
    } else {
      // If the token was cleared (401 session expired), redirect to login
      if (!localStorage.getItem('locallink_token')) {
        toast({ title: 'Session expired', description: 'Please log in again.' });
        navigate('/account');
      } else {
        toast({ title: 'Failed to delete event', variant: 'destructive' });
      }
    }
  };

  const startEdit = (opp: Opportunity) => {
    setEditingId(opp.id);
    setEditImageFile(null);
    setEditImagePreview('');
    setEditForm({
      title: opp.title,
      description: opp.description,
      category: opp.category as Category,
      location: opp.location,
      date: opp.date,
      duration: opp.duration,
      spots: opp.spots,
      spotsType: (opp.spotsType as 'limited' | 'unlimited' | 'none') || 'limited',
      image: opp.image || '',
      isRecurring: !!opp.isRecurring,
      recurringDay: opp.recurringDay,
      recurringTime: opp.recurringTime,
      cardTransform: parseImageTransform(opp.cardObjectPosition),
      modalTransform: parseImageTransform(opp.modalObjectPosition),
    });
  };

  const handleSaveEdit = async (oppId: string) => {
    // Against the DRAFT, not the saved row: the whole point is that the two
    // differ while somebody is switching a weekly post to a one-off or back.
    const wantsRecurring = !!editForm.isRecurring;
    const missingFields = !editForm.title || !editForm.description || !editForm.location
      || (wantsRecurring ? !editForm.recurringTime : !editForm.date);
    if (missingFields) {
      toast({ title: 'Please fill in all required fields', variant: 'destructive' });
      return;
    }
    setSavingEdit(true);
    let imageUrl = editForm.image || undefined;
    if (editImageFile) {
      const uploaded = await uploadImage(editImageFile);
      if (uploaded) imageUrl = uploaded;
      else toast({ title: 'Image upload failed', description: 'Saving without new image.', variant: 'destructive' });
    }
    const success = await updateOpportunity(oppId, {
      title: editForm.title,
      description: editForm.description,
      category: editForm.category,
      location: editForm.location,
      date: editForm.date,
      duration: editForm.duration,
      spots: editForm.spots,
      spotsType: editForm.spotsType,
      image: imageUrl,
      isRecurring: !!editForm.isRecurring,
      // Recurring-specific fields — only sent when present
      ...(editForm.recurringDay !== undefined && { recurringDay: editForm.recurringDay }),
      ...(editForm.recurringTime !== undefined && { recurringTime: editForm.recurringTime }),
      cardObjectPosition: serializeImageTransform(editForm.cardTransform),
      modalObjectPosition: serializeImageTransform(editForm.modalTransform),
    });
    setSavingEdit(false);
    if (success) {
      toast({ title: 'Event updated!' });
      setEditingId(null);
      setEditImageFile(null);
      setEditImagePreview('');
    } else {
      if (!localStorage.getItem('locallink_token')) {
        toast({ title: 'Session expired', description: 'Please log in again.' });
        navigate('/account');
      } else {
        toast({ title: 'Failed to update event', variant: 'destructive' });
      }
    }
  };

  const handleToggleAvailability = async (opp: Opportunity) => {
    setTogglingId(opp.id);
    const nowOpen = !isOppClosed(opp);
    await updateOpportunity(opp.id, { isAvailable: !nowOpen });
    setTogglingId(null);
    toast({ title: nowOpen ? 'Event closed' : 'Event opened' });
  };

  return (
    <div className="min-h-screen bg-background pb-24 font-sans">
      <main className="container mx-auto px-4 py-8">
        <h2 className="text-2xl font-heading font-bold text-foreground mb-6">My Events</h2>

        {/* ── Upcoming Interested Events ── */}
        <div className="mb-8">
          <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
            <Calendar className="w-5 h-5 text-primary" />
            Events I'm Interested In ({upcoming.length})
          </h3>
          {upcoming.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed border-border p-8 text-center space-y-3">
              <Calendar className="w-10 h-10 text-muted-foreground mx-auto opacity-40" />
              <p className="text-muted-foreground font-medium">No upcoming events</p>
              <p className="text-sm text-muted-foreground">Browse opportunities and mark your interest!</p>
              <Button onClick={() => navigate('/')} variant="outline" className="rounded-md mt-2">
                Browse Opportunities
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {upcoming.map((opp) => (
                <EventCard
                  key={opp.id}
                  opp={opp}
                  type="signup"
                  cancellingId={cancellingId}
                  onRequestCancel={() => setConfirmCancel(opp)}
                />
              ))}
            </div>
          )}
        </div>

        {/* ── Past Signed-Up Events ── */}
        {past.length > 0 && (
          <div className="mb-10">
            <h3 className="text-lg font-semibold text-muted-foreground mb-4 flex items-center gap-2">
              <Clock className="w-5 h-5" />
              Past Events ({past.length})
            </h3>
            <div className="space-y-4 opacity-70">
              {past.map((opp) => (
                <EventCard key={opp.id} opp={opp} type="past" cancellingId={null} onRequestCancel={() => {}} />
              ))}
            </div>
          </div>
        )}

        {/* ── Hosted Events ── */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <Users className="w-5 h-5 text-primary" />
              Hosted Events ({hosted.length})
            </h3>
            {(currentUser.accountType === 'organization' || currentUser.isAdmin) && (
              <div className="flex gap-2">
                {/* Hours without a post. Sits beside New Post because it is the
                    same decision made differently, not a separate product. */}
                <Button variant="outline" onClick={() => navigate('/sessions')}
                  className="rounded-md h-9 px-4 text-sm font-semibold gap-1.5">
                  <QrCode className="w-4 h-4" /> Sessions
                </Button>
                <Button onClick={() => setShowCreateModal(true)} className="rounded-md h-9 px-4 text-sm font-semibold gap-1.5">
                  <Plus className="w-4 h-4" /> New Post
                </Button>
              </div>
            )}
          </div>
          {currentUser.accountType === 'volunteer' && !currentUser.isAdmin ? (
            <div className="rounded-2xl border-2 border-dashed border-border p-8 text-center space-y-3">
              <Users className="w-10 h-10 text-muted-foreground mx-auto opacity-40" />
              <p className="text-muted-foreground font-medium">Organization accounts only</p>
              <p className="text-sm text-muted-foreground">Switch to an Organization account to host and create events.</p>
            </div>
          ) : hosted.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed border-border p-8 text-center space-y-3">
              <Users className="w-10 h-10 text-muted-foreground mx-auto opacity-40" />
              <p className="text-muted-foreground font-medium">No hosted events yet</p>
              <p className="text-sm text-muted-foreground">Create an opportunity and bring your community together.</p>
              <Button onClick={() => setShowCreateModal(true)} variant="outline" className="rounded-md mt-2">
                Create an Opportunity
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {hosted.map((opp) => {
                const isClosed = isOppClosed(opp);
                // Recurring posts are always open unless the host manually closes them
                const effectiveOpen = opp.isRecurring
                  ? !isClosed
                  : !isClosed && !isPast(opp.date);
                const inactive = !effectiveOpen;
                return (
                <div key={opp.id} className={cn('rounded-2xl border border-border bg-card overflow-hidden transition-opacity', inactive && 'opacity-70')}>
                  {/* Card header */}
                  <div className="p-5 space-y-2">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 space-y-2">
                        <div className="flex flex-wrap gap-2 items-center">
                          <span className={cn('px-3 py-1 rounded-md text-xs font-bold text-white inline-block', getCategoryColor(opp.category))}>
                            {getCategoryLabel(opp.category)}
                          </span>
                          {opp.status === 'pending' && (
                            <span className="px-3 py-1 rounded-md text-xs font-bold bg-orange-500/15 text-orange-600 border border-orange-400/30">
                              ⏳ Pending Approval
                            </span>
                          )}
                          {opp.status === 'denied' && (
                            <span className="px-3 py-1 rounded-md text-xs font-bold bg-red-500/15 text-red-500 border border-red-400/30">
                              ✕ Not Approved
                            </span>
                          )}
                        </div>
                        <h3 className="font-heading font-bold text-lg text-foreground">{opp.title}</h3>
                        <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                          <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{opp.location}</span>
                          <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{opp.duration}h</span>
                          {opp.isRecurring ? (
                            isClosed ? (
                              // Host manually closed — clickable to reopen
                              <button
                                onClick={() => handleToggleAvailability(opp)}
                                disabled={togglingId === opp.id}
                                title="Click to reopen"
                                className="text-xs font-semibold text-muted-foreground bg-secondary hover:bg-red-500/10 hover:text-red-500 px-2 py-0.5 rounded-md transition-colors cursor-pointer disabled:opacity-50"
                              >
                                {togglingId === opp.id ? '…' : 'Closed'}
                              </button>
                            ) : (
                              // Always open unless manually closed — clickable to force-close
                              <button
                                onClick={() => handleToggleAvailability(opp)}
                                disabled={togglingId === opp.id}
                                title="Click to close"
                                className="text-xs font-semibold text-green-600 dark:text-green-400 bg-green-500/10 hover:bg-red-500/10 hover:text-red-500 px-2 py-0.5 rounded-md transition-colors cursor-pointer disabled:opacity-50"
                              >
                                {togglingId === opp.id ? '…' : 'Open'}
                              </button>
                            )
                          ) : isPast(opp.date) ? (
                            // Past one-time event — ended, not togglable
                            <span className="text-xs font-semibold text-muted-foreground bg-secondary px-2 py-0.5 rounded-md">Ended</span>
                          ) : isClosed ? (
                            // One-time event, manually closed — clickable to reopen
                            <button
                              onClick={() => handleToggleAvailability(opp)}
                              disabled={togglingId === opp.id}
                              title="Click to reopen"
                              className="text-xs font-semibold text-muted-foreground bg-secondary hover:bg-green-500/10 hover:text-green-600 px-2 py-0.5 rounded-md transition-colors cursor-pointer disabled:opacity-50"
                            >
                              {togglingId === opp.id ? '…' : 'Closed'}
                            </button>
                          ) : (
                            // One-time event, open — clickable to close
                            <button
                              onClick={() => handleToggleAvailability(opp)}
                              disabled={togglingId === opp.id}
                              title="Click to close"
                              className="text-xs font-semibold text-green-600 dark:text-green-400 bg-green-500/10 hover:bg-red-500/10 hover:text-red-500 px-2 py-0.5 rounded-md transition-colors cursor-pointer disabled:opacity-50"
                            >
                              {togglingId === opp.id ? '…' : 'Open'}
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {/* The codes people scan. Put first because on the day of
                            the event it is the only one that matters. */}
                        <button
                          onClick={() => navigate(`/event-code/${opp.id}`)}
                          className="p-2 rounded-xl bg-primary/10 hover:bg-primary/20 text-primary transition-colors"
                          title="Show the scan-in codes"
                          aria-label={`Show the scan-in codes for ${opp.title}`}
                        >
                          <QrCode className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => editingId === opp.id ? setEditingId(null) : startEdit(opp)}
                          className="p-2 rounded-xl bg-primary/10 hover:bg-primary/20 text-primary transition-colors"
                          title="Edit event"
                        >
                          {editingId === opp.id ? <ChevronUp className="w-4 h-4" /> : <Edit3 className="w-4 h-4" />}
                        </button>
                        <button
                          onClick={() => setConfirmDelete(opp)}
                          disabled={deletingId === opp.id}
                          className="p-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-500 transition-colors disabled:opacity-50"
                          title="Delete event"
                        >
                          {deletingId === opp.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Inline edit form */}
                  {editingId === opp.id && (
                    <div className="border-t border-border p-5 bg-secondary/20 space-y-4">
                      <p className="text-sm font-semibold text-foreground">Edit Event</p>
                      <div className="space-y-3">
                        <div className="space-y-1">
                          <label htmlFor="my-events-title" className="text-xs font-medium text-muted-foreground">Title *</label>
                          <Input id="my-events-title" value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} className="h-10 rounded-xl" />
                        </div>
                        <div className="space-y-1">
                          <label htmlFor="my-events-description" className="text-xs font-medium text-muted-foreground">Description *</label>
                          <Textarea id="my-events-description" value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} className="rounded-xl min-h-[70px]" />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <label htmlFor="my-events-category" className="text-xs font-medium text-muted-foreground">Category</label>
                            <select id="my-events-category"
                              value={editForm.category}
                              onChange={(e) => setEditForm({ ...editForm, category: e.target.value as Category })}
                              className="w-full h-10 rounded-xl border border-input bg-background px-3 text-sm"
                            >
                              {getEditCategoryOptions(editForm.category).map(c => (
                                <option key={c.value} value={c.value}>{c.label}</option>
                              ))}
                            </select>
                          </div>
                          <div className="space-y-1">
                            <label htmlFor="my-events-location" className="text-xs font-medium text-muted-foreground">Location *</label>
                            <Input id="my-events-location" value={editForm.location} onChange={(e) => setEditForm({ ...editForm, location: e.target.value })} className="h-10 rounded-xl" />
                          </div>
                        </div>
                        {/* Switching between the two. Before this the fields
                            were chosen by what was saved, so a weekly post
                            offered a day and a time and nothing else, forever --
                            an organization that stopped running something every
                            week had to delete it and start again, losing the
                            post and everyone who had signed up. */}
                        <div className="space-y-1">
                          <span className="text-xs font-medium text-muted-foreground">Schedule</span>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              aria-pressed={!editForm.isRecurring}
                              onClick={() => setEditForm({
                                ...editForm,
                                isRecurring: false,
                                // Coming from weekly there is no usable date --
                                // the stored one is the first occurrence, long
                                // past. Offer the next instance of the day and
                                // time they were already running.
                                date: editForm.date && new Date(editForm.date) > new Date()
                                  ? editForm.date
                                  : nextOccurrence(editForm.recurringDay, editForm.recurringTime),
                              })}
                              className={cn('flex-1 h-10 rounded-xl border text-sm font-semibold transition-colors cursor-pointer',
                                !editForm.isRecurring
                                  ? 'bg-foreground text-background border-foreground'
                                  : 'bg-background text-muted-foreground border-input hover:bg-accent')}
                            >
                              One-time
                            </button>
                            <button
                              type="button"
                              aria-pressed={!!editForm.isRecurring}
                              onClick={() => setEditForm({
                                ...editForm,
                                isRecurring: true,
                                // Seed the weekly slot from the date they had,
                                // so the common "same time every week from now
                                // on" needs no retyping.
                                recurringDay: editForm.recurringDay ?? (editForm.date ? new Date(editForm.date).getDay() : 1),
                                recurringTime: editForm.recurringTime
                                  ?? (editForm.date ? editForm.date.slice(11, 16) : '09:00'),
                              })}
                              className={cn('flex-1 h-10 rounded-xl border text-sm font-semibold transition-colors cursor-pointer',
                                editForm.isRecurring
                                  ? 'bg-foreground text-background border-foreground'
                                  : 'bg-background text-muted-foreground border-input hover:bg-accent')}
                            >
                              Every week
                            </button>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {editForm.isRecurring
                              ? 'Repeats weekly and never shows as finished.'
                              : 'Happens once, on the date below.'}
                          </p>
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                          {editForm.isRecurring ? (
                            <>
                              <div className="space-y-1">
                                <label htmlFor="my-events-day-of-week" className="text-xs font-medium text-muted-foreground">Day of Week</label>
                                <select id="my-events-day-of-week"
                                  value={editForm.recurringDay ?? 1}
                                  onChange={(e) => setEditForm({ ...editForm, recurringDay: parseInt(e.target.value) })}
                                  className="w-full h-10 rounded-xl border border-input bg-background px-3 text-sm"
                                >
                                  {['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map((d, i) => (
                                    <option key={d} value={i}>{d}</option>
                                  ))}
                                </select>
                              </div>
                              <div className="space-y-1">
                                <label htmlFor="my-events-time" className="text-xs font-medium text-muted-foreground">Time</label>
                                <Input id="my-events-time"
                                  type="time"
                                  value={editForm.recurringTime ?? '09:00'}
                                  onChange={(e) => setEditForm({ ...editForm, recurringTime: e.target.value })}
                                  className="h-10 rounded-xl"
                                />
                              </div>
                            </>
                          ) : (
                            <div className="space-y-1">
                              <label htmlFor="my-events-date-time" className="text-xs font-medium text-muted-foreground">Date & Time *</label>
                              <Input id="my-events-date-time" type="datetime-local" value={editForm.date} onChange={(e) => setEditForm({ ...editForm, date: e.target.value })} className="h-10 rounded-xl" />
                            </div>
                          )}
                          <div className="space-y-1">
                            <label htmlFor="my-events-duration-hrs" className="text-xs font-medium text-muted-foreground">Duration (hrs)</label>
                            <Input id="my-events-duration-hrs" type="number" min={0.5} max={24} step={0.5} value={editForm.duration} onChange={(e) => setEditForm({ ...editForm, duration: parseFloat(e.target.value) || 0.5 })} className="h-10 rounded-xl" />
                          </div>
                          <div className="space-y-1">
                            <label htmlFor="my-events-approx-capacity" className="text-xs font-medium text-muted-foreground">Approx. Capacity</label>
                            <Input id="my-events-approx-capacity" type="number" min={0} max={1000} value={editForm.spots} onChange={(e) => setEditForm({ ...editForm, spots: parseInt(e.target.value) || 0 })} className="h-10 rounded-xl" />
                          </div>
                        </div>
                        {/* Image Upload */}
                        <div className="space-y-1">
                          <label htmlFor="my-events-image-optional" className="text-xs font-medium text-muted-foreground">Image (optional)</label>
                          <input id="my-events-image-optional" ref={editFileRef} type="file" accept="image/*" className="hidden"
                            onChange={e => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              setEditImageFile(file);
                              setEditImagePreview(URL.createObjectURL(file));
                            }} />
                          <button type="button" onClick={() => editFileRef.current?.click()}
                            className="w-full h-10 rounded-xl border border-input bg-background px-3 text-sm text-left flex items-center gap-2 hover:bg-secondary/50 transition-colors text-muted-foreground">
                            <Upload className="w-4 h-4" />
                            {editImageFile ? editImageFile.name : (editForm.image ? 'Current image — click to replace' : 'Choose image...')}
                          </button>
                          {(editImagePreview || editForm.image) && (
                            <div className="relative rounded-xl overflow-hidden h-24 bg-secondary mt-1">
                              <img src={editImagePreview || editForm.image} alt="Preview" className="w-full h-full" style={imageTransformStyle(editForm.cardTransform)} />
                              <button type="button"
                                onClick={() => { setEditImageFile(null); setEditImagePreview(''); setEditForm({ ...editForm, image: '' }); if (editFileRef.current) editFileRef.current.value = ''; }}
                                className="absolute top-1 right-1 bg-black/60 rounded-md p-1 text-white hover:bg-black/80 transition-colors">
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          )}
                          {/* Image crop editors — drag to pan, scroll/pinch to zoom */}
                          {(editImagePreview || editForm.image) && (
                            <div className="space-y-2 pt-2">
                              <CropEditor
                                src={editImagePreview || editForm.image}
                                label="Board Card Crop"
                                value={editForm.cardTransform}
                                onChange={t => setEditForm(f => ({ ...f, cardTransform: t }))}
                              />
                              <CropEditor
                                src={editImagePreview || editForm.image}
                                label="Post Banner Crop"
                                value={editForm.modalTransform}
                                onChange={t => setEditForm(f => ({ ...f, modalTransform: t }))}
                              />
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-3">
                        <Button variant="outline" onClick={() => setEditingId(null)} className="flex-1 h-10 rounded-md font-semibold">
                          <X className="w-4 h-4 mr-1" /> Cancel
                        </Button>
                        <Button onClick={() => handleSaveEdit(opp.id)} disabled={savingEdit} className="flex-1 h-10 rounded-md font-semibold">
                          {savingEdit ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Save className="w-4 h-4 mr-1" />}
                          {savingEdit ? 'Saving...' : 'Save Changes'}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
                );
              })}
            </div>
          )}
        </div>
      </main>

      {/* Remove interest confirmation */}
      <AlertDialog open={!!confirmCancel} onOpenChange={(open) => !open && setConfirmCancel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Interest?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove your interest in <strong>{confirmCancel?.title}</strong>?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Stay Interested</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmCancel && handleCancel(confirmCancel)}
              className="bg-red-500 hover:bg-red-600"
            >
              Remove Interest
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Create Post Modal */}
      <CreatePostModal open={showCreateModal} onClose={() => setShowCreateModal(false)} />

      {/* Delete hosted event confirmation */}
      <AlertDialog open={!!confirmDelete} onOpenChange={(open) => !open && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Event?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{confirmDelete?.title}</strong>? This will remove all signups and cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Event</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmDelete && handleDelete(confirmDelete)}
              className="bg-red-500 hover:bg-red-600"
            >
              Delete Event
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Shared event card for signup/past rows ──
function EventCard({
  opp, type, cancellingId, onRequestCancel,
}: {
  opp: Opportunity;
  type: 'signup' | 'past';
  cancellingId: string | null;
  onRequestCancel: () => void;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 hover:shadow-md transition-all">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 space-y-2">
          <div className="flex flex-wrap gap-2 items-center">
            <span className={cn('px-3 py-1 rounded-md text-xs font-bold text-white inline-block', getCategoryColor(opp.category))}>
              {getCategoryLabel(opp.category)}
            </span>
          </div>
          <h3 className="font-heading font-bold text-lg text-foreground">{opp.title}</h3>
          <p className="text-muted-foreground text-sm line-clamp-2">{opp.description}</p>
          <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{opp.location}</span>
            <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{opp.duration}h</span>
            <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" />Host: {opp.hostName}</span>
          </div>
        </div>
        {type === 'signup' && (
          <button
            onClick={onRequestCancel}
            disabled={cancellingId === opp.id}
            className="px-3 py-2 text-xs font-semibold bg-red-500/10 hover:bg-red-500/20 border border-red-400/30 rounded-xl text-red-500 transition-all flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
          >
            {cancellingId === opp.id ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <XCircle className="w-3.5 h-3.5" />
            )}
            {cancellingId === opp.id ? 'Removing...' : 'Remove Interest'}
          </button>
        )}
        {type === 'past' && (
          <span className="text-xs font-semibold text-muted-foreground bg-secondary px-3 py-1.5 rounded-md flex-shrink-0">Completed</span>
        )}
      </div>
    </div>
  );
}

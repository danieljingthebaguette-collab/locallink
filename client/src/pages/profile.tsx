import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useAuthStore, useOpportunitiesStore, useFavoritesStore } from '@/lib/store';
import { User, Mail, Award, Calendar, LogOut, Loader2, Edit3, Lock, Save, X, Heart, Building2, Handshake, Bell, Camera, Sparkles, AlertTriangle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import ConfirmBubble from '@/components/ConfirmBubble';

export default function Profile() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { isLoggedIn, currentUser, logout, updateProfile, loading, showOnboardingPrompt } = useAuthStore();
  const { getSignedUpEvents, getHostedEvents, fetchOpportunities, loading: opLoading, loaded } = useOpportunitiesStore();
  const { favorites, fetchFavorites, removeFavorite } = useFavoritesStore();

  const [editOpen, setEditOpen] = useState(false);
  const [editData, setEditData] = useState({ username: '', currentPassword: '', newPassword: '', confirmPassword: '' });
  const [editErrors, setEditErrors] = useState<{ username?: string; currentPassword?: string; newPassword?: string; confirmPassword?: string }>({});
  const [saving, setSaving] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [orgEditOpen, setOrgEditOpen] = useState(false);
  const [orgForm, setOrgForm] = useState({
    orgDescription: currentUser?.orgDescription || '',
    orgWebsite: currentUser?.orgWebsite || '',
    orgEmail: currentUser?.orgEmail || '',
    orgPhone: currentUser?.orgPhone || '',
  });
  const [orgSaving, setOrgSaving] = useState(false);
  const [showUpgradeConfirm, setShowUpgradeConfirm] = useState(false);
  const [upgrading, setUpgrading] = useState(false);

  const handleUpgradeToOrg = async () => {
    setShowUpgradeConfirm(false);
    setUpgrading(true);
    const result = await updateProfile({ accountType: 'organization' });
    setUpgrading(false);
    if (result.success) {
      toast({
        title: 'You now have an organization account',
        description: 'Add a description and contact email below, then you can post opportunities.',
      });
    } else {
      toast({ title: result.error || 'Could not switch account type', variant: 'destructive' });
    }
  };

  useEffect(() => {
    fetchOpportunities();
  }, [fetchOpportunities]);

  useEffect(() => {
    if (isLoggedIn) fetchFavorites();
  }, [isLoggedIn, fetchFavorites]);

  useEffect(() => {
    if (currentUser) {
      setEditData((d) => ({ ...d, username: currentUser.username }));
    }
  }, [currentUser]);


  if (!isLoggedIn || !currentUser) {
    return (
      <div className="min-h-screen bg-background pb-24 font-sans">
        <main className="container mx-auto px-4 py-16 text-center">
          <User className="w-16 h-16 text-muted-foreground mx-auto opacity-50 mb-4" />
          <h2 className="text-2xl font-heading font-bold text-foreground mb-2">Please Login</h2>
          <p className="text-muted-foreground mb-6">You need to be logged in to view your profile.</p>
          <Button onClick={() => navigate('/account')} className="rounded-md px-8">
            Login / Sign Up
          </Button>
        </main>
      </div>
    );
  }

  const signedUp = getSignedUpEvents(currentUser.id);
  const hosted = getHostedEvents(currentUser.id);

  const openEdit = () => {
    setEditData({ username: currentUser.username, currentPassword: '', newPassword: '', confirmPassword: '' });
    setEditErrors({});
    setEditOpen(true);
  };

  const handleSave = async () => {
    const errors: typeof editErrors = {};
    if (!editData.username.trim()) errors.username = 'Username is required';
    if (editData.newPassword) {
      if (!editData.currentPassword) errors.currentPassword = 'Required to change password';
      if (editData.newPassword.length < 8) errors.newPassword = 'Min 8 characters';
      if (editData.newPassword !== editData.confirmPassword) errors.confirmPassword = 'Passwords do not match';
    }
    setEditErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setSaving(true);
    const payload: { username?: string; currentPassword?: string; newPassword?: string } = {};
    if (editData.username.trim() !== currentUser.username) payload.username = editData.username.trim();
    if (editData.newPassword) {
      payload.currentPassword = editData.currentPassword;
      payload.newPassword = editData.newPassword;
    }

    const result = await updateProfile(payload);
    setSaving(false);
    if (result.success) {
      toast({ title: 'Profile updated!' });
      setEditOpen(false);
    } else {
      toast({ title: result.error || 'Update failed', variant: 'destructive' });
    }
  };

  const handleUnfavorite = async (orgId: string) => {
    await removeFavorite(orgId);
    toast({ title: 'Removed from favorites' });
  };


  const handleToggleNotifyOnReopen = async () => {
    const newValue = !(currentUser.notifyOnReopen ?? true);
    const result = await updateProfile({ notifyOnReopen: newValue });
    if (result.success) {
      toast({ title: newValue ? 'Reopen email reminders enabled' : 'Reopen email reminders disabled' });
    } else {
      toast({ title: result.error || 'Failed to update setting', variant: 'destructive' });
    }
  };

  const handleToggleNotifyOnInterest = async () => {
    const newValue = !(currentUser.notifyOnInterest ?? true);
    const result = await updateProfile({ notifyOnInterest: newValue });
    if (result.success) {
      toast({ title: newValue ? 'Interest notifications enabled' : 'Interest notifications disabled' });
    } else {
      toast({ title: result.error || 'Failed to update setting', variant: 'destructive' });
    }
  };

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!fileInputRef.current) return;
    fileInputRef.current.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast({ title: 'Please select an image file', variant: 'destructive' });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: 'Image must be under 5 MB', variant: 'destructive' });
      return;
    }
    setAvatarUploading(true);
    try {
      const token = localStorage.getItem('locallink_token');
      const formData = new FormData();
      formData.append('image', file);
      const uploadRes = await fetch('/api/upload', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      if (!uploadRes.ok) {
        toast({ title: 'Upload failed', variant: 'destructive' });
        setAvatarUploading(false);
        return;
      }
      const { url } = await uploadRes.json();
      const result = await updateProfile({ profileImage: url });
      if (result.success) {
        toast({ title: 'Profile picture updated!' });
      } else {
        toast({ title: result.error || 'Failed to save image', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Network error', variant: 'destructive' });
    }
    setAvatarUploading(false);
  };

  return (
    <div className="min-h-screen bg-background pb-24 font-sans">
      <main className="container mx-auto px-4 py-8 max-w-2xl">

        {/* Profile Header */}
        <div className="rounded-3xl border border-border bg-card p-8 text-center mb-8 relative">
          <button
            onClick={openEdit}
            className="absolute top-4 right-4 p-2 rounded-md hover:bg-secondary transition-colors text-muted-foreground"
            title="Edit profile"
          >
            <Edit3 className="w-4 h-4" />
          </button>
          {/* Clickable avatar with upload overlay */}
          <div className="relative inline-block mx-auto mb-4">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarChange}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={avatarUploading}
              className="group relative w-20 h-20 rounded-full overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              title="Change profile picture"
            >
              {currentUser.profileImage ? (
                <img
                  src={currentUser.profileImage}
                  alt={currentUser.username}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full bg-primary/10 flex items-center justify-center">
                  <User className="w-10 h-10 text-primary" />
                </div>
              )}
              {/* Hover / uploading overlay */}
              <div className={cn(
                'absolute inset-0 flex flex-col items-center justify-center rounded-md transition-opacity bg-black/40',
                avatarUploading ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
              )}>
                {avatarUploading
                  ? <Loader2 className="w-6 h-6 text-white animate-spin" />
                  : <Camera className="w-6 h-6 text-white" />
                }
              </div>
            </button>
          </div>
          <h2 className="text-2xl font-heading font-bold text-foreground">{currentUser.username}</h2>
          <p className="text-muted-foreground flex items-center justify-center gap-1 mt-1">
            <Mail className="w-4 h-4" />
            {currentUser.email}
          </p>
          <div className="flex items-center justify-center gap-3 mt-2">
            <p className="text-xs text-muted-foreground">
              Member since {new Date(currentUser.createdAt).toLocaleDateString()}
            </p>
            <span className={cn(
              "text-xs font-semibold px-2 py-0.5 rounded-md inline-flex items-center gap-1",
              currentUser.accountType === 'organization'
                ? "bg-primary/10 text-primary"
                : "bg-secondary text-muted-foreground"
            )}>
              {currentUser.accountType === 'organization'
                ? <><Building2 className="w-3 h-3" /> Organization</>
                : <><Handshake className="w-3 h-3" /> Volunteer</>}
            </span>
          </div>
        </div>

        {/* Edit Profile Panel */}
        {editOpen && (
          <div className="rounded-3xl border-2 border-primary/30 bg-card p-6 mb-8 space-y-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-heading font-bold text-lg text-foreground flex items-center gap-2">
                <Edit3 className="w-5 h-5 text-primary" />
                Edit Profile
              </h3>
              <button onClick={() => setEditOpen(false)} className="p-1.5 rounded-md hover:bg-secondary transition-colors">
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>

            {/* Username */}
            <div className="space-y-1">
              <label htmlFor="profile-username" className="text-sm font-semibold text-foreground">Username</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input id="profile-username"
                  value={editData.username}
                  onChange={(e) => { setEditData({ ...editData, username: e.target.value }); setEditErrors({ ...editErrors, username: undefined }); }}
                  className={cn('pl-10 h-11 rounded-xl border-2', editErrors.username ? 'border-red-400' : 'border-border')}
                />
              </div>
              {editErrors.username && <p className="text-xs text-red-600">{editErrors.username}</p>}
            </div>

            <div className="border-t border-border pt-4 space-y-1">
              <p className="text-sm font-semibold text-foreground mb-3">Change Password <span className="font-normal text-muted-foreground">(optional)</span></p>

              <div className="space-y-3">
                <div className="space-y-1">
                  <label htmlFor="profile-current-password" className="text-xs text-muted-foreground">Current Password</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input id="profile-current-password"
                      type="password"
                      placeholder="Current password"
                      value={editData.currentPassword}
                      onChange={(e) => { setEditData({ ...editData, currentPassword: e.target.value }); setEditErrors({ ...editErrors, currentPassword: undefined }); }}
                      className={cn('pl-10 h-11 rounded-xl border-2', editErrors.currentPassword ? 'border-red-400' : 'border-border')}
                    />
                  </div>
                  {editErrors.currentPassword && <p className="text-xs text-red-600">{editErrors.currentPassword}</p>}
                </div>
                <div className="space-y-1">
                  <label htmlFor="profile-new-password" className="text-xs text-muted-foreground">New Password</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input id="profile-new-password"
                      type="password"
                      placeholder="New password (min. 8 characters)"
                      value={editData.newPassword}
                      onChange={(e) => { setEditData({ ...editData, newPassword: e.target.value }); setEditErrors({ ...editErrors, newPassword: undefined }); }}
                      className={cn('pl-10 h-11 rounded-xl border-2', editErrors.newPassword ? 'border-red-400' : 'border-border')}
                    />
                  </div>
                  {editErrors.newPassword && <p className="text-xs text-red-600">{editErrors.newPassword}</p>}
                </div>
                <div className="space-y-1">
                  <label htmlFor="profile-confirm-new-password" className="text-xs text-muted-foreground">Confirm New Password</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input id="profile-confirm-new-password"
                      type="password"
                      placeholder="Confirm new password"
                      value={editData.confirmPassword}
                      onChange={(e) => { setEditData({ ...editData, confirmPassword: e.target.value }); setEditErrors({ ...editErrors, confirmPassword: undefined }); }}
                      className={cn('pl-10 h-11 rounded-xl border-2', editErrors.confirmPassword ? 'border-red-400' : 'border-border')}
                    />
                  </div>
                  {editErrors.confirmPassword && <p className="text-xs text-red-600">{editErrors.confirmPassword}</p>}
                </div>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <Button variant="outline" onClick={() => setEditOpen(false)} className="flex-1 h-11 rounded-md font-semibold">
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={saving} className="flex-1 h-11 rounded-md font-semibold">
                {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                {saving ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </div>
        )}

        {/* Organization Profile — only for org accounts */}
        {currentUser.accountType === 'organization' && (
          <div className="rounded-3xl border border-border bg-card p-6 mb-8">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-heading font-bold text-lg text-foreground flex items-center gap-2">
                <Building2 className="w-5 h-5 text-primary" />
                Organization Profile
              </h3>
              <button
                onClick={() => {
                  setOrgForm({
                    orgDescription: currentUser.orgDescription || '',
                    orgWebsite: currentUser.orgWebsite || '',
                    orgEmail: currentUser.orgEmail || '',
                    orgPhone: currentUser.orgPhone || '',
                  });
                  setOrgEditOpen(o => !o);
                }}
                className="p-2 rounded-md hover:bg-secondary transition-colors text-muted-foreground"
                title="Edit organization profile"
              >
                <Edit3 className="w-4 h-4" />
              </button>
            </div>

            {/* Incomplete profile warning */}
            {(!currentUser.orgDescription || !currentUser.orgEmail) && !orgEditOpen && (
              <div className="mb-4 rounded-2xl border-2 border-orange-400/40 bg-orange-500/10 p-4 flex gap-3 items-start">
                <AlertTriangle className="w-4 h-4 text-orange-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-orange-600">Profile Incomplete</p>
                  <p className="text-xs text-orange-500/80 mt-0.5">You must complete your organization profile before you can post opportunities.</p>
                </div>
              </div>
            )}

            {!orgEditOpen && (
              <div className="space-y-3">
                {currentUser.orgDescription ? (
                  <div>
                    <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">About</p>
                    <p className="text-sm text-foreground leading-relaxed">{currentUser.orgDescription}</p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground italic">No description yet. Click edit to add one.</p>
                )}
                {currentUser.orgWebsite && (
                  <div>
                    <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">Website</p>
                    <a href={currentUser.orgWebsite.startsWith('http') ? currentUser.orgWebsite : `https://${currentUser.orgWebsite}`} target="_blank" rel="noopener noreferrer"
                      className="text-sm text-primary hover:underline break-all">{currentUser.orgWebsite}</a>
                  </div>
                )}
                {(currentUser.orgEmail || currentUser.orgPhone) && (
                  <div>
                    <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">Contact</p>
                    {currentUser.orgEmail && <p className="text-sm text-foreground">{currentUser.orgEmail}</p>}
                    {currentUser.orgPhone && <p className="text-sm text-foreground">{currentUser.orgPhone}</p>}
                  </div>
                )}
              </div>
            )}

            {orgEditOpen && (
              <div className="space-y-4">
                <div className="space-y-1">
                  <label htmlFor="profile-about-your-organization" className="text-sm font-semibold text-foreground">About Your Organization *</label>
                  <Textarea id="profile-about-your-organization"
                    placeholder="Briefly describe what your organization does and your goals..."
                    value={orgForm.orgDescription}
                    onChange={e => setOrgForm(f => ({ ...f, orgDescription: e.target.value }))}
                    className="rounded-xl border border-border resize-none min-h-[100px]"
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="profile-website-url" className="text-sm font-semibold text-foreground">Website URL</label>
                  <Input id="profile-website-url"
                    placeholder="https://yourorg.org"
                    value={orgForm.orgWebsite}
                    onChange={e => setOrgForm(f => ({ ...f, orgWebsite: e.target.value }))}
                    className="rounded-xl border border-border h-11"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label htmlFor="profile-contact-email" className="text-sm font-semibold text-foreground">Contact Email *</label>
                    <Input id="profile-contact-email"
                      type="email"
                      placeholder="contact@yourorg.org"
                      value={orgForm.orgEmail}
                      onChange={e => setOrgForm(f => ({ ...f, orgEmail: e.target.value }))}
                      className="rounded-xl border border-border h-11"
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="profile-contact-phone" className="text-sm font-semibold text-foreground">Contact Phone</label>
                    <Input id="profile-contact-phone"
                      type="tel"
                      placeholder="(555) 555-5555"
                      value={orgForm.orgPhone}
                      onChange={e => setOrgForm(f => ({ ...f, orgPhone: e.target.value }))}
                      className="rounded-xl border border-border h-11"
                    />
                  </div>
                </div>
                <div className="flex gap-3 pt-1">
                  <Button variant="outline" onClick={() => setOrgEditOpen(false)} className="flex-1 h-11 rounded-md font-semibold">
                    Cancel
                  </Button>
                  <Button
                    onClick={async () => {
                      if (!orgForm.orgDescription.trim()) {
                        toast({ title: 'Description is required', variant: 'destructive' });
                        return;
                      }
                      if (!orgForm.orgEmail.trim()) {
                        toast({ title: 'Contact email is required', variant: 'destructive' });
                        return;
                      }
                      setOrgSaving(true);
                      const result = await updateProfile({
                        orgDescription: orgForm.orgDescription.trim(),
                        orgWebsite: orgForm.orgWebsite.trim() || null,
                        orgEmail: orgForm.orgEmail.trim(),
                        orgPhone: orgForm.orgPhone.trim() || null,
                      });
                      setOrgSaving(false);
                      if (result.success) {
                        toast({ title: 'Organization profile updated!' });
                        setOrgEditOpen(false);
                      } else {
                        toast({ title: result.error || 'Update failed', variant: 'destructive' });
                      }
                    }}
                    disabled={orgSaving}
                    className="flex-1 h-11 rounded-md font-semibold"
                  >
                    {orgSaving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                    {orgSaving ? 'Saving...' : 'Save Profile'}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Onboarding reminder — a plain profile-completeness nudge. Same
            standing-reminder shape as the bell notification (Navigation.tsx)
            and driven by the same store action, so either one reopens the
            identical modal. */}
        {currentUser.accountType === 'volunteer' && !currentUser.onboardingCompletedAt && (
          <div className="rounded-2xl border border-primary/30 bg-primary/5 p-5 mb-6 flex items-start gap-4">
            <div className="w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-4 h-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-heading font-bold text-foreground mb-0.5">Tell us a bit about you</h3>
              <p className="text-sm text-muted-foreground leading-relaxed mb-3">
                Takes under a minute, and helps us show you opportunities that actually fit.
              </p>
              <Button size="sm" onClick={showOnboardingPrompt} className="rounded-md">
                Fill it out
              </Button>
            </div>
          </div>
        )}

        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-3 mb-8">
          {[
            // Volunteers never host (the upgrade only runs one way), so that
            // tile was permanently 0 for them — favorited orgs take the slot
            // instead. Both tiles now read from data this build actually has,
            // with no dependency on verified-hours tracking.
            currentUser.accountType === 'organization'
              ? { icon: Calendar, label: 'Events Hosted', value: opLoading && !loaded ? '...' : hosted.length }
              : { icon: Heart, label: 'Orgs Favorited', value: favorites.length },
            { icon: Award, label: 'Events Interested', value: opLoading && !loaded ? '...' : signedUp.length },
          ].map((stat) => (
            // No per-tile colour. Green and purple here encoded nothing -- two
            // counts of the same kind of thing, tinted differently for decoration,
            // which is exactly the habit that makes a dashboard read as generated.
            // The number is the data; the icon just labels it.
            <div key={stat.label} className="rounded-2xl border border-border bg-card p-4 text-left">
              <stat.icon className="w-4 h-4 mb-3 text-muted-foreground" />
              <p className="text-2xl font-bold text-foreground tabular-nums leading-none">{stat.value}</p>
              <p className="text-[11px] text-muted-foreground font-medium leading-tight mt-1.5">{stat.label}</p>
            </div>
          ))}
        </div>

        {/* Hosting summary stays for organizations only. */}
        {currentUser.accountType === 'organization' && (
          <div className="rounded-2xl border border-border bg-card p-6 mb-6">
            <h3 className="font-heading font-bold text-lg text-foreground mb-4">Activity Summary</h3>
            {opLoading && !loaded ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between py-2 border-b border-border">
                  <span className="text-muted-foreground">Events Interested In</span>
                  <span className="font-bold text-foreground">{signedUp.length}</span>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="text-muted-foreground">Events Hosted</span>
                  <span className="font-bold text-foreground">{hosted.length}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Notification Settings — shown to all logged-in users */}
        <div className="rounded-2xl border border-border bg-card p-6 mb-6">
          <h3 className="font-heading font-bold text-lg text-foreground mb-4 flex items-center gap-2">
            <Bell className="w-5 h-5 text-primary" />
            Notification Settings
          </h3>

          {/* Reopen email reminder — all users */}
          <div className="flex items-center justify-between py-2">
            <div className="flex-1 pr-4">
              <p className="text-sm font-semibold text-foreground">Recurring event email reminders</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Get a Gmail reminder the day before a recurring event you signed up for reopens
              </p>
            </div>
            <button
              onClick={handleToggleNotifyOnReopen}
              title={(currentUser.notifyOnReopen ?? true) ? 'Disable reopen email reminders' : 'Enable reopen email reminders'}
              className={cn(
                'relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none',
                (currentUser.notifyOnReopen ?? true) ? 'bg-primary' : 'bg-muted-foreground/30'
              )}
            >
              <span
                className={cn(
                  'inline-block h-4 w-4 rounded-full bg-white shadow transition-transform',
                  (currentUser.notifyOnReopen ?? true) ? 'translate-x-6' : 'translate-x-1'
                )}
              />
            </button>
          </div>

          {/* Interest notifications — organizations only */}
          {currentUser.accountType === 'organization' && (
            <div className="flex items-center justify-between py-2 border-t border-border mt-2 pt-4">
              <div className="flex-1 pr-4">
                <p className="text-sm font-semibold text-foreground">Notify me when someone expresses interest</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Get a bell notification and an email when a volunteer taps "I'm Interested" on one of your posts
                </p>
              </div>
              <button
                onClick={handleToggleNotifyOnInterest}
                title={(currentUser.notifyOnInterest ?? true) ? 'Disable interest notifications' : 'Enable interest notifications'}
                className={cn(
                  'relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none',
                  (currentUser.notifyOnInterest ?? true) ? 'bg-primary' : 'bg-muted-foreground/30'
                )}
              >
                <span
                  className={cn(
                    'inline-block h-4 w-4 rounded-full bg-white shadow transition-transform',
                    (currentUser.notifyOnInterest ?? true) ? 'translate-x-6' : 'translate-x-1'
                  )}
                />
              </button>
            </div>
          )}

          {/* Email reminder toggle — volunteers only */}
          {currentUser.accountType === 'volunteer' && (
            <div className="flex items-center justify-between py-2 border-t border-border mt-2 pt-4">
              <div className="flex-1 pr-4">
                <p className="text-sm font-semibold text-foreground">Event reminder emails</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Get an email 24 hours before events you have signed up for
                </p>
                {!(currentUser.emailReminders ?? true) && (
                  <p className="text-xs text-orange-500 mt-1 leading-relaxed">
                    ⚠️ Important account notifications (approvals, etc.) will still be sent
                  </p>
                )}
              </div>
              <button
                onClick={async () => {
                  const newValue = !(currentUser.emailReminders ?? true);
                  const result = await updateProfile({ emailReminders: newValue });
                  if (result.success) {
                    toast({ title: newValue ? 'Event reminders enabled' : 'Event reminders disabled' });
                  } else {
                    toast({ title: result.error || 'Failed to update', variant: 'destructive' });
                  }
                }}
                className={cn(
                  'relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none',
                  (currentUser.emailReminders ?? true) ? 'bg-primary' : 'bg-muted-foreground/30'
                )}
              >
                <span className={cn(
                  'inline-block h-4 w-4 rounded-full bg-white shadow transition-transform',
                  (currentUser.emailReminders ?? true) ? 'translate-x-6' : 'translate-x-1'
                )} />
              </button>
            </div>
          )}

        </div>

        {/* Switch to an organization account — volunteers only, and one-way.
            Previously the account type was fixed at registration with no way to
            change it, while the board told anyone who tried to post to "update
            your account type in settings". This is that setting. */}
        {currentUser.accountType === 'volunteer' && (
          <div className="rounded-2xl border border-border bg-card p-6 mb-8">
            <h3 className="font-heading font-bold text-lg text-foreground mb-1 flex items-center gap-2">
              <Building2 className="w-5 h-5 text-primary" />
              Post your own opportunities
            </h3>
            <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
              Volunteer accounts can browse and show interest. To post opportunities of your own,
              switch to an organization account. You'll add a description and contact email, and
              your posts are reviewed before they appear on the board.
            </p>
            <p className="text-xs text-muted-foreground mb-4">
              This can't be undone — organization accounts can't switch back.
            </p>
            <Button
              onClick={() => setShowUpgradeConfirm(true)}
              disabled={upgrading}
              className="rounded-md px-6 font-semibold"
            >
              {upgrading && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Switch to an organization account
            </Button>
          </div>
        )}

        {/* Favorite Organizations */}
        <div className="rounded-2xl border border-border bg-card p-6 mb-8">
          <h3 className="font-heading font-bold text-lg text-foreground mb-4 flex items-center gap-2">
            <Heart className="w-5 h-5 text-red-400" />
            Favorite Organizations
          </h3>
          {favorites.length === 0 ? (
            <div className="text-center py-6 space-y-2">
              <Building2 className="w-8 h-8 text-muted-foreground mx-auto opacity-40" />
              <p className="text-sm text-muted-foreground">No favorites yet</p>
              <p className="text-xs text-muted-foreground">Heart an organization on any event post to save them here.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {favorites.map(org => (
                <div key={org.id} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">
                      {org.username.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground">{org.username}</p>
                      <p className="text-xs text-muted-foreground">{org.orgEmail || 'no public email listed'}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleUnfavorite(org.id)}
                    className="p-1.5 rounded-md hover:bg-red-50 transition-colors text-red-400 hover:text-red-500"
                    title="Remove from favorites"
                  >
                    <Heart className="w-4 h-4 fill-current" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Logout Button */}
        <Button
          variant="outline"
          onClick={() => { logout(); navigate('/'); }}
          className="w-full h-11 rounded-md font-semibold text-red-500 border-red-200 hover:bg-red-50"
        >
          <LogOut className="w-4 h-4 mr-2" />
          Logout
        </Button>
      </main>

      {/* One-way change, so it gets a confirmation */}
      <ConfirmBubble
        open={showUpgradeConfirm}
        icon={<Building2 className="w-4 h-4 text-primary" />}
        title="Switch to an organization account?"
        message="You'll be able to post opportunities. This can't be undone — organization accounts can't switch back to volunteer."
        destructiveLabel="Switch"
        onDestructive={handleUpgradeToOrg}
        cancelLabel="Never mind"
        onCancel={() => setShowUpgradeConfirm(false)}
      />
    </div>
  );
}

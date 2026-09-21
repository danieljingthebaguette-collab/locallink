import { useState } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { FIELD_TAGS } from '@/lib/mockData';

/**
 * A compact, multi-select field-tag picker: search box + wrapping pills +
 * selected chips. Same vocabulary and look as the tag step in
 * CreatePostModal, but standalone (no wizard framing) so it drops into a
 * settings section or a dialog. Used for an organization's own category
 * tags -- on the org's own profile page and in the admin panel.
 */
export default function FieldTagPicker({
  selected,
  onChange,
  className,
}: {
  selected: string[];
  onChange: (tags: string[]) => void;
  className?: string;
}) {
  const [search, setSearch] = useState('');
  const filtered = FIELD_TAGS.filter(t => t.toLowerCase().includes(search.toLowerCase()));
  const toggle = (tag: string) =>
    onChange(selected.includes(tag) ? selected.filter(t => t !== tag) : [...selected, tag]);

  return (
    <div className={cn('space-y-3', className)}>
      <Input
        placeholder="Search fields..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="rounded-xl border-border h-10"
      />
      <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto pr-1">
        {filtered.map(tag => (
          <button
            key={tag}
            type="button"
            onClick={() => toggle(tag)}
            className={cn(
              'px-3 py-1.5 rounded-xl border-2 text-xs font-medium transition-all cursor-pointer',
              selected.includes(tag)
                ? 'bg-primary border-primary text-primary-foreground shadow-sm'
                : 'bg-secondary/60 border-border text-foreground hover:border-primary/40'
            )}
          >
            {tag}
          </button>
        ))}
        {filtered.length === 0 && (
          <p className="text-xs text-muted-foreground py-1">No fields match "{search}"</p>
        )}
      </div>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selected.map(tag => (
            <span key={tag} className="inline-flex items-center gap-1 px-3 py-1 bg-primary/10 border border-primary/20 rounded-md text-xs font-semibold text-primary">
              {tag}
              <button type="button" onClick={() => toggle(tag)} className="hover:text-red-500 transition-colors cursor-pointer" aria-label={`Remove ${tag}`}>
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

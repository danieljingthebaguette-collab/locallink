import { useState } from 'react';
import { Loader2, ExternalLink, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * The gate between "I'd like to go" and "put me on their list".
 *
 * An organization's own sign-up — a registration form, a waiver, an email to
 * a coordinator — is what actually gets someone onto THEIR roster. Being on
 * LocalLink's list while absent from theirs is the worst outcome for both
 * sides: the organization plans for a person who never registered, and the
 * volunteer turns up expecting to be known.
 *
 * So the steps the organization wrote get shown here, at the one moment the
 * volunteer is deciding to go, and the commitment doesn't land until they
 * say they've done them. Those steps were previously required when posting
 * and then displayed nowhere at all.
 *
 * It records an answer, not proof — nothing here can verify a form on
 * someone else's website. Saying so plainly is better than implying a
 * check that doesn't exist.
 */
export default function CommitDialog({
  open, orgName, steps, externalSignupUrl, submitting, onConfirm, onCancel,
}: {
  open: boolean;
  orgName: string;
  steps: string[];
  externalSignupUrl?: string | null;
  submitting?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [checked, setChecked] = useState(false);
  const [openedLink, setOpenedLink] = useState(false);
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="commit-dialog-title"
    >
      <div
        className="w-full max-w-md rounded-3xl bg-card border border-border shadow-2xl p-6 max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <h2 id="commit-dialog-title" className="font-heading font-bold text-xl text-foreground">
          Before {orgName} adds you
        </h2>
        <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
          They ask volunteers to do this first. Finish it and you'll be on their list as well as
          LocalLink's — which is what makes your hours count.
        </p>

        {steps.length > 0 && (
          <ol className="mt-5 space-y-3">
            {steps.map((s, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center tabular-nums mt-0.5">
                  {i + 1}
                </span>
                <span className="text-sm text-foreground leading-relaxed">{s}</span>
              </li>
            ))}
          </ol>
        )}

        {externalSignupUrl && (
          <a
            href={externalSignupUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpenedLink(true)}
            className="mt-5 w-full inline-flex items-center justify-center gap-2 rounded-2xl border border-border bg-secondary/40 hover:bg-secondary px-4 py-3 text-sm font-semibold text-foreground transition-colors"
          >
            <ExternalLink className="w-4 h-4" />
            Open {orgName}'s sign-up
            {openedLink && <Check className="w-4 h-4 text-emerald-500" />}
          </a>
        )}

        <label className="mt-5 flex items-start gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={checked}
            onChange={e => setChecked(e.target.checked)}
            className="mt-0.5 flex-shrink-0"
          />
          <span className="text-sm text-foreground leading-relaxed">
            I've done {steps.length > 0 || externalSignupUrl ? 'these steps' : 'this'} with {orgName}.
          </span>
        </label>

        <div className="mt-5 flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
          <Button variant="outline" onClick={onCancel} disabled={submitting} className="rounded-full">
            Not yet
          </Button>
          <Button onClick={onConfirm} disabled={!checked || submitting} className="rounded-full">
            {submitting && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
            Put me on the list
          </Button>
        </div>

        <p className="text-[11px] text-muted-foreground mt-4 leading-relaxed">
          We can't check another organization's forms for you — this records that you confirmed it.
          If you haven't finished yet, choose "Not yet" and come back.
        </p>
      </div>
    </div>
  );
}

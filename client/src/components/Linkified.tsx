/**
 * Renders text with bare http(s) URLs turned into real links.
 *
 * Organizations paste their registration link into the step text rather than
 * the sign-up-page field -- six of the eight posts on the live board do. As a
 * plain text node that link is dead: the only way to use it is to select a
 * ninety-character URL by hand and copy it, which on a phone is close to
 * impossible. So the step that says "Register here - https://..." was the end
 * of the road for most people who got that far.
 *
 * Only http:// and https:// match, so javascript: and data: are rejected by
 * construction rather than by a blocklist. Email addresses are deliberately
 * left alone -- some steps say "email your resume to someone@gmail.com", and
 * a mailto: link there buys nothing.
 */

// Excludes the bracket and quote characters a URL is usually wrapped in, and
// will not end on punctuation, so "(https://example.org/x)" keeps its trailing
// slash but drops the bracket, and a URL ending a sentence drops the full stop.
// No /u flag: this tsconfig targets below es6 and rejects it.
//
// "@" is barred from the host but allowed after the first "/", because
// "https://google.com@evil.com/x" is a real address that reads as google.com
// and goes to evil.com. Stopping the host at the "@" makes the link go where
// it appears to, and leaves the rest as visible text.
const URL_RE = /(https?:\/\/[^\s<>()"'@\/]*[^\s<>()"'@\/.,;:!?](?:\/[^\s<>()"']*[^\s<>()"'.,;:!?])?)/g;

export function Linkified({ text, className }: { text: string; className?: string }) {
  // split() with a capturing group puts the matches at the odd indices. Using
  // .test() here instead would be a bug: URL_RE is /g and therefore stateful.
  //
  // String() rather than trusting the type: steps are stored as JSON and the
  // length check that guards them ignores non-strings, so a number or object
  // in that array reaches here and .split would take the whole page down.
  const parts = String(text).split(URL_RE);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className={className ?? 'underline underline-offset-2 font-semibold break-all hover:opacity-80'}
          >
            {part}
          </a>
        ) : (
          part
        )
      )}
    </>
  );
}

/** Whether text contains a link, so callers can say so before it is opened. */
export function hasLink(text: string): boolean {
  // A fresh regex per call — sharing the /g instance would carry lastIndex.
  return new RegExp(URL_RE.source).test(text);
}

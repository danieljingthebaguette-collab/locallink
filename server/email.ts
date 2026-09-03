const BREVO_API_KEY = process.env.BREVO_API_KEY || '';
const FROM_EMAIL = process.env.EMAIL_FROM || 'linklocal2@gmail.com';
const FROM_NAME = 'LocalLink';
const APP_URL = process.env.APP_URL || 'http://localhost:5173';

// Escape user-supplied values before interpolating into HTML email bodies —
// usernames and post titles are free text and would otherwise inject markup
// into emails delivered under LocalLink branding. Plain-text parts and
// subject lines are NOT HTML contexts and must stay unescaped.
// ── Shared look ─────────────────────────────────────────────────────────────
// The same tokens the site renders with, read off it rather than eyeballed:
// --primary, --foreground, --border, --muted-foreground, --secondary and
// --radius from client/src/index.css. Written as literal hex and px because an
// email has no cascade, no variables, and no stylesheet -- every value has to
// be inline on the element.
//
// The webfonts are named first and then fall back. Gmail and Outlook strip
// @font-face, so most people see system-ui; naming them still gets the right
// face in the clients that do allow it, and the fallback stack keeps the rest
// looking deliberate rather than like Times New Roman.
const BRAND = {
  primary: '#254CC1',
  ink: '#0F1729',
  body: '#3F4A5C',
  muted: '#64748B',
  border: '#DAE0E7',
  panel: '#F1F5F9',
  page: '#F9FAFB',
  card: '#FFFFFF',
  radius: '6px',
  headingFont: `'Instrument Sans', system-ui, -apple-system, 'Segoe UI', Arial, sans-serif`,
  bodyFont: `'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', Arial, sans-serif`,
};

/** Outer shell every email shares: page ground, white card, wordmark, footer. */
function layout(bodyHtml: string, footerHtml = ''): string {
  return `<div style="margin:0;padding:24px 12px;background:${BRAND.page};font-family:${BRAND.bodyFont}">
  <div style="max-width:520px;margin:0 auto;background:${BRAND.card};border:1px solid ${BRAND.border};border-radius:${BRAND.radius};overflow:hidden">
    <div style="padding:20px 28px;border-bottom:1px solid ${BRAND.border}">
      <span style="font-family:${BRAND.headingFont};font-size:19px;font-weight:700;color:${BRAND.ink};letter-spacing:-0.01em">LocalLink</span>
      <span style="font-family:${BRAND.bodyFont};font-size:12px;color:${BRAND.muted};margin-left:8px">Linking People to Local Action</span>
    </div>
    <div style="padding:28px">${bodyHtml}</div>
  </div>
  ${footerHtml ? `<div style="max-width:520px;margin:14px auto 0;font-family:${BRAND.bodyFont};font-size:12px;line-height:1.6;color:${BRAND.muted};text-align:center">${footerHtml}</div>` : ''}
</div>`;
}

/** Primary action button, matching the site's squared buttons. */
function button(href: string, label: string): string {
  return `<a href="${href}" style="display:inline-block;background:${BRAND.primary};color:#ffffff;font-family:${BRAND.headingFont};font-size:15px;font-weight:600;padding:12px 26px;border-radius:${BRAND.radius};text-decoration:none">${label}</a>`;
}

/** The callout every email uses to name the post it is about.
 *  Tone is semantic, not decorative: it is the one part of these emails that
 *  says at a glance whether the news is good. */
const TONES = {
  neutral: { bg: BRAND.panel, edge: BRAND.primary },
  good: { bg: '#F0FDF4', edge: '#16A34A' },
  bad: { bg: '#FEF2F2', edge: '#DC2626' },
  warn: { bg: '#FFF7ED', edge: '#EA580C' },
} as const;

function panel(titleHtml: string, subHtml = '', tone: keyof typeof TONES = 'neutral'): string {
  const t = TONES[tone];
  return `<div style="background:${t.bg};border-left:3px solid ${t.edge};border-radius:${BRAND.radius};padding:14px 18px;margin:18px 0">
    <p style="margin:0;font-family:${BRAND.headingFont};font-size:16px;font-weight:600;color:${BRAND.ink}">${titleHtml}</p>
    ${subHtml ? `<p style="margin:5px 0 0;font-size:13px;color:${BRAND.muted}">${subHtml}</p>` : ''}
  </div>`;
}

/** Heading + lead paragraph, the shape every one of these emails opens with. */
function greeting(nameHtml: string, leadHtml: string): string {
  return `<h1 style="font-family:${BRAND.headingFont};font-size:22px;font-weight:700;color:${BRAND.ink};margin:0 0 14px;letter-spacing:-0.01em">Hi ${nameHtml}</h1>
       <p style="font-size:15px;line-height:1.65;color:${BRAND.body};margin:0 0 4px">${leadHtml}</p>`;
}

/** A closing line in the body's voice. */
function para(html: string): string {
  return `<p style="font-size:15px;line-height:1.65;color:${BRAND.body};margin:14px 0 20px">${html}</p>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * opts.unsubscribeUrl adds the List-Unsubscribe pair. Counter-intuitively this
 * helps rather than flags: it is what a well-behaved bulk sender looks like,
 * Gmail surfaces its own one-click unsubscribe from it, and its absence is a
 * spam signal in itself. Worth being straight about the limits though -- which
 * Gmail tab a message lands in comes mostly from sender reputation and what
 * recipients do with it, so headers and wording shift the odds rather than
 * decide the outcome.
 */
async function sendEmail(
  to: string, subject: string, html: string, text: string,
  opts: { unsubscribeUrl?: string } = {}
): Promise<void> {
  const headers: Record<string, string> = {};
  if (opts.unsubscribeUrl) {
    headers['List-Unsubscribe'] = `<${opts.unsubscribeUrl}>`;
    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
  }
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'api-key': BREVO_API_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      sender: { name: FROM_NAME, email: FROM_EMAIL },
      to: [{ email: to }],
      subject,
      htmlContent: html,
      textContent: text,
      // replyTo and headers ride along only for the emails that ask for them.
      // Both field names come from Brevo's v3 API, but I have no key here to
      // prove that against the live service, and a wrong guess is rejected for
      // the whole request. Scoped this way the blast radius is the one email
      // that opted in; account verification and password resets keep the exact
      // payload shape that has been working in production all along.
      ...(opts.unsubscribeUrl ? { replyTo: { email: FROM_EMAIL, name: FROM_NAME }, headers } : {}),
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Brevo API error: ${err}`);
  }
  console.log(`📧 Email sent to: ${to}`);
}

export async function sendVerificationEmail(email: string, username: string, token: string): Promise<void> {
  const verifyUrl = `${APP_URL}/verify-email?token=${token}`;
  const usernameHtml = escapeHtml(username);
  await sendEmail(
    email,
    'Verify your LocalLink email address',
    layout(
      `${greeting(usernameHtml, 'Welcome to LocalLink. One click confirms your address and you are in.')}
       ${button(verifyUrl, 'Confirm my email')}
       <p style="font-size:13px;line-height:1.6;color:${BRAND.muted};margin:16px 0 0">This link lasts 24 hours. Or paste it into your browser: <a href="${verifyUrl}" style="color:${BRAND.muted}">${verifyUrl}</a></p>`
    ),
    `Welcome to LocalLink, ${username}!\n\nVerify your email: ${verifyUrl}\n\nExpires in 24 hours.`,
  );
}

export async function sendPasswordResetEmail(email: string, username: string, token: string): Promise<void> {
  const resetUrl = `${APP_URL}/reset-password?token=${token}`;
  const usernameHtml = escapeHtml(username);
  await sendEmail(
    email,
    'Reset your LocalLink password',
    layout(
      `${greeting(usernameHtml, 'Use the button below to set a new password.')}
       ${button(resetUrl, 'Reset my password')}
       <p style="font-size:13px;line-height:1.6;color:${BRAND.muted};margin:16px 0 0">This link lasts 1 hour. Or paste it into your browser: <a href="${resetUrl}" style="color:${BRAND.muted}">${resetUrl}</a></p>`,
      `If you did not ask for this, ignore this email and your password stays as it is.`
    ),
    `Hi ${username},\n\nReset your password: ${resetUrl}\n\nExpires in 1 hour.`,
  );
}

export async function sendReopenReminderEmail(email: string, username: string, postTitle: string): Promise<void> {
  const appUrl = APP_URL;
  const usernameHtml = escapeHtml(username);
  const postTitleHtml = escapeHtml(postTitle);
  await sendEmail(
    email,
    `"${postTitle}" opens again tomorrow on LocalLink!`,
    layout(
      `${greeting(usernameHtml, 'A recurring opportunity you signed up for opens again <strong>tomorrow (Monday)</strong>.')}
       ${panel(postTitleHtml)}
       ${para('Sign-ups open at midnight, so you can claim your spot first thing.')}
       ${button(appUrl, 'Open LocalLink')}`,
      `You are getting this because you signed up for this recurring event before.`
    ),
    `Hi ${username}!\n\nThe recurring volunteer opportunity "${postTitle}" opens again tomorrow (Monday).\n\nSign-ups open at midnight — visit LocalLink to secure your spot: ${appUrl}\n\nYou're receiving this because you signed up for this recurring event.`,
  );
}

export async function sendSignupNotificationEmail(
  orgEmail: string, orgUsername: string, volunteerName: string, postTitle: string
): Promise<void> {
  const orgUsernameHtml = escapeHtml(orgUsername);
  const volunteerNameHtml = escapeHtml(volunteerName);
  const postTitleHtml = escapeHtml(postTitle);
  await sendEmail(
    orgEmail,
    `${volunteerName} is interested in "${postTitle}"`,
    layout(
      `${greeting(orgUsernameHtml, `<strong>${volunteerNameHtml}</strong> is interested in your opportunity.`)}
       ${panel(postTitleHtml)}
       ${para('Their details are on the post, so you can get in touch whenever suits.')}
       ${button(APP_URL, 'View on LocalLink')}`
    ),
    `Hi ${orgUsername},\n\n${volunteerName} is interested in "${postTitle}".\n\nView on LocalLink: ${APP_URL}`
  );
}

export async function sendPostApprovedEmail(
  orgEmail: string, orgUsername: string, postTitle: string
): Promise<void> {
  const orgUsernameHtml = escapeHtml(orgUsername);
  const postTitleHtml = escapeHtml(postTitle);
  await sendEmail(
    orgEmail,
    `✅ Your post "${postTitle}" has been approved!`,
    layout(
      `${greeting(orgUsernameHtml, 'Your opportunity has been reviewed and approved.')}
       ${panel(postTitleHtml, '', 'good')}
       ${para('It is on the board now, and volunteers can start signing up.')}
       ${button(APP_URL, 'View on LocalLink')}`
    ),
    `Hi ${orgUsername},\n\nYour post "${postTitle}" has been approved and is now live!\n\nView on LocalLink: ${APP_URL}`
  );
}

export async function sendPostDeniedEmail(
  orgEmail: string, orgUsername: string, postTitle: string, reason?: string
): Promise<void> {
  const orgUsernameHtml = escapeHtml(orgUsername);
  const postTitleHtml = escapeHtml(postTitle);
  const reasonHtml = reason ? escapeHtml(reason) : undefined;
  await sendEmail(
    orgEmail,
    `Your post "${postTitle}" was not approved`,
    layout(
      `${greeting(orgUsernameHtml, 'Your post was not approved this time.')}
       ${panel(postTitleHtml, reasonHtml ? `Reason: ${reasonHtml}` : '', 'bad')}
       ${para('You are welcome to revise it and submit again. Reply to this email if anything is unclear.')}
       ${button(APP_URL, 'Go to LocalLink')}`
    ),
    `Hi ${orgUsername},\n\nYour post "${postTitle}" was not approved.${reason ? '\n\nReason: ' + reason : ''}\n\nYou can revise and resubmit at: ${APP_URL}`
  );
}

export async function sendEventCancelledEmail(
  volunteerEmail: string, volunteerUsername: string, postTitle: string, orgName: string
): Promise<void> {
  const volunteerUsernameHtml = escapeHtml(volunteerUsername);
  const postTitleHtml = escapeHtml(postTitle);
  const orgNameHtml = escapeHtml(orgName);
  await sendEmail(
    volunteerEmail,
    `"${postTitle}" has been cancelled`,
    layout(
      `${greeting(volunteerUsernameHtml, 'An event you signed up for has been cancelled by the organizer.')}
       ${panel(postTitleHtml, `Hosted by ${orgNameHtml}`, 'warn')}
       ${para('Nothing is needed from you. There are other opportunities on the board whenever you are ready.')}
       ${button(APP_URL, 'Find another opportunity')}`
    ),
    `Hi ${volunteerUsername},\n\nThe event "${postTitle}" hosted by ${orgName} has been cancelled.\n\nFind other opportunities: ${APP_URL}`
  );
}

export async function sendEventReminderEmail(
  volunteerEmail: string, volunteerUsername: string, postTitle: string,
  eventDate: string, orgName: string, unsubToken: string
): Promise<void> {
  const unsubUrl = `${APP_URL}/api/unsubscribe?token=${unsubToken}`;
  const dateStr = new Date(eventDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const volunteerUsernameHtml = escapeHtml(volunteerUsername);
  const postTitleHtml = escapeHtml(postTitle);
  const orgNameHtml = escapeHtml(orgName);
  await sendEmail(
    volunteerEmail,
    `Reminder: "${postTitle}" is tomorrow!`,
    // NOTE: the unsubscribe link goes in layout()'s footer argument and this
    // call deliberately passes no `opts`. Passing { unsubscribeUrl } here
    // would add replyTo and headers to the Brevo body, and this is a cron
    // email going to real volunteers -- not the place to find out whether
    // Brevo accepts those field names.
    layout(
      `${greeting(volunteerUsernameHtml, 'A quick reminder about an event you signed up for. It is tomorrow.')}
       ${panel(postTitleHtml, `By ${orgNameHtml} · ${dateStr}`)}
       ${button(APP_URL, 'View on LocalLink')}`,
      `You are getting this because you signed up for this event.<br>
       <a href="${unsubUrl}" style="color:${BRAND.muted};text-decoration:underline">Unsubscribe from event reminders</a> — account emails like post approvals still reach you.`
    ),
    `Hi ${volunteerUsername},\n\nReminder: "${postTitle}" by ${orgName} is tomorrow (${dateStr}).\n\nView on LocalLink: ${APP_URL}\n\n---\nUnsubscribe from reminders: ${unsubUrl}\nNote: Important account notifications will still be sent even after unsubscribing.`
  );
}


/**
 * Asks a volunteer who has not answered the questionnaire to fill it in. Not a
 * one-off: the sender holds a cooldown, so someone who never answers and never
 * unsubscribes can be asked again later, and the footer says so. Carries the
 * unsubscribe link because it is the only bulk mail this app sends --
 * everything else is a reply to something the person did.
 */
/**
 * For the volunteers who never confirmed their address. They cannot log in, so
 * the ordinary questionnaire email would land them on a wall they have no way
 * through -- the survey link needs a session and they have never had one. This
 * asks for the one thing that unsticks the account, and only mentions the
 * questionnaire as what is waiting on the other side.
 *
 * No unsubscribe footer: this is account confirmation, not a mailing. The same
 * reason password resets carry none.
 */
export async function sendVerifyThenSurveyEmail(
  email: string, username: string, token: string
): Promise<void> {
  const usernameHtml = escapeHtml(username);
  const verifyUrl = `${APP_URL}/verify-email?token=${token}`;
  await sendEmail(
    email,
    'Confirm your email to finish setting up LocalLink',
    layout(
      `<h1 style="font-family:${BRAND.headingFont};font-size:22px;font-weight:700;color:${BRAND.ink};margin:0 0 14px;letter-spacing:-0.01em">Hi ${usernameHtml}</h1>
       <p style="font-size:15px;line-height:1.65;color:${BRAND.body};margin:0 0 14px">Your LocalLink account was never confirmed, so you have not been able to sign in. One click fixes that.</p>
       <p style="font-size:15px;line-height:1.65;color:${BRAND.body};margin:0 0 20px">Once you are in, there is a short questionnaire waiting — about a minute, every question optional — that lets us mark the opportunities that actually fit you.</p>
       ${button(verifyUrl, 'Confirm my email')}
       <p style="font-size:13px;line-height:1.6;color:${BRAND.muted};margin:16px 0 0">This link lasts 24 hours. Or paste it into your browser: <a href="${verifyUrl}" style="color:${BRAND.muted}">${verifyUrl}</a></p>`,
      `You have a LocalLink volunteer account that was never confirmed. If this was not you, ignore this email and nothing happens.`
    ),
    `Hi ${username},\n\nYour LocalLink account was never confirmed, so you have not been able to sign in. One click fixes that.\n\nConfirm your email: ${verifyUrl}\n\nThis link lasts 24 hours.\n\nOnce you are in, there is a short questionnaire waiting -- about a minute, every question optional -- that lets us mark the opportunities that actually fit you.\n\nIf this was not you, ignore this email and nothing happens.`,
  );
}

export async function sendOnboardingNudgeEmail(
  email: string, username: string, unsubToken: string
): Promise<void> {
  const usernameHtml = escapeHtml(username);
  const unsubUrl = `${APP_URL}/api/unsubscribe?token=${unsubToken}`;
  // Opens the questionnaire on arrival rather than dropping them on the board
  // and hoping the modal fires. Survives a signed-out click: the flag is held
  // until they sign in.
  const surveyUrl = `${APP_URL}/?survey=1`;
  await sendEmail(
    email,
    'A quick question about your volunteering',
    layout(
      `<h1 style="font-family:${BRAND.headingFont};font-size:22px;font-weight:700;color:${BRAND.ink};margin:0 0 14px;letter-spacing:-0.01em">Hi ${usernameHtml}</h1>
       <p style="font-size:15px;line-height:1.65;color:${BRAND.body};margin:0 0 14px">We added a short questionnaire since you joined. It asks what kind of volunteering you enjoy, which towns work for you, and when you are usually free.</p>
       <p style="font-size:15px;line-height:1.65;color:${BRAND.body};margin:0 0 20px">Takes about a minute, every question is optional, and it lets us mark the opportunities that actually fit you.</p>
       ${button(surveyUrl, 'Fill it in')}
       <p style="font-size:13px;line-height:1.6;color:${BRAND.muted};margin:16px 0 0">Or paste this into your browser: <a href="${surveyUrl}" style="color:${BRAND.muted}">${surveyUrl}</a></p>`,
      `You are getting this because you have a LocalLink volunteer account and haven't answered the questionnaire yet. Answer it, or unsubscribe, and we'll stop asking.<br>
       <a href="${unsubUrl}" style="color:${BRAND.muted};text-decoration:underline">Unsubscribe from emails like this</a>`
    ),
    `Hi ${username},\n\nWe added a short questionnaire since you joined. It asks what kind of volunteering you enjoy, which towns work for you, and when you are usually free.\n\nIt takes about a minute, every question is optional, and it lets us mark the opportunities that actually fit you.\n\nFill it in: ${surveyUrl}\n\nYou are getting this because you have a LocalLink volunteer account and haven't answered the questionnaire yet. Answer it, or unsubscribe, and we'll stop asking.\nUnsubscribe: ${unsubUrl}`,
    { unsubscribeUrl: unsubUrl },
  );
}

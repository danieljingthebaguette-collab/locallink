const BREVO_API_KEY = process.env.BREVO_API_KEY || '';
const FROM_EMAIL = process.env.EMAIL_FROM || 'linklocal2@gmail.com';
const FROM_NAME = 'LocalLink';
const APP_URL = process.env.APP_URL || 'http://localhost:5173';

async function sendEmail(to: string, subject: string, html: string, text: string): Promise<void> {
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
  await sendEmail(
    email,
    'Verify your LocalLink email address',
    `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px"><h1>LocalLink</h1><h2>Welcome, ${username}!</h2><p>Click below to verify your email.</p><a href="${verifyUrl}" style="display:inline-block;background:#6366f1;color:white;padding:14px 32px;border-radius:999px;text-decoration:none;font-weight:600">Verify Email Address</a><p style="color:#888;font-size:13px">Expires in 24 hours.</p><p style="font-size:12px">Or copy: <a href="${verifyUrl}">${verifyUrl}</a></p></div>`,
    `Welcome to LocalLink, ${username}!\n\nVerify your email: ${verifyUrl}\n\nExpires in 24 hours.`,
  );
}

export async function sendPasswordResetEmail(email: string, username: string, token: string): Promise<void> {
  const resetUrl = `${APP_URL}/reset-password?token=${token}`;
  await sendEmail(
    email,
    'Reset your LocalLink password',
    `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px"><h1>LocalLink</h1><h2>Reset your password, ${username}</h2><p>Click below to reset your password.</p><a href="${resetUrl}" style="display:inline-block;background:#6366f1;color:white;padding:14px 32px;border-radius:999px;text-decoration:none;font-weight:600">Reset Password</a><p style="color:#888;font-size:13px">Expires in 1 hour.</p><p style="font-size:12px">Or copy: <a href="${resetUrl}">${resetUrl}</a></p></div>`,
    `Hi ${username},\n\nReset your password: ${resetUrl}\n\nExpires in 1 hour.`,
  );
}

export async function sendReopenReminderEmail(email: string, username: string, postTitle: string): Promise<void> {
  const appUrl = APP_URL;
  await sendEmail(
    email,
    `"${postTitle}" opens again tomorrow on LocalLink!`,
    `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <h1 style="color:#6366f1;margin-bottom:4px">LocalLink</h1>
      <h2 style="margin-top:0">Hey ${username} 👋</h2>
      <p style="color:#444;line-height:1.6">A recurring volunteer opportunity you signed up for is <strong>opening again tomorrow (Monday)</strong>!</p>
      <div style="background:#f5f3ff;border-left:4px solid #6366f1;border-radius:8px;padding:16px 20px;margin:20px 0">
        <p style="margin:0;font-size:17px;font-weight:600;color:#1a1a2e">${postTitle}</p>
      </div>
      <p style="color:#444;line-height:1.6">Sign-ups open Monday at midnight — head over to LocalLink to grab your spot!</p>
      <a href="${appUrl}" style="display:inline-block;background:#6366f1;color:white;padding:14px 32px;border-radius:999px;text-decoration:none;font-weight:600;margin-top:8px">Open LocalLink</a>
      <p style="color:#aaa;font-size:12px;margin-top:28px">You're receiving this reminder because you previously signed up for this recurring event.</p>
    </div>`,
    `Hi ${username}!\n\nThe recurring volunteer opportunity "${postTitle}" opens again tomorrow (Monday).\n\nSign-ups open at midnight — visit LocalLink to secure your spot: ${appUrl}\n\nYou're receiving this because you signed up for this recurring event.`,
  );
}

export async function sendSignupNotificationEmail(
  orgEmail: string, orgUsername: string, volunteerName: string, postTitle: string
): Promise<void> {
  await sendEmail(
    orgEmail,
    `${volunteerName} is interested in "${postTitle}"`,
    `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <h1 style="color:#6366f1;margin-bottom:4px">LocalLink</h1>
      <h2 style="margin-top:0">New interest in your post! 🎉</h2>
      <p>Hi ${orgUsername},</p>
      <p><strong>${volunteerName}</strong> has expressed interest in your opportunity:</p>
      <div style="background:#f5f3ff;border-left:4px solid #6366f1;border-radius:8px;padding:16px 20px;margin:20px 0">
        <p style="margin:0;font-size:17px;font-weight:600;color:#1a1a2e">${postTitle}</p>
      </div>
      <a href="${APP_URL}" style="display:inline-block;background:#6366f1;color:white;padding:14px 32px;border-radius:999px;text-decoration:none;font-weight:600">View on LocalLink</a>
    </div>`,
    `Hi ${orgUsername},\n\n${volunteerName} is interested in "${postTitle}".\n\nView on LocalLink: ${APP_URL}`
  );
}

export async function sendPostApprovedEmail(
  orgEmail: string, orgUsername: string, postTitle: string
): Promise<void> {
  await sendEmail(
    orgEmail,
    `✅ Your post "${postTitle}" has been approved!`,
    `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <h1 style="color:#6366f1;margin-bottom:4px">LocalLink</h1>
      <h2 style="margin-top:0">Your post is live! ✅</h2>
      <p>Hi ${orgUsername},</p>
      <p>Great news — your opportunity has been reviewed and approved by our team:</p>
      <div style="background:#f0fdf4;border-left:4px solid #22c55e;border-radius:8px;padding:16px 20px;margin:20px 0">
        <p style="margin:0;font-size:17px;font-weight:600;color:#1a1a2e">${postTitle}</p>
      </div>
      <p>It is now live on the board and volunteers can start signing up!</p>
      <a href="${APP_URL}" style="display:inline-block;background:#6366f1;color:white;padding:14px 32px;border-radius:999px;text-decoration:none;font-weight:600">View on LocalLink</a>
    </div>`,
    `Hi ${orgUsername},\n\nYour post "${postTitle}" has been approved and is now live!\n\nView on LocalLink: ${APP_URL}`
  );
}

export async function sendPostDeniedEmail(
  orgEmail: string, orgUsername: string, postTitle: string, reason?: string
): Promise<void> {
  await sendEmail(
    orgEmail,
    `Your post "${postTitle}" was not approved`,
    `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <h1 style="color:#6366f1;margin-bottom:4px">LocalLink</h1>
      <h2 style="margin-top:0">Post not approved</h2>
      <p>Hi ${orgUsername},</p>
      <p>Unfortunately your post was not approved at this time:</p>
      <div style="background:#fef2f2;border-left:4px solid #ef4444;border-radius:8px;padding:16px 20px;margin:20px 0">
        <p style="margin:0;font-size:17px;font-weight:600;color:#1a1a2e">${postTitle}</p>
        ${reason ? `<p style="margin:8px 0 0;font-size:13px;color:#555">Reason: ${reason}</p>` : ''}
      </div>
      <p>You are welcome to revise and resubmit. If you have questions, please contact us.</p>
      <a href="${APP_URL}" style="display:inline-block;background:#6366f1;color:white;padding:14px 32px;border-radius:999px;text-decoration:none;font-weight:600">Go to LocalLink</a>
    </div>`,
    `Hi ${orgUsername},\n\nYour post "${postTitle}" was not approved.${reason ? '\n\nReason: ' + reason : ''}\n\nYou can revise and resubmit at: ${APP_URL}`
  );
}

export async function sendEventCancelledEmail(
  volunteerEmail: string, volunteerUsername: string, postTitle: string, orgName: string
): Promise<void> {
  await sendEmail(
    volunteerEmail,
    `"${postTitle}" has been cancelled`,
    `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <h1 style="color:#6366f1;margin-bottom:4px">LocalLink</h1>
      <h2 style="margin-top:0">Event cancelled</h2>
      <p>Hi ${volunteerUsername},</p>
      <p>An event you signed up for has been cancelled by the organizer:</p>
      <div style="background:#fff7ed;border-left:4px solid #f97316;border-radius:8px;padding:16px 20px;margin:20px 0">
        <p style="margin:0;font-size:17px;font-weight:600;color:#1a1a2e">${postTitle}</p>
        <p style="margin:4px 0 0;font-size:13px;color:#555">Hosted by ${orgName}</p>
      </div>
      <p>Check out other opportunities on LocalLink!</p>
      <a href="${APP_URL}" style="display:inline-block;background:#6366f1;color:white;padding:14px 32px;border-radius:999px;text-decoration:none;font-weight:600">Find More Opportunities</a>
    </div>`,
    `Hi ${volunteerUsername},\n\nThe event "${postTitle}" hosted by ${orgName} has been cancelled.\n\nFind other opportunities: ${APP_URL}`
  );
}

export async function sendEventReminderEmail(
  volunteerEmail: string, volunteerUsername: string, postTitle: string,
  eventDate: string, orgName: string, unsubToken: string
): Promise<void> {
  const unsubUrl = `${APP_URL}/api/unsubscribe?token=${unsubToken}`;
  const dateStr = new Date(eventDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  await sendEmail(
    volunteerEmail,
    `Reminder: "${postTitle}" is tomorrow!`,
    `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <h1 style="color:#6366f1;margin-bottom:4px">LocalLink</h1>
      <h2 style="margin-top:0">Your event is tomorrow!</h2>
      <p>Hi ${volunteerUsername},</p>
      <p>Just a reminder — you signed up for an event happening tomorrow:</p>
      <div style="background:#f5f3ff;border-left:4px solid #6366f1;border-radius:8px;padding:16px 20px;margin:20px 0">
        <p style="margin:0;font-size:17px;font-weight:600;color:#1a1a2e">${postTitle}</p>
        <p style="margin:4px 0 0;font-size:13px;color:#555">By ${orgName} · ${dateStr}</p>
      </div>
      <a href="${APP_URL}" style="display:inline-block;background:#6366f1;color:white;padding:14px 32px;border-radius:999px;text-decoration:none;font-weight:600;margin-top:8px">View on LocalLink</a>
      <p style="color:#aaa;font-size:11px;margin-top:28px">
        You are receiving this because you signed up for this event.<br>
        <strong>Note:</strong> Even if you unsubscribe from reminders, important account notifications will still be sent.<br>
        <a href="${unsubUrl}" style="color:#aaa">Unsubscribe from event reminders</a>
      </p>
    </div>`,
    `Hi ${volunteerUsername},\n\nReminder: "${postTitle}" by ${orgName} is tomorrow (${dateStr}).\n\nView on LocalLink: ${APP_URL}\n\n---\nUnsubscribe from reminders: ${unsubUrl}\nNote: Important account notifications will still be sent even after unsubscribing.`
  );
}

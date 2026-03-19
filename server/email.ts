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

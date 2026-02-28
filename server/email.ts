import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.EMAIL_FROM || 'LocalLink <onboarding@resend.dev>';
const APP_URL = process.env.APP_URL || 'http://localhost:5173';

export async function sendVerificationEmail(email: string, username: string, token: string): Promise<void> {
  const verifyUrl = `${APP_URL}/verify-email?token=${token}`;
  await resend.emails.send({
    from: FROM,
    to: email,
    subject: 'Verify your LocalLink email address',
    html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px"><h1>LocalLink</h1><h2>Welcome, ${username}!</h2><p>Click below to verify your email address.</p><a href="${verifyUrl}" style="display:inline-block;background:#6366f1;color:white;padding:14px 32px;border-radius:999px;text-decoration:none;font-weight:600">Verify Email Address</a><p style="color:#888;font-size:13px">This link expires in 24 hours.</p><p style="font-size:12px">Or copy: <a href="${verifyUrl}">${verifyUrl}</a></p></div>`,
    text: `Welcome to LocalLink, ${username}!\n\nVerify your email: ${verifyUrl}\n\nExpires in 24 hours.`,
  });
  console.log(`📧 Verification email sent to: ${email}`);
}

export async function sendPasswordResetEmail(email: string, username: string, token: string): Promise<void> {
  const resetUrl = `${APP_URL}/reset-password?token=${token}`;
  await resend.emails.send({
    from: FROM,
    to: email,
    subject: 'Reset your LocalLink password',
    html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px"><h1>LocalLink</h1><h2>Reset your password, ${username}</h2><p>Click below to choose a new password.</p><a href="${resetUrl}" style="display:inline-block;background:#6366f1;color:white;padding:14px 32px;border-radius:999px;text-decoration:none;font-weight:600">Reset Password</a><p style="color:#888;font-size:13px">This link expires in 1 hour.</p><p style="font-size:12px">Or copy: <a href="${resetUrl}">${resetUrl}</a></p></div>`,
    text: `Hi ${username},\n\nReset your password: ${resetUrl}\n\nExpires in 1 hour.`,
  });
  console.log(`📧 Password reset email sent to: ${email}`);
}

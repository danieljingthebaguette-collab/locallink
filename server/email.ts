import nodemailer from 'nodemailer';

let transporter: nodemailer.Transporter | null = null;

async function getTransporter(): Promise<nodemailer.Transporter> {
  if (transporter) return transporter;

  if (process.env.EMAIL_HOST) {
    // Production: use the SMTP credentials from .env
    transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: parseInt(process.env.EMAIL_PORT || '587'),
      secure: process.env.EMAIL_SECURE === 'true',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });
    console.log(`📧 Email configured via SMTP: ${process.env.EMAIL_HOST}`);
  } else {
    // Development: auto-create a free Ethereal test account.
    // Emails are NOT actually delivered — a preview URL is printed to the console.
    const testAccount = await nodemailer.createTestAccount();
    transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass,
      },
    });
    console.log('📧 Dev mode: using Ethereal test email account');
    console.log(`   User: ${testAccount.user}`);
    console.log('   Email preview links will appear below when emails are sent.');
  }

  return transporter;
}

export async function sendVerificationEmail(
  email: string,
  username: string,
  token: string
): Promise<void> {
  const trans = await getTransporter();
  const appUrl = process.env.APP_URL || 'http://localhost:5173';
  const verifyUrl = `${appUrl}/verify-email?token=${token}`;

  const info = await trans.sendMail({
    from: process.env.EMAIL_FROM || '"LocalLink" <noreply@locallink.com>',
    to: email,
    subject: 'Verify your LocalLink email address',
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; color: #1a1a1a;">
        <div style="text-align: center; margin-bottom: 32px;">
          <span style="font-size: 40px;">🔗</span>
          <h1 style="font-size: 24px; font-weight: 700; margin: 8px 0 0;">LocalLink</h1>
        </div>
        <h2 style="font-size: 20px; font-weight: 600; margin-bottom: 8px;">Welcome, ${username}!</h2>
        <p style="color: #555; line-height: 1.6; margin-bottom: 24px;">
          Thanks for joining LocalLink. Click the button below to verify your email address and activate your account.
        </p>
        <div style="text-align: center; margin-bottom: 32px;">
          <a href="${verifyUrl}"
             style="display: inline-block; background: #6366f1; color: white; padding: 14px 32px;
                    border-radius: 999px; text-decoration: none; font-weight: 600; font-size: 15px;">
            Verify Email Address
          </a>
        </div>
        <p style="color: #888; font-size: 13px; line-height: 1.5;">
          This link expires in <strong>24 hours</strong>. If you didn't create a LocalLink account, you can safely ignore this email.
        </p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
        <p style="color: #aaa; font-size: 12px;">
          Can't click the button? Copy and paste this link into your browser:<br />
          <a href="${verifyUrl}" style="color: #6366f1; word-break: break-all;">${verifyUrl}</a>
        </p>
      </div>
    `,
    text: `Welcome to LocalLink, ${username}!\n\nVerify your email address by visiting:\n${verifyUrl}\n\nThis link expires in 24 hours.`,
  });

  // In dev (Ethereal), print the preview URL so you can see the email in your browser
  if (!process.env.EMAIL_HOST) {
    console.log(`\n📧 Verification email sent to: ${email}`);
    console.log(`   Preview URL: ${nodemailer.getTestMessageUrl(info)}\n`);
  }
}

export async function sendPasswordResetEmail(
  email: string,
  username: string,
  token: string
): Promise<void> {
  const trans = await getTransporter();
  const appUrl = process.env.APP_URL || 'http://localhost:5173';
  const resetUrl = `${appUrl}/reset-password?token=${token}`;

  const info = await trans.sendMail({
    from: process.env.EMAIL_FROM || '"LocalLink" <noreply@locallink.com>',
    to: email,
    subject: 'Reset your LocalLink password',
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; color: #1a1a1a;">
        <div style="text-align: center; margin-bottom: 32px;">
          <span style="font-size: 40px;">🔗</span>
          <h1 style="font-size: 24px; font-weight: 700; margin: 8px 0 0;">LocalLink</h1>
        </div>
        <h2 style="font-size: 20px; font-weight: 600; margin-bottom: 8px;">Reset your password, ${username}</h2>
        <p style="color: #555; line-height: 1.6; margin-bottom: 24px;">
          We received a request to reset the password for your LocalLink account. Click the button below to choose a new password.
        </p>
        <div style="text-align: center; margin-bottom: 32px;">
          <a href="${resetUrl}"
             style="display: inline-block; background: #6366f1; color: white; padding: 14px 32px;
                    border-radius: 999px; text-decoration: none; font-weight: 600; font-size: 15px;">
            Reset Password
          </a>
        </div>
        <p style="color: #888; font-size: 13px; line-height: 1.5;">
          This link expires in <strong>1 hour</strong>. If you didn't request a password reset, you can safely ignore this email.
        </p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
        <p style="color: #aaa; font-size: 12px;">
          Can't click the button? Copy and paste this link into your browser:<br />
          <a href="${resetUrl}" style="color: #6366f1; word-break: break-all;">${resetUrl}</a>
        </p>
      </div>
    `,
    text: `Hi ${username},\n\nReset your LocalLink password by visiting:\n${resetUrl}\n\nThis link expires in 1 hour. If you didn't request this, ignore this email.`,
  });

  if (!process.env.EMAIL_HOST) {
    console.log(`\n📧 Password reset email sent to: ${email}`);
    console.log(`   Preview URL: ${nodemailer.getTestMessageUrl(info)}\n`);
  }
}

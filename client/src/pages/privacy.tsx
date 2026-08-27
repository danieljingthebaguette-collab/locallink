export default function Privacy() {
  return (
    <div className="min-h-screen bg-background pb-24 font-sans">
      <main className="container mx-auto px-4 py-12">
        <div className="max-w-3xl mx-auto space-y-6">

          {/* Page Header */}
          <div className="text-center space-y-2 mb-10">
            <h1 className="text-4xl font-bold text-foreground">Privacy Policy</h1>
            <p className="text-muted-foreground text-sm">Last updated: February 2026</p>
          </div>

          {/* What We Collect */}
          <div className="rounded-3xl bg-card border border-border p-8 space-y-3">
            <h2 className="text-xl font-bold text-foreground">What We Collect</h2>
            <p className="text-muted-foreground text-sm leading-relaxed">
              We collect only the information necessary to operate the LocalLink platform. This includes:
            </p>
            <ul className="list-disc list-inside space-y-2 text-sm text-muted-foreground pl-2">
              <li>
                <span className="font-semibold text-foreground">Email address</span> — used for
                account verification, password resets, and important platform updates.
              </li>
              <li>
                <span className="font-semibold text-foreground">Username</span> — your chosen display
                name shown on your public profile and event listings.
              </li>
              <li>
                <span className="font-semibold text-foreground">Volunteer activity data</span> — events
                you sign up for, create, or complete, as provided by you through the platform.
              </li>
              <li>
                <span className="font-semibold text-foreground">Optional profile information</span> —
                such as a bio or location, only if you choose to add it.
              </li>
            </ul>
            <p className="text-muted-foreground text-sm leading-relaxed">
              We do not collect payment information, government IDs, or sensitive personal data.
            </p>
          </div>

          {/* How We Use It */}
          <div className="rounded-3xl bg-card border border-border p-8 space-y-3">
            <h2 className="text-xl font-bold text-foreground">How We Use It</h2>
            <p className="text-muted-foreground text-sm leading-relaxed">
              The information we collect is used exclusively to provide and improve the LocalLink
              platform. Specifically, we use your data to:
            </p>
            <ul className="list-disc list-inside space-y-2 text-sm text-muted-foreground pl-2">
              <li>Create and manage your account, and authenticate you when you log in.</li>
              <li>Send email verification links when you register and password reset links when requested.</li>
              <li>Display your public profile, username, and volunteer history to other users.</li>
              <li>Show you relevant volunteer opportunities and allow organizers to manage their events.</li>
              <li>Improve platform features and fix bugs based on aggregate, anonymized usage patterns.</li>
            </ul>
          </div>

          {/* What We Don't Do */}
          <div className="rounded-3xl bg-card border border-border p-8 space-y-3">
            <h2 className="text-xl font-bold text-foreground">What We Don't Do</h2>
            <p className="text-muted-foreground text-sm leading-relaxed">
              We believe your data belongs to you. We make the following commitments:
            </p>
            <ul className="list-disc list-inside space-y-2 text-sm text-muted-foreground pl-2">
              <li>We do not sell your personal data to anyone, ever.</li>
              <li>We do not share your information with third parties for their own commercial purposes.</li>
              <li>We do not use your data for targeted advertising or behavioral profiling.</li>
              <li>We do not send marketing emails or newsletters — only transactional emails directly related to your account.</li>
              <li>We do not use third-party analytics that track you across the web.</li>
            </ul>
          </div>

          {/* Email Communications */}
          <div className="rounded-3xl bg-card border border-border p-8 space-y-3">
            <h2 className="text-xl font-bold text-foreground">Email Communications</h2>
            <p className="text-muted-foreground text-sm leading-relaxed">
              We send email only when necessary. The emails you may receive from LocalLink are:
            </p>
            <ul className="list-disc list-inside space-y-2 text-sm text-muted-foreground pl-2">
              <li>
                <span className="font-semibold text-foreground">Verification email</span> — sent once
                when you register, to confirm your email address.
              </li>
              <li>
                <span className="font-semibold text-foreground">Password reset email</span> — sent only
                when you explicitly request a password reset.
              </li>
              <li>
                <span className="font-semibold text-foreground">Important account updates</span> — sent
                only in rare circumstances, such as a security notice directly affecting your account.
              </li>
            </ul>
            <p className="text-muted-foreground text-sm leading-relaxed">
              We do not send promotional emails, newsletters, or marketing spam. Period.
            </p>
          </div>

          {/* Data Security */}
          <div className="rounded-3xl bg-card border border-border p-8 space-y-3">
            <h2 className="text-xl font-bold text-foreground">Data Security</h2>
            <p className="text-muted-foreground text-sm leading-relaxed">
              We take reasonable steps to protect your information. Our security practices include:
            </p>
            <ul className="list-disc list-inside space-y-2 text-sm text-muted-foreground pl-2">
              <li>
                <span className="font-semibold text-foreground">Password hashing</span> — your password
                is never stored in plain text. We use bcrypt to hash passwords before storing them.
              </li>
              <li>
                <span className="font-semibold text-foreground">JWT expiration</span> — authentication
                tokens have a limited lifespan and expire automatically, reducing exposure from stolen tokens.
              </li>
              <li>
                <span className="font-semibold text-foreground">HTTPS</span> — all data transmitted
                between your browser and our servers is encrypted using HTTPS in production.
              </li>
              <li>
                <span className="font-semibold text-foreground">Email token expiry</span> — verification
                and password reset links expire within a short window (24 hours for verification, 1 hour for resets).
              </li>
            </ul>
            <p className="text-muted-foreground text-sm leading-relaxed">
              No system is 100% secure. While we do our best to protect your data, we cannot guarantee
              absolute security. We encourage you to use a strong, unique password for your account.
            </p>
          </div>

          {/* Your Rights */}
          <div className="rounded-3xl bg-card border border-border p-8 space-y-3">
            <h2 className="text-xl font-bold text-foreground">Your Rights</h2>
            <p className="text-muted-foreground text-sm leading-relaxed">
              You have control over your data on LocalLink:
            </p>
            <ul className="list-disc list-inside space-y-2 text-sm text-muted-foreground pl-2">
              <li>
                <span className="font-semibold text-foreground">Update your information</span> — you
                can edit your profile details at any time from your account settings.
              </li>
              <li>
                <span className="font-semibold text-foreground">Request data deletion</span> — you can
                contact us at linklocal2@gmail.com to request deletion of your account and associated data.
              </li>
              <li>
                <span className="font-semibold text-foreground">Account deletion</span> — to delete
                your account, please contact us directly. We will process deletion requests promptly.
              </li>
              <li>
                <span className="font-semibold text-foreground">Data access</span> — you may contact
                us to request a copy of the personal data we hold about you.
              </li>
            </ul>
          </div>

          {/* Contact */}
          <div className="rounded-3xl bg-card border border-border p-8 space-y-3">
            <h2 className="text-xl font-bold text-foreground">Contact</h2>
            <p className="text-muted-foreground text-sm leading-relaxed">
              If you have any questions, concerns, or requests regarding this Privacy Policy or how
              we handle your data, please reach out to us at{' '}
              <a
                href="mailto:linklocal2@gmail.com"
                className="text-primary font-medium hover:text-primary/80 transition-colors"
              >
                linklocal2@gmail.com
              </a>
              . We take privacy concerns seriously and will respond as quickly as we can.
            </p>
          </div>

        </div>
      </main>
    </div>
  );
}

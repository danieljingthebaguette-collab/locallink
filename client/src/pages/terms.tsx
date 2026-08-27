export default function Terms() {
  return (
    <div className="min-h-screen bg-background pb-24 font-sans">
      <main className="container mx-auto px-4 py-12">
        <div className="max-w-3xl mx-auto space-y-6">

          {/* Page Header */}
          <div className="text-center space-y-2 mb-10">
            <h1 className="text-4xl font-bold text-foreground">Terms of Service</h1>
            <p className="text-muted-foreground text-sm">Last updated: February 2026</p>
          </div>

          {/* Introduction */}
          <div className="rounded-3xl bg-card border border-border p-8 space-y-3">
            <h2 className="text-xl font-bold text-foreground">Introduction</h2>
            <p className="text-muted-foreground text-sm leading-relaxed">
              Welcome to LocalLink, a community volunteer platform that connects volunteers with local
              opportunities. These Terms of Service govern your access to and use of the LocalLink
              website and services.
            </p>
            <p className="text-muted-foreground text-sm leading-relaxed">
              By creating an account or using LocalLink in any way, you agree to be bound by these
              Terms. If you do not agree with any part of these Terms, please do not use our platform.
              We encourage you to read them carefully.
            </p>
          </div>

          {/* User Accounts */}
          <div className="rounded-3xl bg-card border border-border p-8 space-y-3">
            <h2 className="text-xl font-bold text-foreground">User Accounts</h2>
            <p className="text-muted-foreground text-sm leading-relaxed">
              To use certain features of LocalLink you must register for an account. You agree to:
            </p>
            <ul className="list-disc list-inside space-y-2 text-sm text-muted-foreground pl-2">
              <li>Provide accurate, current, and complete information during registration.</li>
              <li>Keep your account credentials secure and not share them with others.</li>
              <li>Be at least 13 years of age. Users under 18 should have parental or guardian consent.</li>
              <li>
                Take full responsibility for all activity that occurs under your account. Notify us
                immediately at linklocal2@gmail.com if you suspect unauthorized use.
              </li>
            </ul>
            <p className="text-muted-foreground text-sm leading-relaxed">
              We reserve the right to suspend or terminate accounts that violate these Terms or that
              have been inactive for an extended period.
            </p>
          </div>

          {/* Acceptable Use */}
          <div className="rounded-3xl bg-card border border-border p-8 space-y-3">
            <h2 className="text-xl font-bold text-foreground">Acceptable Use</h2>
            <p className="text-muted-foreground text-sm leading-relaxed">
              LocalLink is a platform for genuine community volunteering. You agree not to:
            </p>
            <ul className="list-disc list-inside space-y-2 text-sm text-muted-foreground pl-2">
              <li>Post spam, duplicate listings, or unsolicited promotional content.</li>
              <li>Provide false, misleading, or inaccurate information about yourself or any opportunity.</li>
              <li>Harass, threaten, or intimidate other users in any way.</li>
              <li>
                Post volunteer opportunities that are not real, legitimate, and free to participate in.
                All listed opportunities must represent genuine community events.
              </li>
              <li>Use the platform for any unlawful purpose or in violation of any applicable laws.</li>
              <li>Attempt to access other users' accounts or any part of the platform you are not authorized to use.</li>
            </ul>
          </div>

          {/* Content */}
          <div className="rounded-3xl bg-card border border-border p-8 space-y-3">
            <h2 className="text-xl font-bold text-foreground">Content</h2>
            <p className="text-muted-foreground text-sm leading-relaxed">
              You retain ownership of any content you submit to LocalLink, including event listings,
              profile information, and comments. By posting content on LocalLink, you grant us a
              non-exclusive, royalty-free, worldwide license to display, distribute, and promote that
              content in connection with operating the platform.
            </p>
            <p className="text-muted-foreground text-sm leading-relaxed">
              We do not claim ownership of your content. However, we reserve the right to remove or
              modify any content that, in our sole discretion, violates these Terms, is harmful to
              other users, or is otherwise inappropriate for the platform. We will make reasonable
              efforts to notify you before taking such action where possible.
            </p>
          </div>

          {/* Limitation of Liability */}
          <div className="rounded-3xl bg-card border border-border p-8 space-y-3">
            <h2 className="text-xl font-bold text-foreground">Limitation of Liability</h2>
            <p className="text-muted-foreground text-sm leading-relaxed">
              LocalLink is a platform that connects volunteers with opportunities posted by third
              parties. We do not organize, supervise, or control these events, and we cannot verify
              the accuracy of every listing. You acknowledge that:
            </p>
            <ul className="list-disc list-inside space-y-2 text-sm text-muted-foreground pl-2">
              <li>
                Your participation in any volunteer event is entirely at your own risk. LocalLink is
                not responsible for any injury, loss, or damage arising from your attendance.
              </li>
              <li>
                We are not liable for the actions, content, or conduct of any third-party event
                organizers or other users of the platform.
              </li>
              <li>
                To the fullest extent permitted by applicable law, LocalLink's total liability for
                any claim related to the platform shall not exceed the amount you have paid us, if any.
              </li>
            </ul>
          </div>

          {/* Changes to Terms */}
          <div className="rounded-3xl bg-card border border-border p-8 space-y-3">
            <h2 className="text-xl font-bold text-foreground">Changes to Terms</h2>
            <p className="text-muted-foreground text-sm leading-relaxed">
              We may update these Terms of Service from time to time to reflect changes to our
              platform, legal requirements, or for other reasons. When we make material changes, we
              will update the "Last updated" date at the top of this page.
            </p>
            <p className="text-muted-foreground text-sm leading-relaxed">
              Your continued use of LocalLink after any changes take effect constitutes your
              acceptance of the revised Terms. We encourage you to review this page periodically.
            </p>
          </div>

          {/* Contact */}
          <div className="rounded-3xl bg-card border border-border p-8 space-y-3">
            <h2 className="text-xl font-bold text-foreground">Contact</h2>
            <p className="text-muted-foreground text-sm leading-relaxed">
              If you have any questions about these Terms of Service, please contact us at{' '}
              <a
                href="mailto:linklocal2@gmail.com"
                className="text-primary font-medium hover:text-primary/80 transition-colors"
              >
                linklocal2@gmail.com
              </a>
              . We aim to respond to all inquiries within a reasonable timeframe.
            </p>
          </div>

        </div>
      </main>
    </div>
  );
}

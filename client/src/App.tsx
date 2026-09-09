import { useEffect } from "react";
import { Switch, Route, useLocation } from "wouter";
import { MotionConfig } from "framer-motion";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import Navigation from "@/components/Navigation";
import FeedbackButton from "@/components/FeedbackButton";
import OnboardingQuestionnaire from "@/components/OnboardingQuestionnaire";
import Home from "@/pages/home";
import MyEvents from "@/pages/my-events";
import About from "@/pages/about";
import Profile from "@/pages/profile";
import Account from "@/pages/account";
import Admin from "@/pages/admin";
import VerifyEmail from "@/pages/verify-email";
import ForgotPassword from "@/pages/forgot-password";
import ResetPassword from "@/pages/reset-password";
import Terms from "@/pages/terms";
import Privacy from "@/pages/privacy";
import NotFound from "@/pages/not-found";
import OrgProfilePage from "@/pages/org-profile";
import HoursPage from '@/pages/hours';
import CertificatePage from '@/pages/certificate';
import ApproveHoursPage from '@/pages/approve-hours';
import CheckCertificatePage from '@/pages/check-certificate';
import AttendancePage from '@/pages/attendance';
import ScanPage from '@/pages/scan';
import EventCodePage from '@/pages/event-code';
import SessionsPage from '@/pages/sessions';
import JoinPage from "@/pages/join";

/**
 * wouter keeps the window scroll offset across route changes, so clicking
 * "About" from halfway down the board used to land you halfway down About.
 * Instant, not smooth — html has scroll-behavior: smooth, and animating the
 * old page upward on every navigation reads as a glitch.
 */
function ScrollToTop() {
  const [pathname] = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [pathname]);
  return null;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/my-events" component={MyEvents} />
      <Route path="/about" component={About} />
      <Route path="/profile" component={Profile} />
      <Route path="/account" component={Account} />
      <Route path="/admin" component={Admin} />
      <Route path="/verify-email" component={VerifyEmail} />
      <Route path="/forgot-password" component={ForgotPassword} />
      <Route path="/reset-password" component={ResetPassword} />
      <Route path="/terms" component={Terms} />
      <Route path="/privacy" component={Privacy} />
      <Route path="/org/:id" component={OrgProfilePage} />
      <Route path="/join/:slug" component={JoinPage} />
      {/* Hour tracking. approve-hours and check are open to people with no
          account at all — a supervisor confirming, and a teacher checking. */}
      <Route path="/hours" component={HoursPage} />
      <Route path="/certificate" component={CertificatePage} />
      <Route path="/approve-hours/:token" component={ApproveHoursPage} />
      <Route path="/check" component={CheckCertificatePage} />
      <Route path="/attendance/:token" component={AttendancePage} />
      <Route path="/scan/:code" component={ScanPage} />
      <Route path="/event-code/:id" component={EventCodePage} />
      <Route path="/sessions" component={SessionsPage} />
      <Route path="/check/:code" component={CheckCertificatePage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  const [location] = useLocation();

  // The only screen an unrelated popup shouldn't stack on top of: the
  // login/register page itself, and the moment right after registering is
  // not the moment to stack a second form over the first.
  const hideOnboarding = location.startsWith('/account');

  return (
    <QueryClientProvider client={queryClient}>
      {/* "user" defers to the OS reduced-motion setting for every framer-motion
          animation on the site, so it doesn't have to be handled per component. */}
      <MotionConfig reducedMotion="user">
        <ScrollToTop />
        <Toaster />
        <Navigation />
        <Router />
        <FeedbackButton />
        <OnboardingQuestionnaire suppressed={hideOnboarding} />
      </MotionConfig>
    </QueryClientProvider>
  );
}

export default App;

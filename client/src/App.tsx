import { useEffect } from "react";
import { Switch, Route, useLocation } from "wouter";
import { MotionConfig } from "framer-motion";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import Navigation from "@/components/Navigation";
import FeedbackButton from "@/components/FeedbackButton";
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
import Leaderboard from "@/pages/leaderboard";
import OrgProfilePage from "@/pages/org-profile";
import JoinPage from "@/pages/join";
import Tracker from "@/pages/tracker";
import CheckIn from "@/pages/checkin";

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
      <Route path="/leaderboard" component={Leaderboard} />
      <Route path="/verify-email" component={VerifyEmail} />
      <Route path="/forgot-password" component={ForgotPassword} />
      <Route path="/reset-password" component={ResetPassword} />
      <Route path="/terms" component={Terms} />
      <Route path="/privacy" component={Privacy} />
      <Route path="/org/:id" component={OrgProfilePage} />
      <Route path="/tracker" component={Tracker} />
      <Route path="/checkin/:opportunityId" component={CheckIn} />
      <Route path="/join/:slug" component={JoinPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
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
      </MotionConfig>
    </QueryClientProvider>
  );
}

export default App;

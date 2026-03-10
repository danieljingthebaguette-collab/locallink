import { useLocation } from 'wouter';
import { Heart, Users, MapPin, Star, Mail, Globe } from 'lucide-react';
import Logo from '@/components/Logo';

const TEAM_VALUES = [
  {
    icon: Heart,
    title: 'Community First',
    description:
      'We believe every neighborhood thrives when its residents come together. LocalLink exists to make that connection effortless.',
  },
  {
    icon: Users,
    title: 'Inclusive by Design',
    description:
      'Whether you have two hours or two days, there is a place for you. We welcome volunteers of all backgrounds and skill sets.',
  },
  {
    icon: MapPin,
    title: 'Hyper-Local Impact',
    description:
      'Big change starts close to home. We focus on opportunities right in your community so you can see the difference you make.',
  },
  {
    icon: Star,
    title: 'Recognition Matters',
    description:
      'Every hour you give is meaningful. We celebrate your contributions and keep a transparent record of the impact you make.',
  },
];

export default function About() {
  const [, navigate] = useLocation();

  return (
    <div className="min-h-screen bg-gradient-to-b from-primary/5 via-background to-background pb-24 font-sans">
      <main className="container mx-auto px-4 py-12 max-w-3xl">

        {/* Hero */}
        <div className="text-center space-y-4 mb-14">
          <div className="inline-flex items-center justify-center w-20 h-16 rounded-2xl bg-primary/10 mb-2">
            <Logo size={36} className="text-primary" />
          </div>
          <h1 className="text-4xl font-heading font-bold text-foreground">About LocalLink</h1>
          <p className="text-lg text-muted-foreground leading-relaxed max-w-xl mx-auto">
            Linking people to local action — one volunteer opportunity at a time.
          </p>
        </div>

        {/* Mission */}
        <section className="rounded-3xl bg-card border-2 border-border shadow-sm p-8 mb-8 space-y-4">
          <h2 className="text-2xl font-bold text-foreground">Our Mission</h2>
          <p className="text-muted-foreground leading-relaxed">
            LocalLink is a community volunteer platform built to bridge the gap between people who
            want to help and the organizations that need them. We make it simple to discover,
            sign up for, and track volunteer opportunities happening right in your neighbourhood.
          </p>
          <p className="text-muted-foreground leading-relaxed">
            From park clean-ups and food drives to tutoring programs and community events, LocalLink
            puts local action at your fingertips. Every contribution — no matter how small — adds up
            to real, lasting impact.
          </p>
        </section>

        {/* Values */}
        <section className="mb-8">
          <h2 className="text-2xl font-bold text-foreground mb-6">What We Stand For</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            {TEAM_VALUES.map(({ icon: Icon, title, description }) => (
              <div
                key={title}
                className="rounded-2xl bg-card border-2 border-border shadow-sm p-6 space-y-3"
              >
                <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-primary/10">
                  <Icon className="w-5 h-5 text-primary" />
                </div>
                <h3 className="font-semibold text-foreground">{title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
              </div>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section className="rounded-3xl bg-card border-2 border-border shadow-sm p-8 mb-8 space-y-4">
          <h2 className="text-2xl font-bold text-foreground">How It Works</h2>
          <ol className="space-y-4">
            {[
              { step: '1', text: 'Create a free account and verify your email.' },
              { step: '2', text: 'Browse volunteer opportunities in your area or search by category.' },
              { step: '3', text: 'Sign up for events that fit your schedule and interests.' },
              { step: '4', text: 'Show up, contribute, and make a real difference in your community.' },
              { step: '5', text: 'Track your events on your profile and celebrate your progress.' },
            ].map(({ step, text }) => (
              <li key={step} className="flex items-start gap-4">
                <span className="flex-shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-full bg-primary text-primary-foreground text-sm font-bold">
                  {step}
                </span>
                <p className="text-muted-foreground leading-relaxed pt-0.5">{text}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Contact */}
        <section className="rounded-3xl bg-primary/5 border-2 border-primary/20 p-8 space-y-4 text-center">
          <h2 className="text-2xl font-bold text-foreground">Get In Touch</h2>
          <p className="text-muted-foreground leading-relaxed">
            Have a question, want to partner with us, or know of an organisation that could benefit
            from LocalLink? We'd love to hear from you.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-2">
            <a
              href="mailto:linklocal2@gmail.com"
              className="inline-flex items-center gap-2 bg-primary text-primary-foreground rounded-full px-5 py-2.5 text-sm font-semibold hover:bg-primary/90 transition-colors"
            >
              <Mail className="w-4 h-4" />
              linklocal2@gmail.com
            </a>
            <button
              onClick={() => navigate('/')}
              className="inline-flex items-center gap-2 border-2 border-border rounded-full px-5 py-2.5 text-sm font-semibold text-foreground hover:bg-muted transition-colors"
            >
              <Globe className="w-4 h-4" />
              Visit LocalLink
            </button>
          </div>
        </section>

        {/* Legal Links */}
        <div className="flex items-center justify-center gap-6 pt-4 text-sm text-muted-foreground">
          <button onClick={() => navigate('/terms')} className="hover:text-foreground transition-colors">Terms of Service</button>
          <span>&bull;</span>
          <button onClick={() => navigate('/privacy')} className="hover:text-foreground transition-colors">Privacy Policy</button>
        </div>

      </main>
    </div>
  );
}

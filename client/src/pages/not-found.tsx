import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { Home } from 'lucide-react';

export default function NotFound() {
  const [, navigate] = useLocation();

  return (
    <div className="min-h-screen bg-gradient-to-b from-primary/5 via-background to-background pb-24 font-sans flex items-center justify-center">
      <div className="text-center space-y-6 px-4">
        <p className="text-8xl font-bold text-primary/20 leading-none select-none">404</p>
        <div className="space-y-2">
          <h1 className="text-2xl font-heading font-bold text-foreground">Page Not Found</h1>
          <p className="text-muted-foreground max-w-sm mx-auto">
            The page you're looking for doesn't exist or may have been moved.
          </p>
        </div>
        <Button
          onClick={() => navigate('/')}
          className="rounded-full px-8 h-11 font-semibold"
        >
          <Home className="w-4 h-4 mr-2" />
          Go Home
        </Button>
      </div>
    </div>
  );
}

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import toast from 'react-hot-toast';
import { authApi } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import DotGrid from '../components/DotGrid';
import LoginQuoteOverlay from '../components/LoginQuoteOverlay';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function LoginDotGrid() {
  return (
    <DotGrid
      dotSize={5}
      gap={16}
      baseColor="#2f293a"
      activeColor="#fafafa"
      proximity={78}
      speedTrigger={10000}
      shockRadius={0}
      shockStrength={0}
      maxSpeed={5000}
      resistance={1200}
      returnDuration={0.6}
    />
  );
}

const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const { login } = useAuthStore();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!username.trim() || !password.trim()) {
      toast.error('Please enter both username and password');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await authApi.login({ username: username.trim(), password });
      if (response.data?.token) {
        login(response.data.token, response.data.user);
        toast.success('Logged in successfully');
        navigate('/', { replace: true });
      } else {
        const msg = response.message || 'Login failed';
        setError(msg);
        toast.error(msg);
      }
    } catch (err: unknown) {
      let msg = 'Login failed — backend may be offline. Run: docker compose up -d';
      if (typeof err === 'string') {
        msg = err.includes('timeout')
          ? 'Backend slow or busy — wait a moment and try again (Docker must be running).'
          : err;
      } else if (err instanceof Error) {
        msg = err.message.includes('timeout')
          ? 'Backend slow or busy — wait a moment and try again.'
          : err.message;
      } else if (typeof err === 'object' && err && 'error' in err) {
        msg = String((err as { error: string }).error);
      }
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="safe-top safe-bottom flex min-h-[100dvh] flex-col overflow-hidden bg-background lg:flex-row">
      <aside className="relative hidden w-[64%] shrink-0 overflow-hidden bg-[#070708] lg:block">
        <div className="absolute inset-0">
          <LoginDotGrid />
        </div>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-background/10 to-background"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background/55 via-transparent to-background/25"
        />
        <LoginQuoteOverlay />
      </aside>

      <div className="relative h-36 w-full shrink-0 overflow-hidden bg-[#070708] lg:hidden">
        <div className="absolute inset-0">
          <LoginDotGrid />
        </div>
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-b from-background/10 to-background" />
        <LoginQuoteOverlay compact className="px-5 py-4" />
      </div>

      <section className="flex flex-1 flex-col justify-center bg-background px-6 py-10 sm:px-12 lg:px-16 xl:px-20">
        <div className="mx-auto w-full max-w-[420px] lg:mx-0 lg:max-w-[min(480px,90%)]">
          <header className="mb-8">
            <p className="text-sm text-muted-foreground">KurdLogs Core</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">Sign in</h1>
          </header>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2 sm:gap-3">
              <div className="space-y-2 sm:col-span-1">
                <Label htmlFor="username" className="text-sm font-normal text-muted-foreground">
                  Username
                </Label>
                <Input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Username"
                  autoComplete="username"
                  autoFocus
                  className="h-10"
                />
              </div>

              <div className="space-y-2 sm:col-span-1">
                <Label htmlFor="password" className="text-sm font-normal text-muted-foreground">
                  Password
                </Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Password"
                    autoComplete="current-password"
                    className="h-10 pr-10"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-10 w-10 text-muted-foreground"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            </div>

            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}

            <Button type="submit" className="h-10 w-full sm:w-auto sm:min-w-[140px]" disabled={loading}>
              {loading ? (
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />
              ) : (
                'Continue'
              )}
            </Button>
          </form>

          <p className="mt-10 text-xs text-muted-foreground">
            &copy; {new Date().getFullYear()} KurdLogs Core
          </p>
        </div>
      </section>
    </div>
  );
};

export default LoginPage;

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogIn, Eye, EyeOff, Radio } from 'lucide-react';
import toast from 'react-hot-toast';
import { authApi } from '../services/api';
import { useAuthStore } from '../stores/authStore';

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
    <div className="min-h-[100dvh] bg-black flex items-center justify-center px-4 py-8 safe-top safe-bottom">
      <div className="w-full max-w-md">
        {/* Logo / Brand */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-3">
            <Radio className="w-10 h-10 text-white" />
            <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">KurdLogs Core</h1>
          </div>
          <p className="text-gray-500 text-sm">Media Server Control Panel</p>
        </div>

        {/* Login Card */}
        <div className="bg-[#111111] border border-[#333333] rounded-lg p-8">
          <h2 className="text-xl font-semibold text-white mb-6">Sign In</h2>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Username */}
            <div>
              <label htmlFor="username" className="block text-sm font-medium text-gray-400 mb-1.5">
                Username
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter your username"
                autoComplete="username"
                autoFocus
                className="w-full px-4 py-2.5 bg-[#111111] border border-[#333333] rounded-md text-white placeholder-gray-600 focus:outline-none focus:border-gray-500 transition-colors"
              />
            </div>

            {/* Password */}
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-400 mb-1.5">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  className="w-full px-4 py-2.5 bg-[#111111] border border-[#333333] rounded-md text-white placeholder-gray-600 focus:outline-none focus:border-gray-500 transition-colors pr-11"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Submit */}
            {error && (
              <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                {error}
              </div>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-white text-black font-medium rounded-md hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-black/30 border-t-black rounded-full animate-spin" />
              ) : (
                <>
                  <LogIn className="w-4 h-4" />
                  Sign In
                </>
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-gray-600 text-xs mt-6">
          KurdLogs Core v1.0 &copy; {new Date().getFullYear()}
          <span className="block mt-2 text-gray-500">
            After sign-in: sidebar → <strong className="text-gray-400">Install app</strong> to add
            KurdLogs to your home screen or desktop.
          </span>
        </p>
      </div>
    </div>
  );
};

export default LoginPage;

import { type ReactNode, useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Tv2,
  ListVideo,
  Settings2,
  Key,
  Layers,
  Activity,
  Settings,
  LogOut,
  Menu,
  X,
  Download,
  Palette,
  ListOrdered,
  Gauge,
  Blocks,
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import InstallAppBanner from './InstallAppBanner';
import { BUILD_VERSION } from '../config/buildVersion';

interface LayoutProps {
  children: ReactNode;
}

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/channels', icon: Tv2, label: 'Channels' },
  { to: '/playlists', icon: ListVideo, label: 'Playlists' },
  { to: '/blueprints', icon: Blocks, label: 'Blueprint' },
  { to: '/transcoding', icon: Settings2, label: 'Transcoding' },
  { to: '/tokens', icon: Key, label: 'Tokens' },
  { to: '/overlays', icon: Layers, label: 'Overlays' },
  { to: '/brand-profiles', icon: Palette, label: 'Branding' },
  { to: '/processing', icon: ListOrdered, label: 'Processing' },
  { to: '/monitoring', icon: Activity, label: 'Monitoring' },
  { to: '/benchmark', icon: Gauge, label: 'Benchmark' },
  { to: '/settings', icon: Settings, label: 'Settings' },
  { to: '/install', icon: Download, label: 'Install app' },
];

export default function Layout({ children }: LayoutProps) {
  const logout = useAuthStore((s) => s.logout);
  const location = useLocation();
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!navOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [navOpen]);

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-black">
      {/* Mobile top bar */}
      <header className="lg:hidden fixed top-0 inset-x-0 z-40 flex items-center gap-3 px-4 py-3 border-b border-[#333] bg-black/95 backdrop-blur-sm safe-top">
        <button
          type="button"
          onClick={() => setNavOpen(true)}
          className="p-2 -ml-2 rounded-md text-gray-300 hover:text-white hover:bg-[#1a1a1a]"
          aria-label="Open menu"
        >
          <Menu size={22} />
        </button>
        <div className="min-w-0 flex-1">
          <span className="text-base font-bold text-white">Kurd</span>
          <span className="text-base font-bold text-white">Logs</span>
          <span className="text-base font-light text-[#888] ml-1">Core</span>
        </div>
      </header>

      {/* Backdrop */}
      {navOpen && (
        <button
          type="button"
          className="lg:hidden fixed inset-0 z-40 bg-black/70"
          aria-label="Close menu"
          onClick={() => setNavOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-50 w-64 max-w-[min(100vw,18rem)] flex-shrink-0 border-r border-[#333] bg-black flex flex-col transition-transform duration-200 ease-out lg:translate-x-0 ${
          navOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="px-5 py-5 border-b border-[#333] flex items-center justify-between">
          <div>
            <span className="text-xl font-bold text-white">Kurd</span>
            <span className="text-xl font-bold text-white">Logs</span>
            <span className="text-xl font-light text-[#888] ml-1">Core</span>
          </div>
          <button
            type="button"
            onClick={() => setNavOpen(false)}
            className="lg:hidden p-2 rounded-md text-gray-400 hover:text-white hover:bg-[#1a1a1a]"
            aria-label="Close menu"
          >
            <X size={20} />
          </button>
        </div>

        <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto overscroll-contain">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              onClick={() => setNavOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-3 lg:py-2.5 rounded-md text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-[#1a1a1a] text-white'
                    : 'text-[#888] hover:text-white hover:bg-[#111]'
                }`
              }
            >
              <item.icon size={18} />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="px-3 py-4 border-t border-[#333] safe-bottom">
          <p className="px-3 pb-2 text-[10px] font-mono text-emerald-600/80" title="Deploy version — if missing, VPS has old frontend">
            build {BUILD_VERSION}
          </p>
          <button
            type="button"
            onClick={logout}
            className="flex items-center gap-3 px-3 py-3 lg:py-2.5 rounded-md text-sm font-medium text-[#888] hover:text-white hover:bg-[#111] transition-colors w-full"
          >
            <LogOut size={18} />
            Logout
          </button>
        </div>
      </aside>

      <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden bg-black pt-[3.25rem] lg:pt-0 p-4 sm:p-6 safe-bottom">
        <InstallAppBanner />
        {children}
      </main>
    </div>
  );
}

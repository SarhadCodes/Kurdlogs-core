import { type ReactNode, useEffect, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
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
  Download,
  Palette,
  ListOrdered,
  Gauge,
  Blocks,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import InstallAppBanner from './InstallAppBanner';
import ConfirmDialog from './ConfirmDialog';
import { resolveAvatarUrl, userDisplayName, userInitials } from '../utils/userProfile';
import { useSidebarCollapsed } from '@/hooks/useSidebarCollapsed';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

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

function BrandMark() {
  return (
    <div className="min-w-0">
      <p className="font-display text-xl font-bold tracking-tight text-foreground">
        KurdLogs
        <span className="ml-1.5 font-medium text-muted-foreground">Core</span>
      </p>
    </div>
  );
}

function NavItems({
  collapsed,
  onNavigate,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <nav
      className={cn(
        collapsed ? 'flex w-full flex-col gap-1 py-2' : 'space-y-1 px-3 py-3'
      )}
    >
      {navItems.map((item) => {
        const link = (
          <NavLink
            to={item.to}
            end={item.to === '/'}
            onClick={onNavigate}
            title={collapsed ? undefined : item.label}
            className={({ isActive }) =>
              cn(
                'flex items-center rounded-md text-sm font-medium transition-colors duration-200',
                collapsed
                  ? 'mx-auto h-9 w-9 justify-center'
                  : 'gap-3 px-3 py-2.5',
                isActive
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:bg-accent/70 hover:text-foreground'
              )
            }
          >
            <item.icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} />
            {!collapsed && <span className="truncate">{item.label}</span>}
          </NavLink>
        );

        if (!collapsed) {
          return (
            <div key={item.to} className="w-full">
              {link}
            </div>
          );
        }

        return (
          <Tooltip key={item.to}>
            <TooltipTrigger asChild>
              <div className="flex w-full justify-center">{link}</div>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={10}>
              {item.label}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </nav>
  );
}

function UserAvatar({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const user = useAuthStore((s) => s.user);
  const avatarSrc = resolveAvatarUrl(user?.avatarUrl);
  const dim = size === 'sm' ? 'h-9 w-9 text-xs' : 'h-10 w-10 text-sm';

  if (avatarSrc) {
    return (
      <img
        src={avatarSrc}
        alt=""
        className={cn('shrink-0 rounded-full object-cover border border-border', dim)}
      />
    );
  }

  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full border border-border bg-secondary font-semibold text-foreground',
        dim
      )}
    >
      {userInitials(user)}
    </div>
  );
}

function SidebarFooter({
  collapsed,
  onLogout,
  onOpenProfile,
}: {
  collapsed?: boolean;
  onLogout: () => void;
  onOpenProfile: () => void;
}) {
  const user = useAuthStore((s) => s.user);
  const name = userDisplayName(user);

  const profileButton = (
    <button
      type="button"
      onClick={onOpenProfile}
      className={cn(
        'flex items-center rounded-md text-left transition-colors hover:bg-accent',
        collapsed
          ? 'h-9 w-9 shrink-0 justify-center rounded-full p-0'
          : 'w-full gap-3 rounded-lg border border-border bg-secondary/50 px-2.5 py-2.5'
      )}
      title={collapsed ? undefined : 'Edit profile'}
    >
      <UserAvatar size={collapsed ? 'sm' : 'md'} />
      {!collapsed && (
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{name}</p>
          <p className="truncate text-[11px] text-muted-foreground">@{user?.username || 'user'}</p>
        </div>
      )}
    </button>
  );

  const logoutButton = (
    <Button
      type="button"
      variant="ghost"
      size={collapsed ? 'icon' : 'default'}
      className={cn(
        'text-muted-foreground transition-colors',
        collapsed ? 'h-9 w-9 shrink-0' : 'w-full justify-start gap-3'
      )}
      onClick={onLogout}
      title={collapsed ? undefined : 'Logout'}
    >
      <LogOut className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} />
      {!collapsed && <span>Logout</span>}
    </Button>
  );

  return (
    <div
      className={cn(
        'border-t border-border py-3 safe-bottom',
        collapsed ? 'flex flex-col items-center gap-2 px-1.5' : 'space-y-3 px-3'
      )}
    >
      {collapsed ? (
        <Tooltip>
          <TooltipTrigger asChild>{profileButton}</TooltipTrigger>
          <TooltipContent side="right" sideOffset={8}>
            {name}
          </TooltipContent>
        </Tooltip>
      ) : (
        profileButton
      )}

      {collapsed ? (
        <Tooltip>
          <TooltipTrigger asChild>{logoutButton}</TooltipTrigger>
          <TooltipContent side="right" sideOffset={8}>
            Logout
          </TooltipContent>
        </Tooltip>
      ) : (
        logoutButton
      )}
    </div>
  );
}

function SidebarCollapseToggle({
  collapsed,
  onToggle,
  className,
}: {
  collapsed: boolean;
  onToggle: () => void;
  className?: string;
}) {
  const button = (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn('h-8 w-8 shrink-0 text-muted-foreground', className)}
      onClick={onToggle}
      aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
    >
      {collapsed ? (
        <PanelLeftOpen className="h-[18px] w-[18px]" strokeWidth={1.75} />
      ) : (
        <PanelLeftClose className="h-[18px] w-[18px]" strokeWidth={1.75} />
      )}
    </Button>
  );

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>
          Expand sidebar
        </TooltipContent>
      </Tooltip>
    );
  }

  return button;
}

export default function Layout({ children }: LayoutProps) {
  const logout = useAuthStore((s) => s.logout);
  const location = useLocation();
  const navigate = useNavigate();
  const [navOpen, setNavOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const { collapsed: sidebarCollapsed, toggle: toggleSidebar } = useSidebarCollapsed();

  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  const requestLogout = () => {
    setNavOpen(false);
    setLogoutOpen(true);
  };

  const openProfile = () => {
    setNavOpen(false);
    navigate('/settings');
  };

  return (
    <TooltipProvider delayDuration={0}>
      <div className="flex h-[100dvh] overflow-hidden bg-background">
        <header className="safe-top fixed inset-x-0 top-0 z-40 flex min-h-14 items-center gap-3 border-b border-border bg-background px-4 py-3 lg:hidden">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setNavOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="h-[22px] w-[22px]" strokeWidth={1.75} />
          </Button>
          <BrandMark />
        </header>

        <Sheet open={navOpen} onOpenChange={setNavOpen}>
          <SheetContent side="left" className="flex w-[min(100vw,18rem)] flex-col p-0">
            <SheetHeader className="border-b border-border px-5 py-5">
              <SheetTitle>
                <BrandMark />
              </SheetTitle>
            </SheetHeader>
            <ScrollArea className="flex-1">
              <NavItems onNavigate={() => setNavOpen(false)} />
            </ScrollArea>
            <SidebarFooter onLogout={requestLogout} onOpenProfile={openProfile} />
          </SheetContent>
        </Sheet>

        <aside
          className={cn(
            'hidden shrink-0 flex-col border-r border-border bg-card/40 transition-[width] duration-300 ease-in-out lg:flex',
            sidebarCollapsed ? 'w-14' : 'w-64'
          )}
        >
          {sidebarCollapsed ? (
            <div className="flex justify-center border-b border-border py-3">
              <SidebarCollapseToggle collapsed={sidebarCollapsed} onToggle={toggleSidebar} />
            </div>
          ) : (
            <div className="border-b border-border px-4 py-4">
              <div className="flex w-full items-center justify-between gap-2">
                <BrandMark />
                <SidebarCollapseToggle collapsed={sidebarCollapsed} onToggle={toggleSidebar} />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Broadcast control</p>
            </div>
          )}
          <ScrollArea className="min-h-0 flex-1 w-full">
            <NavItems collapsed={sidebarCollapsed} />
          </ScrollArea>
          <SidebarFooter
            collapsed={sidebarCollapsed}
            onLogout={requestLogout}
            onOpenProfile={openProfile}
          />
        </aside>

        <main className="safe-bottom app-main-gradient min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-4 pb-4 pt-[calc(4.75rem+env(safe-area-inset-top,0px))] sm:px-6 sm:pb-6 lg:pt-6">
          <InstallAppBanner />
          {children}
        </main>

        <ConfirmDialog
          isOpen={logoutOpen}
          onClose={() => setLogoutOpen(false)}
          onConfirm={logout}
          title="Sign out"
          message="Are you sure you want to log out of KurdLogs?"
          confirmLabel="Log out"
        />
      </div>
    </TooltipProvider>
  );
}

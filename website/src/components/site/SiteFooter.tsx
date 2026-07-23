import { Link } from 'react-router-dom';
import { Separator } from '@/components/ui/separator';

const footerLinks = [
  { to: '/about', label: 'About' },
  { to: '/team', label: 'Team' },
  { to: '/faq', label: 'FAQ' },
  { to: '/docs', label: 'Documentation' },
];

export default function SiteFooter() {
  return (
    <footer className="border-t border-border bg-background">
      <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8">
        <div className="flex flex-col gap-10 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-display text-2xl font-bold tracking-tight text-foreground">
              KurdLogs <span className="font-medium text-muted-foreground">Core</span>
            </p>
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">
              Self-hosted broadcast control for channels, playlists, and continuous TV.
            </p>
          </div>
          <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
            {footerLinks.map((link) => (
              <Link key={link.to} to={link.to} className="transition-colors hover:text-foreground">
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
        <Separator className="my-8" />
        <p className="text-xs text-muted-foreground">
          © {new Date().getFullYear()} KurdLogs Core. MIT licensed.
        </p>
      </div>
    </footer>
  );
}

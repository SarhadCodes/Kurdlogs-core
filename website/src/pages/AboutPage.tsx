import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { PageHero, Section } from '@/components/site/Section';

export default function AboutPage() {
  return (
    <>
      <PageHero
        eyebrow="About"
        title="Broadcast software with an operator mindset"
        description="KurdLogs Core exists so media teams can run continuous channels without stitching together fragile scripts and dashboards."
      />
      <Section>
        <div className="grid gap-14 lg:grid-cols-2">
          <div className="space-y-6 text-base leading-relaxed text-muted-foreground sm:text-lg">
            <p>
              KurdLogs Core is a self-hosted IPTV and MCR-style control panel. It brings channels,
              playlists, blueprints, transcoding, overlays, tokens, and monitoring into one dark,
              focused interface.
            </p>
            <p>
              The product is designed for people who keep streams on air — not for slide decks. Docker
              Compose ships PostgreSQL, the API, the React panel, and NGINX RTMP so you can deploy
              locally or on a VPS next to existing media servers.
            </p>
            <p>
              Default ports stay out of the way of common stacks (HTTP 8081, RTMP 1936). Defaults get
              you signed in fast; Settings and environment variables harden the install for production.
            </p>
          </div>
          <div className="overflow-hidden rounded-2xl border border-border">
            <img
              src="/screenshots/monitoring.png"
              alt="Monitoring overview in KurdLogs Core"
              className="w-full object-cover object-top"
            />
          </div>
        </div>

        <div className="mt-20 grid gap-10 border-t border-border pt-16 sm:grid-cols-3">
          {[
            {
              title: 'Self-hosted',
              body: 'Your media, tokens, and credentials stay on infrastructure you control.',
            },
            {
              title: 'Operator-first',
              body: 'Dashboards, previews, and health signals built for people who watch channels, not charts.',
            },
            {
              title: 'Open core',
              body: 'MIT licensed. Extend blueprints, overlays, and deploy scripts to match your plant.',
            },
          ].map((item) => (
            <div key={item.title}>
              <h2 className="font-display text-xl font-semibold text-foreground">{item.title}</h2>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{item.body}</p>
            </div>
          ))}
        </div>

        <div className="mt-16">
          <Button asChild>
            <Link to="/team">Meet the team</Link>
          </Button>
        </div>
      </Section>
    </>
  );
}

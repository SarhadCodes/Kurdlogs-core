import { Link } from 'react-router-dom';
import { ArrowRight, Radio } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Section, SectionHeading } from '@/components/site/Section';
import InteractiveHero from '@/components/site/InteractiveHero';
import ScreenshotGallery from '@/components/site/ScreenshotGallery';
import { features } from '@/data/site';

export default function HomePage() {
  return (
    <>
      <InteractiveHero />

      <Section className="border-t border-border pt-16 sm:pt-20">
        <SectionHeading
          eyebrow="Gallery"
          title="See the panel"
          description="Browse real KurdLogs Core screens — dashboard, channels, playlists, blueprints, and monitoring."
        />
        <ScreenshotGallery />
      </Section>

      <Section className="border-t border-border bg-card/30">
        <SectionHeading
          eyebrow="Capabilities"
          title="Everything a modern channel stack needs"
          description="One control surface for ingest, scheduling, delivery, and health."
        />
        <div className="grid gap-x-10 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <div key={feature.title}>
              <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-full border border-border bg-background text-foreground">
                <Radio className="h-4 w-4" strokeWidth={1.75} />
              </div>
              <h3 className="font-display text-xl font-semibold tracking-tight text-foreground">
                {feature.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{feature.body}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section className="border-t border-border pb-24">
        <div className="relative overflow-hidden rounded-3xl border border-border bg-[linear-gradient(145deg,hsl(240_5%_9%),hsl(240_6%_4%))] px-8 py-14 sm:px-12 sm:py-16">
          <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-primary/10 blur-3xl" />
          <p className="font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl text-balance">
            Ready to run your own panel?
          </p>
          <p className="mt-4 max-w-xl text-muted-foreground">
            Follow the step-by-step install guide and be on localhost:8081 in minutes.
          </p>
          <Separator className="my-8 max-w-xs bg-border/80" />
          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link to="/docs">
                Open documentation
                <ArrowRight />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/team">Meet the team</Link>
            </Button>
          </div>
        </div>
      </Section>
    </>
  );
}

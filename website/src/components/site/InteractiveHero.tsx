import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import DotGrid from '@/components/DotGrid';
import { Button } from '@/components/ui/button';
import HeroGlobe from '@/components/site/HeroGlobe';

export default function InteractiveHero() {
  return (
    <section className="relative min-h-[100dvh] overflow-hidden bg-[#070708]">
      <div className="absolute inset-0 z-0">
        <DotGrid
          dotSize={5}
          gap={18}
          baseColor="#2f293a"
          activeColor="#fafafa"
          proximity={90}
          speedTrigger={10000}
          shockRadius={0}
          shockStrength={0}
          maxSpeed={5000}
          resistance={1200}
          returnDuration={0.6}
        />
      </div>

      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-[1] bg-gradient-to-b from-background/35 via-transparent to-background"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 z-[1] w-[48%] bg-gradient-to-r from-background via-background/70 to-transparent"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-36 bg-gradient-to-t from-background to-transparent"
      />

      {/* Live WebGL globe — sits above the field, drag to spin */}
      <div className="pointer-events-none absolute inset-y-0 right-0 z-[5] flex w-full items-center justify-center sm:w-[56%] sm:justify-end lg:w-[54%]">
        <div className="pointer-events-auto aspect-square w-[min(88vw,520px)] animate-globe-in sm:w-[min(54vw,620px)] lg:w-[min(50vw,680px)] sm:translate-x-[4%] lg:translate-x-[6%]">
          <HeroGlobe className="h-full w-full animate-globe-float" />
        </div>
      </div>

      <div className="relative z-10 mx-auto flex min-h-[100dvh] max-w-6xl flex-col justify-center px-5 pb-20 pt-28 sm:px-8">
        <div className="max-w-xl animate-fade-up pointer-events-none lg:max-w-2xl [&_a]:pointer-events-auto [&_button]:pointer-events-auto">
          <p className="font-display text-5xl font-bold tracking-tight text-white sm:text-6xl md:text-7xl">
            KurdLogs
            <span className="mt-1 block font-semibold text-white/65 sm:mt-2">Core</span>
          </p>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-white/70 sm:text-xl">
            Self-hosted broadcast control for operators who need channels, playlists, and continuous
            TV — without the noise.
          </p>
          <div className="mt-10">
            <Button asChild size="lg">
              <Link to="/docs">
                Install KurdLogs
                <ArrowRight />
              </Link>
            </Button>
          </div>
          <p className="mt-8 text-xs uppercase tracking-[0.2em] text-white/35">
            Drag the globe · move your cursor
          </p>
        </div>
      </div>
    </section>
  );
}

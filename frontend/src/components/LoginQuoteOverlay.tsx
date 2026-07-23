import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

export const LOGIN_QUOTES = [
  'Every broadcast begins with a single signal.',
  'Behind every seamless stream is a system built with precision.',
  'Control the stream. Deliver the experience.',
  'Reliable systems create unforgettable broadcasts.',
  'Where every frame matters.',
  'Precision is invisible until it\'s missing.',
  'Build once. Broadcast everywhere.',
  'Complexity behind the scenes. Simplicity at the controls.',
  'Engineered for reliability. Designed for operators.',
  'Quiet systems are dependable systems.',
  'Powering the next generation of digital broadcasting.',
  'Connecting content, channels, and audiences.',
  'Turning media into experiences.',
  'Broadcast without compromise.',
  'From media to millions of screens.',
  'Control. Create. Broadcast.',
  'Built for broadcast.',
  'Every stream begins here.',
  'Where content comes alive.',
  'Designed for continuous broadcasting.',
  'Precision in every signal. Confidence in every broadcast.',
  'Because every second on air matters.',
  'Broadcast with confidence. Deliver without limits.',
  'Professional tools for professional broadcasting.',
  'Built to keep your channels moving.',
] as const;

function pickQuoteIndex(exclude?: number) {
  if (LOGIN_QUOTES.length <= 1) return 0;
  let next = Math.floor(Math.random() * LOGIN_QUOTES.length);
  if (exclude === undefined) return next;
  while (next === exclude) {
    next = Math.floor(Math.random() * LOGIN_QUOTES.length);
  }
  return next;
}

interface LoginQuoteOverlayProps {
  className?: string;
  compact?: boolean;
  /** Auto-rotate interval in ms. Set 0 to keep the initial quote only. */
  rotateMs?: number;
}

export default function LoginQuoteOverlay({
  className,
  compact = false,
  rotateMs = 8000,
}: LoginQuoteOverlayProps) {
  const [index, setIndex] = useState(() => pickQuoteIndex());
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (!rotateMs) return;

    let fadeTimer: ReturnType<typeof setTimeout> | undefined;
    const interval = setInterval(() => {
      setVisible(false);
      fadeTimer = setTimeout(() => {
        setIndex((prev) => pickQuoteIndex(prev));
        setVisible(true);
      }, 400);
    }, rotateMs);

    return () => {
      clearInterval(interval);
      if (fadeTimer) clearTimeout(fadeTimer);
    };
  }, [rotateMs]);

  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-8 sm:p-12',
        className
      )}
    >
      <p
        className={cn(
          'text-center font-display font-medium tracking-tight text-foreground/90 transition-opacity duration-500',
          compact
            ? 'max-w-md text-base leading-snug sm:text-lg'
            : 'max-w-3xl text-3xl leading-tight sm:text-4xl lg:text-[2.75rem] lg:leading-[1.15]',
          visible ? 'opacity-100' : 'opacity-0'
        )}
        aria-live="polite"
      >
        {LOGIN_QUOTES[index]}
      </p>
    </div>
  );
}

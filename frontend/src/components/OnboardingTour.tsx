import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Compass, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useOnboardingTour } from '@/hooks/useOnboardingTour';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

function NavHighlight({ target }: { target?: string }) {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!target) {
      setRect(null);
      return;
    }

    const update = () => {
      const el = document.querySelector(`[data-tour-nav="${target}"]`);
      if (!el) {
        setRect(null);
        return;
      }
      const next = el.getBoundingClientRect();
      if (next.width < 8 || next.height < 8) {
        setRect(null);
        return;
      }
      setRect(next);
    };

    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    const timer = window.setInterval(update, 250);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      window.clearInterval(timer);
    };
  }, [target]);

  if (!rect) return null;

  return (
    <div
      className="pointer-events-none fixed z-[60] rounded-md ring-2 ring-emerald-400/90 ring-offset-2 ring-offset-background shadow-[0_0_0_9999px_rgba(0,0,0,0.55)] transition-all duration-300"
      style={{
        top: rect.top - 4,
        left: rect.left - 4,
        width: rect.width + 8,
        height: rect.height + 8,
      }}
      aria-hidden
    />
  );
}

export default function OnboardingTour() {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const location = useLocation();
  const blocked = Boolean(user?.mustChangePassword);
  const {
    active,
    step,
    stepIndex,
    total,
    isFirst,
    isLast,
    next,
    back,
    skip,
  } = useOnboardingTour(user?.id, blocked);

  const progress = useMemo(
    () => Math.round(((stepIndex + 1) / total) * 100),
    [stepIndex, total]
  );

  useEffect(() => {
    if (!active || !step?.path) return;
    if (location.pathname !== step.path) {
      navigate(step.path);
    }
  }, [active, step?.id, step?.path, navigate, location.pathname]);

  if (!active || !step) return null;

  return (
    <>
      <NavHighlight target={step.navTarget} />

      <div className="fixed inset-x-0 bottom-0 z-[70] p-4 sm:p-6 pointer-events-none">
        <div
          className={cn(
            'pointer-events-auto mx-auto w-full max-w-xl overflow-hidden rounded-xl border border-border bg-card shadow-2xl',
            'animate-in slide-in-from-bottom-4 duration-300'
          )}
          role="dialog"
          aria-labelledby="onboarding-title"
          aria-describedby="onboarding-summary"
        >
          <div className="border-b border-border bg-emerald-300/[0.06] px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-300/15 text-emerald-300">
                  <Compass className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Panel guide · Step {stepIndex + 1} of {total}
                  </p>
                  <h2 id="onboarding-title" className="font-display text-lg font-semibold text-foreground">
                    {step.title}
                  </h2>
                  <p id="onboarding-summary" className="mt-1 text-sm text-muted-foreground">
                    {step.summary}
                  </p>
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 text-muted-foreground"
                onClick={skip}
                aria-label="Skip tour"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full bg-emerald-400 transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          <div className="space-y-2 px-5 py-4">
            <ol className="space-y-2">
              {step.steps.map((item, idx) => (
                <li key={idx} className="flex gap-2.5 text-sm text-foreground/90">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-secondary text-[11px] font-semibold text-muted-foreground">
                    {idx + 1}
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ol>
          </div>

          <div className="flex flex-col-reverse gap-2 border-t border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <Button type="button" variant="ghost" className="text-muted-foreground" onClick={skip}>
              Skip tour
            </Button>
            <div className="flex gap-2 sm:justify-end">
              {!isFirst && (
                <Button type="button" variant="outline" onClick={back}>
                  <ChevronLeft className="h-4 w-4" />
                  Back
                </Button>
              )}
              <Button type="button" onClick={next}>
                {isLast ? 'Finish' : 'Next'}
                {!isLast && <ChevronRight className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

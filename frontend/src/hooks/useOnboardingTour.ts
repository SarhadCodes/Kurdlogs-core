import { useCallback, useEffect, useState } from 'react';
import { ONBOARDING_STORAGE_VERSION, onboardingSteps } from '@/config/onboardingTour';

const RESTART_EVENT = 'kurdlogs-restart-onboarding';

function storageKey(userId: string | undefined): string {
  return `kurdlogs_onboarding_${ONBOARDING_STORAGE_VERSION}_${userId || 'anonymous'}`;
}

function progressKey(userId: string | undefined): string {
  return `kurdlogs_onboarding_${ONBOARDING_STORAGE_VERSION}_progress_${userId || 'anonymous'}`;
}

function readProgress(userId: string | undefined): { stepIndex: number; active: boolean } {
  if (typeof window === 'undefined') return { stepIndex: 0, active: false };
  try {
    const raw = sessionStorage.getItem(progressKey(userId));
    if (!raw) return { stepIndex: 0, active: false };
    const parsed = JSON.parse(raw) as { stepIndex?: number; active?: boolean };
    return {
      stepIndex:
        typeof parsed.stepIndex === 'number'
          ? Math.min(Math.max(parsed.stepIndex, 0), onboardingSteps.length - 1)
          : 0,
      active: Boolean(parsed.active),
    };
  } catch {
    return { stepIndex: 0, active: false };
  }
}

function writeProgress(userId: string | undefined, stepIndex: number, active: boolean): void {
  try {
    sessionStorage.setItem(progressKey(userId), JSON.stringify({ stepIndex, active }));
  } catch {
    /* ignore */
  }
}

function clearProgress(userId: string | undefined): void {
  try {
    sessionStorage.removeItem(progressKey(userId));
  } catch {
    /* ignore */
  }
}

export function isOnboardingCompleted(userId: string | undefined): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return localStorage.getItem(storageKey(userId)) === 'done';
  } catch {
    return false;
  }
}

export function markOnboardingCompleted(userId: string | undefined): void {
  try {
    localStorage.setItem(storageKey(userId), 'done');
  } catch {
    /* ignore */
  }
}

export function clearOnboardingCompletion(userId: string | undefined): void {
  try {
    localStorage.removeItem(storageKey(userId));
  } catch {
    /* ignore */
  }
}

export function requestOnboardingRestart(): void {
  window.dispatchEvent(new CustomEvent(RESTART_EVENT));
}

export function useOnboardingTour(userId: string | undefined, blocked: boolean) {
  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [ready, setReady] = useState(false);

  const step = onboardingSteps[stepIndex];
  const total = onboardingSteps.length;
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === total - 1;

  useEffect(() => {
    if (blocked || !userId) {
      setReady(true);
      return;
    }

    if (isOnboardingCompleted(userId)) {
      clearProgress(userId);
      setActive(false);
      setStepIndex(0);
      setReady(true);
      return;
    }

    const progress = readProgress(userId);
    if (progress.active) {
      setActive(true);
      setStepIndex(progress.stepIndex);
      setReady(true);
      return;
    }

    const timer = window.setTimeout(() => {
      setActive(true);
      setStepIndex(0);
      writeProgress(userId, 0, true);
      setReady(true);
    }, 400);

    return () => window.clearTimeout(timer);
  }, [blocked, userId]);

  useEffect(() => {
    if (!ready || blocked || !userId || !active || isOnboardingCompleted(userId)) return;
    writeProgress(userId, stepIndex, true);
  }, [ready, blocked, userId, active, stepIndex]);

  useEffect(() => {
    const onRestart = () => {
      if (blocked || !userId) return;
      clearOnboardingCompletion(userId);
      clearProgress(userId);
      setStepIndex(0);
      setActive(true);
      writeProgress(userId, 0, true);
    };
    window.addEventListener(RESTART_EVENT, onRestart);
    return () => window.removeEventListener(RESTART_EVENT, onRestart);
  }, [blocked, userId]);

  const finish = useCallback(() => {
    clearProgress(userId);
    markOnboardingCompleted(userId);
    setActive(false);
    setStepIndex(0);
  }, [userId]);

  const skip = useCallback(() => {
    finish();
  }, [finish]);

  const next = useCallback(() => {
    if (isLast) {
      finish();
      return;
    }
    setStepIndex((i) => {
      const nextIndex = Math.min(i + 1, total - 1);
      writeProgress(userId, nextIndex, true);
      return nextIndex;
    });
  }, [finish, isLast, total, userId]);

  const back = useCallback(() => {
    setStepIndex((i) => {
      const prevIndex = Math.max(i - 1, 0);
      writeProgress(userId, prevIndex, true);
      return prevIndex;
    });
  }, [userId]);

  const restart = useCallback(() => {
    if (!userId) return;
    clearOnboardingCompletion(userId);
    clearProgress(userId);
    setStepIndex(0);
    setActive(true);
    writeProgress(userId, 0, true);
  }, [userId]);

  return {
    active,
    step,
    stepIndex,
    total,
    isFirst,
    isLast,
    next,
    back,
    skip,
    finish,
    restart,
  };
}

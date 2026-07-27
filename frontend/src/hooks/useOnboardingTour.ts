import { useCallback, useEffect, useState } from 'react';
import { ONBOARDING_STORAGE_VERSION, onboardingSteps } from '@/config/onboardingTour';

const RESTART_EVENT = 'kurdlogs-restart-onboarding';

function storageKey(userId: string | undefined): string {
  return `kurdlogs_onboarding_${ONBOARDING_STORAGE_VERSION}_${userId || 'anonymous'}`;
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

  const step = onboardingSteps[stepIndex];
  const total = onboardingSteps.length;
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === total - 1;

  useEffect(() => {
    if (blocked || !userId) return;
    if (!isOnboardingCompleted(userId)) {
      const timer = window.setTimeout(() => setActive(true), 400);
      return () => window.clearTimeout(timer);
    }
  }, [blocked, userId]);

  useEffect(() => {
    const onRestart = () => {
      if (blocked || !userId) return;
      clearOnboardingCompletion(userId);
      setStepIndex(0);
      setActive(true);
    };
    window.addEventListener(RESTART_EVENT, onRestart);
    return () => window.removeEventListener(RESTART_EVENT, onRestart);
  }, [blocked, userId]);

  const finish = useCallback(() => {
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
    setStepIndex((i) => Math.min(i + 1, total - 1));
  }, [finish, isLast, total]);

  const back = useCallback(() => {
    setStepIndex((i) => Math.max(i - 1, 0));
  }, []);

  const restart = useCallback(() => {
    if (!userId) return;
    clearOnboardingCompletion(userId);
    setStepIndex(0);
    setActive(true);
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

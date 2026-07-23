import { useCallback, useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'kurdlogs_pwa_install_dismissed';

export function isPwaInstalled(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function isIosSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|Chrome/.test(ua);
  return isIOS && isSafari;
}

export function isAndroid(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android/i.test(navigator.userAgent);
}

export function isDesktopChromium(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /Chrome|Edg|Chromium/i.test(ua) && !/Mobile|Android|iPhone|iPad/i.test(ua);
}

export function isInstallDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

export function dismissInstallPrompt(): void {
  try {
    localStorage.setItem(DISMISS_KEY, '1');
  } catch {
    /* ignore */
  }
}

export function usePwaInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(isPwaInstalled);
  const [dismissed, setDismissed] = useState(isInstallDismissed);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const onInstalled = () => {
      setInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);

    const mq = window.matchMedia('(display-mode: standalone)');
    const onDisplayChange = () => setInstalled(isPwaInstalled());
    mq.addEventListener('change', onDisplayChange);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
      mq.removeEventListener('change', onDisplayChange);
    };
  }, []);

  const install = useCallback(async () => {
    if (!deferredPrompt) return false;
    setInstalling(true);
    try {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setInstalled(true);
        setDeferredPrompt(null);
        return true;
      }
      return false;
    } finally {
      setInstalling(false);
    }
  }, [deferredPrompt]);

  const dismiss = useCallback(() => {
    dismissInstallPrompt();
    setDismissed(true);
  }, []);

  const canInstall = !!deferredPrompt && !installed && !dismissed;
  const showIosHint = isIosSafari() && !installed && !dismissed;
  const showAndroidHint = isAndroid() && !installed && !dismissed && !canInstall;
  const showDesktopHint = isDesktopChromium() && !installed && !dismissed && !canInstall;
  const showManualHint = (showIosHint || showAndroidHint || showDesktopHint) && !canInstall;
  const showBanner =
    !installed && !dismissed && (canInstall || showManualHint);

  return {
    canInstall,
    showIosHint,
    showAndroidHint,
    showDesktopHint,
    showManualHint,
    showBanner,
    installed,
    installing,
    install,
    dismiss,
  };
}

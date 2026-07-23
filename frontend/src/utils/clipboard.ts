import toast from 'react-hot-toast';

/**
 * Copy text — synchronous legacy path for HTTP (VPS without HTTPS).
 * Must stay sync when called from onClick so execCommand keeps the user gesture.
 */
export function copyToClipboard(text: string, successLabel = 'Copied'): boolean {
  if (!text?.trim()) {
    toast.error('Nothing to copy');
    return false;
  }

  const legacyCopy = (): boolean => {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '0';
      ta.style.left = '0';
      ta.style.width = '1px';
      ta.style.height = '1px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, text.length);
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  };

  // HTTP sites (e.g. http://161.97.123.126:8081) — clipboard API is blocked; legacy only.
  if (!window.isSecureContext) {
    if (legacyCopy()) {
      toast.success(`${successLabel} copied`);
      return true;
    }
    toast.error('Copy failed — click the URL text, then Ctrl+C');
    return false;
  }

  if (legacyCopy()) {
    toast.success(`${successLabel} copied`);
    return true;
  }

  void navigator.clipboard
    .writeText(text)
    .then(() => toast.success(`${successLabel} copied`))
    .catch(() => toast.error('Copy failed — click the URL text, then Ctrl+C'));

  return true;
}

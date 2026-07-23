import { Download, Monitor, Share, Smartphone, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { usePwaInstall } from '../hooks/usePwaInstall';

export default function InstallAppBanner() {
  const {
    showBanner,
    canInstall,
    showIosHint,
    showAndroidHint,
    showDesktopHint,
    installing,
    install,
    dismiss,
  } = usePwaInstall();

  if (!showBanner) return null;

  return (
    <div className="mb-4 rounded-lg border border-[#333] bg-[#111] p-4 flex flex-col sm:flex-row gap-3 sm:items-center">
      <div className="flex items-start gap-3 flex-1 min-w-0">
        <div className="p-2 rounded-md bg-white/10 shrink-0">
          <Smartphone className="w-5 h-5 text-white" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-white">Install KurdLogs on this device</p>
          {canInstall ? (
            <p className="text-xs text-gray-500 mt-0.5">
              Opens like an app from your home screen or taskbar.
            </p>
          ) : showIosHint ? (
            <p className="text-xs text-gray-500 mt-0.5 flex items-start gap-1">
              <Share className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>
                Safari → <strong className="text-gray-300">Share</strong> →{' '}
                <strong className="text-gray-300">Add to Home Screen</strong>
              </span>
            </p>
          ) : showAndroidHint ? (
            <p className="text-xs text-gray-500 mt-0.5">
              Chrome menu (⋮) → <strong className="text-gray-300">Install app</strong> or{' '}
              <strong className="text-gray-300">Add to Home screen</strong>
            </p>
          ) : showDesktopHint ? (
            <p className="text-xs text-gray-500 mt-0.5 flex items-start gap-1">
              <Monitor className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>
                Address bar → install icon, or Chrome menu →{' '}
                <strong className="text-gray-300">Install KurdLogs</strong>
              </span>
            </p>
          ) : (
            <p className="text-xs text-gray-500 mt-0.5">
              See <Link to="/install" className="text-gray-300 underline">Install app</Link> for
              step-by-step help.
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {canInstall && (
          <button
            type="button"
            onClick={() => install()}
            disabled={installing}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md bg-white text-black hover:bg-gray-200 disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            {installing ? 'Installing…' : 'Install'}
          </button>
        )}
        <Link
          to="/install"
          className="px-3 py-2 text-sm text-gray-400 hover:text-white border border-[#333] rounded-md"
        >
          Help
        </Link>
        <button
          type="button"
          onClick={dismiss}
          className="p-2 rounded-md text-gray-500 hover:text-white hover:bg-[#1a1a1a]"
          aria-label="Dismiss install prompt"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

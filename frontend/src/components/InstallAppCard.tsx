import { Download, Monitor, Share, Smartphone } from 'lucide-react';
import { usePwaInstall, isPwaInstalled } from '../hooks/usePwaInstall';

export default function InstallAppCard() {
  const {
    canInstall,
    showIosHint,
    showAndroidHint,
    showDesktopHint,
    installing,
    install,
    installed,
  } = usePwaInstall();
  const alreadyInstalled = installed || isPwaInstalled();

  return (
    <div className="bg-[#111111] border border-[#333333] rounded-lg overflow-hidden">
      <div className="px-6 py-4 border-b border-[#333333] bg-[#1a1a1a]">
        <h3 className="font-medium text-white flex items-center gap-2">
          <Smartphone className="w-4 h-4 text-gray-400" />
          Install app
        </h3>
        <p className="text-xs text-gray-500 mt-1">
          Use KurdLogs like a native app on your phone or computer.
        </p>
      </div>

      <div className="p-6 space-y-4 text-sm text-gray-400">
        {alreadyInstalled ? (
          <p className="text-emerald-400/90">
            KurdLogs is installed and running in app mode on this device.
          </p>
        ) : (
          <>
            {canInstall && (
              <button
                type="button"
                onClick={() => install()}
                disabled={installing}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-white text-black text-sm font-medium rounded-md hover:bg-gray-200 disabled:opacity-50"
              >
                <Download className="w-4 h-4" />
                {installing ? 'Installing…' : 'Install KurdLogs'}
              </button>
            )}

            <div className="space-y-3">
              <div className="flex gap-3">
                <Monitor className="w-4 h-4 shrink-0 text-gray-500 mt-0.5" />
                <div>
                  <p className="text-white font-medium text-sm">Windows / Mac / Linux</p>
                  <p className="text-xs mt-0.5">
                    {showDesktopHint ? (
                      <>
                        Click the <span className="text-gray-300">install icon</span> in the address
                        bar, or Chrome menu → Install KurdLogs.
                      </>
                    ) : (
                      <>
                        Use Chrome or Edge. Click Install above when available, or the install icon
                        in the address bar.
                      </>
                    )}
                  </p>
                </div>
              </div>

              <div className="flex gap-3">
                <Smartphone className="w-4 h-4 shrink-0 text-gray-500 mt-0.5" />
                <div>
                  <p className="text-white font-medium text-sm">Android</p>
                  <p className="text-xs mt-0.5">
                    {showAndroidHint ? (
                      <>
                        Chrome menu (⋮) → <span className="text-gray-300">Install app</span> or{' '}
                        <span className="text-gray-300">Add to Home screen</span>.
                      </>
                    ) : (
                      <>
                        Open this site in <span className="text-gray-300">Chrome</span>, then use
                        Install app from the menu.
                      </>
                    )}
                  </p>
                </div>
              </div>

              <div className="flex gap-3">
                <Share className="w-4 h-4 shrink-0 text-gray-500 mt-0.5" />
                <div>
                  <p className="text-white font-medium text-sm">iPhone / iPad</p>
                  <p className="text-xs mt-0.5">
                    {showIosHint ? (
                      <>
                        Safari → <span className="text-gray-300">Share</span> →{' '}
                        <span className="text-gray-300">Add to Home Screen</span>.
                      </>
                    ) : (
                      <>
                        Open in <span className="text-gray-300">Safari</span> (not Chrome), then Share
                        → Add to Home Screen.
                      </>
                    )}
                  </p>
                </div>
              </div>
            </div>

            <p className="text-xs text-amber-400/80 border border-amber-400/20 rounded-md px-3 py-2 bg-amber-400/5">
              Installing from another device on your network (not localhost) usually requires HTTPS.
              Use your server IP with TLS, or access via localhost on the same machine.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

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
    <div className="overflow-hidden rounded-2xl border border-white/[0.09] bg-[#0c0c0d] shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
      <div className="px-5 sm:px-6 py-4 border-b border-white/[0.07] bg-gradient-to-r from-white/[0.045] to-transparent">
        <h3 className="font-semibold text-white flex items-center gap-3">
          <span className="rounded-xl border border-white/[0.09] bg-white/[0.06] p-2.5">
            <Smartphone className="w-4 h-4 text-emerald-300" />
          </span>
          Install app
        </h3>
        <p className="text-xs text-zinc-500 mt-1 pl-11">
          Use KurdLogs like a native app on your phone or computer.
        </p>
      </div>

      <div className="p-5 sm:p-6 space-y-5 text-sm text-zinc-400">
        {alreadyInstalled ? (
          <p className="rounded-xl border border-emerald-400/15 bg-emerald-400/[0.06] px-4 py-3 text-emerald-200/90">
            KurdLogs is installed and running in app mode on this device.
          </p>
        ) : (
          <>
            {canInstall && (
              <button
                type="button"
                onClick={() => install()}
                disabled={installing}
                className="inline-flex items-center gap-2 px-4 py-3 bg-emerald-300 text-emerald-950 text-sm font-semibold rounded-xl hover:bg-emerald-200 transition-colors disabled:opacity-50 shadow-[0_10px_25px_rgba(74,222,128,.12)]"
              >
                <Download className="w-4 h-4" />
                {installing ? 'Installing…' : 'Install KurdLogs'}
              </button>
            )}

            <div className="space-y-2">
              <div className="flex gap-3 rounded-xl border border-white/[0.06] bg-white/[0.025] p-3">
                <Monitor className="w-4 h-4 shrink-0 text-emerald-300/70 mt-0.5" />
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

              <div className="flex gap-3 rounded-xl border border-white/[0.06] bg-white/[0.025] p-3">
                <Smartphone className="w-4 h-4 shrink-0 text-emerald-300/70 mt-0.5" />
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

              <div className="flex gap-3 rounded-xl border border-white/[0.06] bg-white/[0.025] p-3">
                <Share className="w-4 h-4 shrink-0 text-emerald-300/70 mt-0.5" />
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

            <p className="text-xs text-amber-200/80 border border-amber-400/20 rounded-xl px-3.5 py-3 bg-amber-400/[0.06] leading-relaxed">
              Installing from another device on your network (not localhost) usually requires HTTPS.
              Use your server IP with TLS, or access via localhost on the same machine.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './index.css';

let reloadingForServiceWorker = false;
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    // Apply a fresh production bundle as soon as Workbox detects it. This is
    // important for stream controls: an older cached UI must not keep sending
    // a stale graphics workflow after a dashboard deployment.
    updateSW(true);
  },
  onOfflineReady() {
    console.info('KurdLogs is ready for offline use.');
  },
  onRegistered(registration) {
    registration?.update().catch(() => {});
    if (registration) {
      console.info('KurdLogs service worker registered.');
    }
  },
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadingForServiceWorker) return;
    reloadingForServiceWorker = true;
    window.location.reload();
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
      <Toaster
        position="top-right"
        toastOptions={{
          className: '!bg-popover !text-popover-foreground !border-border',
        }}
      />
    </BrowserRouter>
  </React.StrictMode>
);

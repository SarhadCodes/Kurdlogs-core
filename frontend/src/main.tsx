import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './index.css';

registerSW({
  immediate: true,
  onOfflineReady() {
    console.info('KurdLogs is ready for offline use.');
  },
  onRegistered(registration) {
    if (registration) {
      console.info('KurdLogs service worker registered.');
    }
  },
});

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

/* ------------------------------------------------------------
   pwa.js — installability and offline shell.

   • Captures the browser's beforeinstallprompt so we can show
     our own Install button only when the platform allows it.
   • Registers the service worker that caches the app shell so
     the reader reopens offline after the first successful load.
   ------------------------------------------------------------ */

export function setupPwa({ installBtn, onInstallable, toast }) {
  let deferredPrompt = null;

  // Hide the install affordance when already running standalone.
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (!standalone) onInstallable?.(true);
  });

  installBtn?.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    try {
      await deferredPrompt.userChoice;
    } catch { /* ignore */ }
    deferredPrompt = null;
    onInstallable?.(false);
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    onInstallable?.(false);
    toast?.('Installed — find Pocket PDF on your home screen');
  });

  // Register the service worker (only over https / localhost).
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {
        /* offline shell simply won't be available */
      });
    });
  }
}

// Welcome page shown once on install. Fires the session/activation signal and
// wires the shortcut-help button. Analytics must never block onboarding.
try {
    // sendMessage rejects asynchronously when no receiver is live, so try/catch alone misses it.
    chrome.runtime.sendMessage({ type: 'ANALYTICS_TRACK_EVENT', eventName: 'welcome_page_opened', params: { source: 'welcome_page' } })
        ?.catch(() => {});
} catch {
    // ignore — the page still works without analytics
}

// Show the Mac command symbol where the default shortcut uses it.
const isMac = (navigator.platform || '').toLowerCase().includes('mac')
    || (navigator.userAgent || '').toLowerCase().includes('mac');
if (isMac) {
    document.querySelectorAll('.js-mod').forEach((el) => { el.textContent = '⌘'; });
}

const openShortcuts = document.getElementById('open-shortcuts');
if (openShortcuts) {
    openShortcuts.addEventListener('click', () => {
        chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
    });
}

// "Got it" closes the onboarding tab so the user goes straight to using the app.
const gotIt = document.getElementById('got-it');
if (gotIt) {
    gotIt.addEventListener('click', () => {
        chrome.tabs.getCurrent((tab) => {
            if (tab && tab.id != null) chrome.tabs.remove(tab.id);
        });
    });
}


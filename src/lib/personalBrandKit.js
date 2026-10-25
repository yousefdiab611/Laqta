(function () {
    'use strict';

    async function applyPersonalBrandKit() {
        const stored = await chrome.storage.local.get(['brandKit', 'fs-personal-brand-v1']);
        if (stored['fs-personal-brand-v1']) return;
        const brandKit = {
            position: 'bottom-right',
            size: 12,
            opacity: 0.85,
            ...stored.brandKit,
            enabled: true,
            logoDataUrl: '',
            text: 'Yousef Diab | Dokkan Agency',
        };
        await chrome.storage.local.set({ brandKit, 'fs-personal-brand-v1': true });
    }

    self.fsPersonalBrandKitReady = applyPersonalBrandKit();
    self.fsPersonalBrandKitReady.catch((error) => console.error('Could not save personal Brand Kit:', error));
}());

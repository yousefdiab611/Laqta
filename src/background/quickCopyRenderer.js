(function () {
    const quickBg = self.fsBackgroundShared;
    const quickSelectionApi = self.fsSelectionOverlay;
    const quickAnalytics = self.fsAnalytics;

    // ─── Quick copy rendering (OffscreenCanvas, runs in service worker) ────────────

    const quickCopyCropAndRenderToDataUrl = self.fsQuickCopyCanvas.cropAndRenderToDataUrl;
    const quickCopyWriteImageToClipboardViaTab = self.fsQuickCopyCanvas.writeImageToClipboardViaTab;

    function showBadgeFeedback(tabId) {
        if (typeof chrome.action === 'undefined') return;
        chrome.action.setBadgeText({ text: '✓', tabId });
        chrome.action.setBadgeBackgroundColor({ color: '#ffbf00', tabId });
        setTimeout(() => {
            chrome.action.setBadgeText({ text: '', tabId });
        }, 2000);
    }

    /** Brief in-page toast; uses same scripting access as clipboard write. Fails silently on restricted tabs. */
    function showInPageToast(tabId, text) {
        if (!Number.isInteger(tabId)) return;
        chrome.scripting.executeScript({
            target: { tabId },
            func: (message) => {
                const id = 'framedshot-quickcopy-toast';
                const existing = document.getElementById(id);
                if (existing) existing.remove();
                const el = document.createElement('div');
                el.id = id;
                el.textContent = message;
                el.setAttribute('role', 'status');
                el.setAttribute('aria-live', 'polite');
                Object.assign(el.style, {
                    position: 'fixed',
                    top: '24px',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    zIndex: '2147483646',
                    padding: '11px 16px',
                    borderRadius: '10px',
                    background: 'linear-gradient(135deg, #ffbf00, #ffe2ab)',
                    color: '#402d00',
                    font: '600 13px/1.2 system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
                    boxShadow: '0 14px 38px rgba(0,0,0,0.30), 0 0 24px rgba(255,191,0,0.24)',
                    border: '1px solid rgba(64,45,0,0.18)',
                    pointerEvents: 'none',
                    maxWidth: '90vw',
                    textAlign: 'center',
                    backdropFilter: 'blur(10px)'
                });
                document.documentElement.appendChild(el);
                setTimeout(() => {
                    el.style.opacity = '0';
                    el.style.transition = 'opacity 0.25s ease';
                    setTimeout(() => el.remove(), 280);
                }, 3200);
            },
            args: [text]
        }).catch(() => {});
    }

    function notifyQuickCopySuccess(tabId) {
        showBadgeFeedback(tabId);
        showInPageToast(tabId, 'Copied to clipboard');
    }

    function notifyRecordingStarted() {
        if (typeof chrome.action === 'undefined') return;
        chrome.action.setBadgeText({ text: 'REC' });
        chrome.action.setBadgeBackgroundColor({ color: '#ffbf00' });
        chrome.action.setTitle({ title: 'Recording tab. Open لقطة — Laqta again to stop.' });
    }

    function notifyRecordingStopped() {
        if (typeof chrome.action === 'undefined') return;
        chrome.action.setBadgeText({ text: '' });
        chrome.action.setTitle({ title: 'لقطة — Laqta' });
    }

    function getQuickCopyModeEnabled() {
        return new Promise((resolve) => {
            chrome.storage.local.get(['quickCopyMode'], (result) => {
                resolve(!!(result && result.quickCopyMode));
            });
        });
    }

    async function captureTabAndCopyToClipboard(tab) {
        if (!tab || !Number.isInteger(tab.windowId) || !Number.isInteger(tab.id)) return;
        quickAnalytics?.trackEvent('quick_copy_used', { source: 'background' }).catch(() => {});
        quickAnalytics?.trackEvent('quick_capture_started', { source: 'background' }).catch(() => {});
        quickAnalytics?.trackEvent('capture_started', { capture_type: 'quick_copy', source: 'background' }).catch(() => {});
        try {
            const data = await quickBg.captureTabForClipboard(tab.windowId);
            const dataUrl = await quickCopyCropAndRenderToDataUrl(data.screenshotDataUrl, null, data.settings);
            await quickCopyWriteImageToClipboardViaTab(tab.id, dataUrl);
            notifyQuickCopySuccess(tab.id);
            quickAnalytics?.trackEvent('quick_capture_completed', { source: 'background', result: 'success' }).catch(() => {});
            quickAnalytics?.trackEvent('quick_copy_success', { source: 'background', result: 'success' }).catch(() => {});
            quickAnalytics?.trackEvent('capture_completed', { capture_type: 'quick_copy', source: 'background', result: 'success' }).catch(() => {});
        } catch (error) {
            console.error('Quick copy tab capture failed:', error);
            quickAnalytics?.trackEvent('quick_capture_failed', { source: 'background', error_type: 'unknown', result: 'failure' }).catch(() => {});
            quickAnalytics?.trackEvent('quick_copy_failed', { source: 'background', error_type: 'unknown', result: 'failure' }).catch(() => {});
            quickAnalytics?.trackEvent('capture_failed', { capture_type: 'quick_copy', source: 'background', error_type: 'unknown', result: 'failure' }).catch(() => {});
        }
    }

    async function captureSelectionAndCopyToClipboard(tab) {
        const getSettings = () => new Promise((resolve) => {
            chrome.storage.local.get(['savedState'], (result) => resolve((result && result.savedState) || null));
        });

        if (!quickSelectionApi.isScriptableTab(tab)) {
            try {
                const screenshot = await quickBg.captureVisibleTab(tab.windowId);
                const settings = await getSettings();
                const dataUrl = await quickCopyCropAndRenderToDataUrl(screenshot, null, settings);
                await quickCopyWriteImageToClipboardViaTab(tab.id, dataUrl);
                notifyQuickCopySuccess(tab.id);
                quickAnalytics?.trackEvent('quick_capture_completed', { source: 'area_fallback', result: 'success' }).catch(() => {});
                quickAnalytics?.trackEvent('quick_copy_success', { source: 'area_fallback', result: 'success' }).catch(() => {});
            } catch (error) {
                console.error('Quick copy fallback failed:', error);
                quickAnalytics?.trackEvent('quick_capture_failed', { source: 'area_fallback', error_type: 'unknown', result: 'failure' }).catch(() => {});
                quickAnalytics?.trackEvent('quick_copy_failed', { source: 'area_fallback', error_type: 'unknown', result: 'failure' }).catch(() => {});
            }
            return;
        }

        try {
            quickAnalytics?.trackEvent('area_selection_started', { source: 'quick_copy' }).catch(() => {});
            const selection = await quickSelectionApi.requestAreaSelection(tab.id);
            if (!selection) {
                quickAnalytics?.trackEvent('area_selection_cancelled', { source: 'quick_copy' }).catch(() => {});
                return;
            }
            quickAnalytics?.trackEvent('area_selection_completed', { source: 'quick_copy', result: 'success' }).catch(() => {});
            const screenshot = await quickBg.captureVisibleTab(tab.windowId);
            const settings = await getSettings();
            const dataUrl = await quickCopyCropAndRenderToDataUrl(screenshot, selection, settings);
            await quickCopyWriteImageToClipboardViaTab(tab.id, dataUrl);
            notifyQuickCopySuccess(tab.id);
            quickAnalytics?.trackEvent('quick_capture_completed', { source: 'quick_copy_selection', result: 'success' }).catch(() => {});
            quickAnalytics?.trackEvent('quick_copy_success', { source: 'quick_copy_selection', result: 'success' }).catch(() => {});
        } catch (error) {
            console.error('Quick copy selection failed:', error);
            quickAnalytics?.trackEvent('quick_capture_failed', { source: 'quick_copy_selection', error_type: 'unknown', result: 'failure' }).catch(() => {});
            quickAnalytics?.trackEvent('quick_copy_failed', { source: 'quick_copy_selection', error_type: 'unknown', result: 'failure' }).catch(() => {});
        }
    }

    self.fsQuickCopy = {
        captureSelectionAndCopyToClipboard,
        captureTabAndCopyToClipboard,
        getQuickCopyModeEnabled,
        notifyRecordingStarted,
        notifyRecordingStopped,
        notifyQuickCopySuccess
    };
}());

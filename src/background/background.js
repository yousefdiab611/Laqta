/* global importScripts */
importScripts('../lib/personalBrandKit.js', '../lib/captureHistory.js', 'brandRenderer.js', 'backgroundShared.js', 'selectionOverlay.js', 'analyticsShared.js', 'analyticsMetrics.js', 'analyticsService.js', 'quickCopyCanvas.js', 'quickCopyRenderer.js', 'recordingController.js', 'captureFlows.js', 'captureSession.js', 'fullPageStitcher.js', 'fullPageCapture.js', 'privacyCapture.js');

chrome.runtime.setUninstallURL('https://framed-shot.com/uninstall/');

const bg = self.fsBackgroundShared;
const analytics = self.fsAnalytics;
const quickCopy = self.fsQuickCopy;
const recordingController = self.fsRecordingController;
const captureFlows = self.fsCaptureFlows;
const captureSession = self.fsCaptureSession;
const fullPage = self.fsFullPageCapture;
const privacyCapture = self.fsPrivacyCapture;
function trackEvent(name, params) { analytics?.trackEvent(name, params).catch(() => {}); }

chrome.action.onClicked.addListener((tab) => {
    bg.captureVisibleAndOpenEditor(tab);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !message.type) return undefined;

    if (message.type === 'ANALYTICS_TRACK_EVENT' || message.type === 'analytics.track') {
        trackEvent(message.eventName, message.params || {});
        sendResponse({ ok: true });
        return undefined;
    }

    if (message.type === 'POPUP_CAPTURE_TAB') {
        trackEvent('screenshot_tab_clicked', { source: 'popup' });
        trackEvent('capture_started', { capture_type: 'visible_tab', source: 'popup' });
        bg.getActiveTab().then((tab) => {
            if (tab) {
                bg.captureVisibleAndOpenEditor(tab).then(() => {
                    trackEvent('capture_completed', { capture_type: 'visible_tab', result: 'success' });
                }).catch(() => {
                    trackEvent('capture_failed', { capture_type: 'visible_tab', error_type: 'unknown', result: 'failure' });
                });
            }
            sendResponse({ ok: true });
        }).catch(() => sendResponse({ ok: false }));
        return true;
    }

    if (message.type === 'POPUP_CAPTURE_SCREEN' || message.type === 'POPUP_COPY_SCREEN') {
        const outputQuery = message.type === 'POPUP_COPY_SCREEN' ? '?output=copy' : '';
        chrome.windows.create({
            url: chrome.runtime.getURL(`screen-capture/index.html${outputQuery}`),
            type: 'popup',
            width: 480,
            height: 600,
            focused: true
        }, (captureWindow) => {
            if (chrome.runtime.lastError || !captureWindow) {
                sendResponse({
                    ok: false,
                    error: chrome.runtime.lastError?.message || 'Could not open screen capture.'
                });
                return;
            }
            sendResponse({ ok: true });
        });
        return true;
    }

    if (message.type === 'POPUP_CAPTURE_TAB_QUICK_COPY') {
        trackEvent('quick_copy_used', { source: 'popup' });
        trackEvent('quick_capture_started', { source: 'popup' });
        bg.getActiveTab().then(async (tab) => {
            if (!tab) { sendResponse({ ok: false }); return; }
            const data = await bg.captureTabForClipboard(tab.windowId);
            sendResponse({ ok: true, screenshotDataUrl: data.screenshotDataUrl, settings: data.settings });
        }).catch(() => sendResponse({ ok: false }));
        return true;
    }

    if (message.type === 'POPUP_CAPTURE_SELECTION') {
        trackEvent('select_area_clicked', { source: 'popup' });
        bg.getActiveTab().then((tab) => {
            if (tab) captureFlows.captureSelectionAndOpenEditor(tab);
            sendResponse({ ok: true });
        }).catch(() => sendResponse({ ok: false }));
        return true;
    }

    if (message.type === 'POPUP_CAPTURE_PRIVATE') {
        trackEvent('capture_started', { capture_type: 'privacy', source: 'popup' });
        bg.getActiveTab().then(async (tab) => {
            if (!tab) throw new Error('No active tab.');
            const capture = await privacyCapture.capturePrivateTab(tab);
            trackEvent('capture_completed', { capture_type: 'privacy', source: 'popup', result: 'success' });
            sendResponse({ ok: true, hiddenCount: capture.hiddenCount });
        }).catch((error) => {
            trackEvent('capture_failed', { capture_type: 'privacy', source: 'popup', error_type: error?.message || 'unknown', result: 'failure' });
            sendResponse({ ok: false, error: error?.message || 'Private capture failed.' });
        });
        return true;
    }

    if (message.type === 'POPUP_CAPTURE_SELECTION_QUICK_COPY') {
        trackEvent('select_area_clicked', { source: 'popup' });
        trackEvent('quick_copy_used', { source: 'popup' });
        bg.getActiveTab().then((tab) => {
            if (tab) quickCopy.captureSelectionAndCopyToClipboard(tab);
            sendResponse({ ok: true });
        }).catch(() => sendResponse({ ok: false }));
        return true;
    }

    if (message.type === 'POPUP_CAPTURE_FULLPAGE') {
        trackEvent('capture_started', { capture_type: 'full_page', source: 'popup' });
        bg.getActiveTab().then((tab) => {
            if (tab) {
                fullPage.captureFullPageAndOpenEditor(tab).then((info) => {
                    trackEvent('capture_completed', { capture_type: 'full_page', source: 'popup', result: 'success', mode: info?.fallback ? 'fallback' : 'full_page', frame_count: info?.frameCount });
                }).catch((error) => {
                    trackEvent('capture_failed', { capture_type: 'full_page', source: 'popup', error_type: error?.message || 'unknown', result: 'failure' });
                });
            }
            sendResponse({ ok: true });
        }).catch(() => sendResponse({ ok: false }));
        return true;
    }

    if (message.type === 'POPUP_OPEN_WITH_IMAGE') {
        trackEvent('upload_started', { source: 'popup' });
        if (typeof message.dataUrl === 'string' && message.dataUrl.startsWith('data:image/')) {
            bg.openEditorWithScreenshot(message.dataUrl)
                .then(() => {
                    trackEvent('upload_completed', { file_type: message.fileType || 'unknown', result: 'success' });
                    sendResponse({ ok: true });
                })
                .catch(() => {
                    trackEvent('upload_failed', { file_type: message.fileType || 'unknown', error_type: 'unknown', result: 'failure' });
                    sendResponse({ ok: false });
                });
        } else {
            trackEvent('upload_failed', { file_type: 'unknown', error_type: 'validation', result: 'failure' });
            sendResponse({ ok: false });
        }
        return true;
    }

    if (message.type === 'POPUP_OPEN_COLLAGE') {
        const source = message.source === 'capture_session' ? 'capture_session' : 'popup';
        trackEvent('create_collage_clicked', { source });
        trackEvent('collage_started', { source });
        if (!Array.isArray(message.dataUrls) || message.dataUrls.length === 0) {
            sendResponse({ ok: false });
            return true;
        }
        bg.openCollageWithImages(message.dataUrls)
            .then(() => sendResponse({ ok: true }))
            .catch(() => sendResponse({ ok: false }));
        return true;
    }

    if (message.type === 'POPUP_CAPTURE_STEP') {
        trackEvent('capture_started', { capture_type: 'session_step', source: 'popup' });
        bg.getActiveTab().then(async (tab) => {
            if (!tab || typeof tab.windowId !== 'number') {
                trackEvent('capture_failed', { capture_type: 'session_step', source: 'popup', error_type: 'not_found', result: 'failure' });
                sendResponse({ ok: false, error: 'No active tab to capture.' });
                return;
            }
            try {
                const existing = await captureSession.readCaptureSession() || { active: true, dataUrls: [] };
                const frameCount = Array.isArray(existing.dataUrls) ? existing.dataUrls.length : 0;
                if (frameCount >= captureSession.CAPTURE_SESSION_MAX_FRAMES) {
                    trackEvent('capture_session_max_frames_reached', { source: 'popup', frame_count: frameCount });
                    sendResponse({ ok: false, error: `Maximum of ${captureSession.CAPTURE_SESSION_MAX_FRAMES} frames reached.` });
                    return;
                }
                const result = await captureFlows.captureSelectionForSession(tab);
                if (result.cancelled) {
                    trackEvent('capture_failed', { capture_type: 'session_step', source: 'popup', error_type: 'unknown', result: 'failure' });
                    sendResponse({ ok: true, cancelled: true, frameCount });
                    return;
                }
                const count = await captureSession.appendCaptureToSession(existing, result.dataUrl);
                trackEvent('capture_completed', { capture_type: 'session_step', source: 'popup', frame_index: count, result: 'success' });
                if (result.fallback) {
                    trackEvent('capture_completed', { capture_type: 'visible_tab', source: 'session_fallback', result: 'success' });
                }
                sendResponse({ ok: true, cancelled: false, frameCount: count, fallback: !!result.fallback });
            } catch (error) {
                const reason = error && error.message ? error.message : 'Capture failed.';
                trackEvent('capture_failed', { capture_type: 'session_step', source: 'popup', error_type: 'unknown', result: 'failure' });
                sendResponse({ ok: false, error: reason });
            }
        }).catch(() => sendResponse({ ok: false, error: 'No active tab.' }));
        return true;
    }

    if (message.type === 'GET_PENDING_BATCH') {
        bg.readPendingBatch(message.token)
            .then((dataUrls) => sendResponse({ ok: true, dataUrls }))
            .catch(() => sendResponse({ ok: true, dataUrls: null }));
        return true;
    }

    if (message.type === 'GET_PENDING_SCREENSHOT') {
        sendResponse({ ok: true, screenshot: bg.readPendingCapture(message.token) });
        return undefined;
    }

    if (message.type === 'OPEN_HISTORY_CAPTURE') {
        if (typeof message.dataUrl !== 'string' || !message.dataUrl.startsWith('data:image/')) {
            sendResponse({ ok: false, error: 'Invalid history image.' });
            return true;
        }
        bg.openEditorWithScreenshot(message.dataUrl, { skipHistory: true, skipBrand: true })
            .then(() => sendResponse({ ok: true }))
            .catch((error) => sendResponse({ ok: false, error: error?.message || 'Could not open image.' }));
        return true;
    }

    if (message.type === 'APPLY_BRAND_KIT') {
        self.fsBrandRenderer.applyBrandKit(message.dataUrl)
            .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
            .catch((error) => sendResponse({ ok: false, error: error?.message || 'Brand Kit failed.' }));
        return true;
    }

    if (message.type === 'CONSUME_PENDING_SCREENSHOT') {
        bg.consumePendingScreenshot(message.token)
            .then(() => sendResponse({ ok: true }))
            .catch((error) => {
                sendResponse({
                    ok: false,
                    error: error && error.message ? error.message : 'Failed to consume pending screenshot.'
                });
            });
        return true;
    }

    if (message.type === 'SHOW_QUICK_COPY_TOAST') {
        bg.getActiveTab().then((tab) => {
            if (tab && Number.isInteger(tab.id)) quickCopy.notifyQuickCopySuccess(tab.id);
            sendResponse({ ok: true });
        }).catch(() => sendResponse({ ok: false }));
        return true;
    }

    if (message.type === 'RECORDING_START') {
        trackEvent('record_tab_clicked', { source: 'popup' });
        recordingController.startRecording(message)
            .then((response) => {
                if (response.ok) {
                    quickCopy.notifyRecordingStarted();
                    trackEvent('tab_recording_started', { source: 'popup', result: 'success' });
                } else {
                    trackEvent('tab_recording_started', { source: 'popup', result: 'failure', error_type: 'unknown' });
                }
                sendResponse(response);
            })
            .catch((error) => sendResponse({ ok: false, error: error.message || 'Failed to start recording.' }));
        return true;
    }

    if (message.type === 'RECORDING_STOP') {
        recordingController.stopRecording(message.recordingId)
            .then((response) => {
                quickCopy.notifyRecordingStopped();
                trackEvent('tab_recording_stopped', { result: response.ok ? 'success' : 'failure' });
                sendResponse(response);
            })
            .catch((error) => sendResponse({ ok: false, error: error.message || 'Failed to stop recording.' }));
        return true;
    }

    if (message.type === 'RECORDING_STATUS') {
        recordingController.getRecordingStatus()
            .then((response) => sendResponse(response))
            .catch(() => sendResponse({ ok: true, recording: null }));
        return true;
    }

    if (message.type === 'RECORDING_ENDED') {
        quickCopy.notifyRecordingStopped();
        if (message.recordingId) recordingController.openRecordingEditor(message.recordingId).catch(() => {});
        // Native "Stop sharing" ends the recording without the popup/command stop path, so the
        // offscreen document is never torn down here. Recording is already finalized (active is
        // null) by the time this fires, so closing the idle doc is safe and avoids the leak.
        recordingController.closeOffscreenIfIdle().catch(() => {});
        sendResponse({ ok: true });
        return true;
    }

    if (message.type !== 'OPEN_SHORTCUTS_PAGE') return undefined;

    try {
        chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }, () => {
            if (chrome.runtime.lastError) {
                sendResponse({ ok: false, error: chrome.runtime.lastError.message });
                return;
            }
            sendResponse({ ok: true });
        });
    } catch (error) {
        sendResponse({
            ok: false,
            error: error && error.message ? error.message : 'Failed to open shortcuts page.'
        });
    }

    return true;
});

chrome.commands.onCommand.addListener(async (command) => {
    if (command === 'capture-tab') {
        const tab = await bg.getActiveTab();
        if (!tab) return;
        const quick = await quickCopy.getQuickCopyModeEnabled();
        if (quick) {
            trackEvent('quick_copy_used', { source: 'keyboard_shortcut' });
            await quickCopy.captureTabAndCopyToClipboard(tab);
        } else {
            trackEvent('capture_started', { capture_type: 'visible_tab', source: 'keyboard_shortcut' });
            bg.captureVisibleAndOpenEditor(tab).then(() => {
                trackEvent('capture_completed', { capture_type: 'visible_tab', source: 'keyboard_shortcut', result: 'success' });
            }).catch(() => {
                trackEvent('capture_failed', { capture_type: 'visible_tab', source: 'keyboard_shortcut', error_type: 'unknown', result: 'failure' });
            });
        }
        return;
    }

    if (command === bg.COMMAND_CAPTURE_SELECTION) {
        const tab = await bg.getActiveTab();
        if (!tab) return;
        const quick = await quickCopy.getQuickCopyModeEnabled();
        if (quick) await quickCopy.captureSelectionAndCopyToClipboard(tab);
        else captureFlows.captureSelectionAndOpenEditor(tab);
        return;
    }

    if (command === 'capture-fullpage') {
        const tab = await bg.getActiveTab();
        if (!tab) return;
        trackEvent('full_page_clicked', { source: 'keyboard_shortcut' });
        trackEvent('capture_started', { capture_type: 'full_page', source: 'keyboard_shortcut' });
        fullPage.captureFullPageAndOpenEditor(tab).then((info) => {
            trackEvent('capture_completed', { capture_type: 'full_page', source: 'keyboard_shortcut', result: 'success', mode: info?.fallback ? 'fallback' : 'full_page', frame_count: info?.frameCount });
        }).catch((error) => {
            trackEvent('capture_failed', { capture_type: 'full_page', source: 'keyboard_shortcut', error_type: error?.message || 'unknown', result: 'failure' });
        });
        return;
    }

    if (command === 'record-tab') {
        await captureFlows.toggleTabRecordingFromCommand().catch((error) => {
            console.error('Record tab command failed:', error);
        });
        return;
    }

    // Dedicated session shortcut. Only acts when a Capture Steps session is active —
    // outside a session it is a no-op so the binding can't accidentally open an editor.
    if (command === 'capture-session-step') {
        const session = await captureSession.readCaptureSession();
        if (!session || !session.active) return;
        const tab = await bg.getActiveTab();
        if (!tab) return;
        const frameCount = Array.isArray(session.dataUrls) ? session.dataUrls.length : 0;
        if (frameCount >= captureSession.CAPTURE_SESSION_MAX_FRAMES) {
            trackEvent('capture_session_max_frames_reached', { source: 'keyboard_shortcut', frame_count: frameCount });
            return;
        }
        trackEvent('capture_started', { capture_type: 'session_step', source: 'keyboard_shortcut' });
        try {
            const result = await captureFlows.captureSelectionForSession(tab);
            if (result.cancelled) {
                trackEvent('capture_failed', { capture_type: 'session_step', source: 'keyboard_shortcut', error_type: 'unknown', result: 'failure' });
                return;
            }
            const count = await captureSession.appendCaptureToSession(session, result.dataUrl);
            trackEvent('capture_completed', { capture_type: 'session_step', source: 'keyboard_shortcut', frame_index: count, result: 'success' });
        } catch {
            trackEvent('capture_failed', { capture_type: 'session_step', source: 'keyboard_shortcut', error_type: 'unknown', result: 'failure' });
        }
    }
});

chrome.runtime.onInstalled.addListener((details) => {
    chrome.runtime.setUninstallURL('https://framed-shot.com/uninstall/');
    if (details.reason === 'install') {
        trackEvent('extension_installed', { source: 'runtime_on_installed' });
        chrome.storage.local.get(['ratingPrompt'], (result) => {
            const existing = result.ratingPrompt || {};
            if (!existing.installDate) {
                chrome.storage.local.set({ ratingPrompt: { ...existing, installDate: Date.now() } });
            }
        });
        // Tracked from here because this path provably reaches analytics; a gap against
        // source:'welcome_page' isolates whether the tab or the page-side relay is failing.
        chrome.tabs.create({ url: chrome.runtime.getURL('welcome/index.html') })
            .then(() => trackEvent('welcome_page_opened', { source: 'runtime_on_installed' }))
            .catch(() => {});
    } else if (details.reason === 'update') {
        trackEvent('extension_updated', { source: 'runtime_on_installed' });
    }
});

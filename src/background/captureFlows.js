(function () {
    const bg = self.fsBackgroundShared;
    const selectionApi = self.fsSelectionOverlay;
    const quickCopy = self.fsQuickCopy;
    const recordingController = self.fsRecordingController;
    const analytics = self.fsAnalytics;
    const trackEvent = (name, params) => analytics?.trackEvent(name, params).catch(() => {});

    // Show area-selection overlay, capture visible tab, crop to selection, return cropped data URL.
    // Used by the multi-step capture session. Falls back to full-tab capture on non-scriptable pages
    // (chrome://, etc.) so the session never silently fails on Chrome's internal pages.
    async function captureSelectionForSession(tab) {
        if (!tab || !Number.isInteger(tab.windowId) || !Number.isInteger(tab.id)) {
            throw new Error('No active tab available.');
        }
        if (!selectionApi.isScriptableTab(tab)) {
            const screenshot = await bg.captureVisibleTab(tab.windowId);
            return { dataUrl: screenshot, fallback: true, cancelled: false };
        }
        trackEvent('area_selection_started', { source: 'capture_session' });
        const selection = await selectionApi.requestAreaSelection(tab.id);
        if (!selection) {
            trackEvent('area_selection_cancelled', { source: 'capture_session' });
            return { dataUrl: null, fallback: false, cancelled: true };
        }
        trackEvent('area_selection_completed', { source: 'capture_session', result: 'success' });
        const screenshot = await bg.captureVisibleTab(tab.windowId);
        const cropped = await bg.cropScreenshotToSelection(screenshot, selection);
        return { dataUrl: cropped, fallback: false, cancelled: false };
    }

    async function captureSelectionAndOpenEditor(tab) {
        if (!tab || !Number.isInteger(tab.windowId) || !Number.isInteger(tab.id)) return;
        trackEvent('capture_started', { capture_type: 'selected_area', source: 'background' });
        trackEvent('area_selection_started', { source: 'background' });
        if (!selectionApi.isScriptableTab(tab)) {
            try {
                const screenshot = await bg.captureVisibleTab(tab.windowId);
                await bg.openEditorWithScreenshot(screenshot, { notice: 'area-fallback' });
                trackEvent('capture_completed', { capture_type: 'visible_tab', source: 'area_fallback', result: 'success' });
                trackEvent('area_selection_cancelled', { source: 'non_scriptable' });
            } catch (error) {
                console.error('Fallback capture failed:', error);
                trackEvent('capture_failed', { capture_type: 'selected_area', error_type: 'unknown', result: 'failure' });
            }
            return;
        }
        try {
            const selection = await selectionApi.requestAreaSelection(tab.id);
            if (!selection) {
                trackEvent('area_selection_cancelled', { source: 'user_cancelled' });
                return;
            }
            trackEvent('area_selection_completed', { result: 'success' });
            const screenshot = await bg.captureVisibleTab(tab.windowId);
            await bg.openEditorWithScreenshot({ screenshot, selection });
            trackEvent('capture_completed', { capture_type: 'selected_area', result: 'success' });
        } catch (error) {
            console.error('Selection capture failed:', error);
            trackEvent('capture_failed', { capture_type: 'selected_area', error_type: 'unknown', result: 'failure' });
        }
    }

    async function toggleTabRecordingFromCommand() {
        const status = await recordingController.getRecordingStatus().catch(() => ({ ok: true, recording: null }));
        if (status && status.recording && status.recording.recordingId) {
            const response = await recordingController.stopRecording(status.recording.recordingId);
            if (response.ok) quickCopy.notifyRecordingStopped();
            return;
        }
        const tab = await bg.getActiveTab();
        if (!tab || !Number.isInteger(tab.id)) return;
        const response = await recordingController.startRecording({ tabId: tab.id, title: tab.title || 'لقطة — Laqta recording' });
        if (response.ok) {
            quickCopy.notifyRecordingStarted();
            trackEvent('tab_recording_started', { source: 'keyboard_shortcut', result: 'success' });
        }
    }

    self.fsCaptureFlows = { captureSelectionAndOpenEditor, captureSelectionForSession, toggleTabRecordingFromCommand };
}());

let _editorSession = null;

function createEditorSession(openedAt = Date.now()) {
    return {
        openedAt,
        ended: false,
        any_export_attempted: false,
        any_copy_attempted: false,
        any_drag_started: false,
        any_context_menu_opened: false,
    };
}

function markEditorExtractionSignal(eventName) {
    if (!_editorSession || _editorSession.ended) return;
    if (eventName === 'export_started' || eventName === 'export_completed' || eventName === 'export_failed'
        || eventName === 'batch_export_zip_started' || eventName === 'batch_export_zip_completed' || eventName === 'batch_export_zip_failed'
        || eventName === 'collage_exported') {
        _editorSession.any_export_attempted = true;
    }
    if (eventName === 'copy_to_clipboard_started' || eventName === 'copy_to_clipboard_completed' || eventName === 'copy_to_clipboard_failed') {
        _editorSession.any_copy_attempted = true;
    }
    if (eventName === 'output_drag_started') _editorSession.any_drag_started = true;
    if (eventName === 'output_context_menu_opened') _editorSession.any_context_menu_opened = true;
}

function sendAnalyticsMessage(payload) {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;
    try {
        chrome.runtime.sendMessage(payload, () => {
            void chrome.runtime.lastError;
        });
    } catch {
        // Analytics must never affect product behavior.
    }
}

export function trackEvent(eventName, params = {}) {
    if (!eventName || typeof eventName !== 'string') return;
    markEditorExtractionSignal(eventName);
    sendAnalyticsMessage({ type: 'ANALYTICS_TRACK_EVENT', eventName, params });
}

export function trackEditorOpened(params = {}) {
    _editorSession = createEditorSession();
    trackEvent('editor_opened', params);
}

export function trackVideoEditorOpened(params = {}) {
    trackEvent('video_editor_opened', params);
}

export function trackExportStarted(format, params = {}) {
    trackEvent('export_started', { format, ...params });
}

export function trackExportCompleted(format, params = {}) {
    trackEvent('export_completed', { format, result: 'success', ...params });
}

export function trackExportFailed(format, errorType = 'unknown', params = {}) {
    trackEvent('export_failed', { format, error_type: errorType, result: 'failure', ...params });
}

export function trackClipboardStarted(params = {}) {
    trackEvent('copy_to_clipboard_started', params);
}

export function trackClipboardCompleted(params = {}) {
    trackEvent('copy_to_clipboard_completed', { result: 'success', ...params });
}

export function trackClipboardFailed(errorType = 'unknown', params = {}) {
    trackEvent('copy_to_clipboard_failed', { error_type: errorType, result: 'failure', ...params });
}

export function trackEditorClosed(params = {}) {
    if (_editorSession && !_editorSession.ended) {
        const endedAt = Date.now();
        const durationMs = Math.max(0, endedAt - _editorSession.openedAt);
        const sessionParams = {
            duration_ms: durationMs,
            any_export_attempted: _editorSession.any_export_attempted,
            any_copy_attempted: _editorSession.any_copy_attempted,
            any_drag_started: _editorSession.any_drag_started,
            any_context_menu_opened: _editorSession.any_context_menu_opened,
            ...params,
        };
        _editorSession.ended = true;
        trackEvent('editor_session_ended', sessionParams);
    }
}

export function sendAnalyticsTestEvent() {
    trackEvent('analytics_test', { source: 'manual_test' });
}

export function setupAnalyticsDebug() {
    if (typeof window === 'undefined') return;
    window.framedshotAnalyticsDebug = {
        sendTestEvent: sendAnalyticsTestEvent,
    };
}

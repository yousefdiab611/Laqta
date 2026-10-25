(function () {
    const shared = self.fsAnalyticsShared;
    const { STORAGE_KEYS, SESSION_GAP_MS } = shared;

    function storageGet(keys) {
        return new Promise((resolve) => {
            chrome.storage.local.get(keys, (result) => resolve(result || {}));
        });
    }

    function storageSet(value) {
        return new Promise((resolve) => {
            chrome.storage.local.set(value, () => resolve());
        });
    }

    async function updateCounters(eventName, params) {
        const result = await storageGet([STORAGE_KEYS.counters]);
        const counters = { ...(result[STORAGE_KEYS.counters] || {}) };
        const now = Date.now();
        const increment = (key) => { counters[key] = Number(counters[key] || 0) + 1; };

        if (eventName === 'capture_completed') {
            increment('total_captures');
            if (params.capture_type === 'visible_tab') increment('total_visible_tab_captures');
            if (params.capture_type === 'selected_area') increment('total_area_captures');
            if (!counters.first_capture_at) counters.first_capture_at = now;
            counters.last_capture_at = now;
        }
        if (eventName === 'upload_completed') increment('total_uploads');
        if (eventName === 'quick_capture_completed' || eventName === 'quick_copy_success') {
            increment('total_quick_copies');
            if (!counters.first_quick_copy_at) counters.first_quick_copy_at = now;
            counters.last_quick_copy_at = now;
        }
        if (eventName === 'export_completed' && ['png', 'jpg', 'webp', 'zip'].includes(String(params.format || ''))) {
            increment('total_exports');
            if (!counters.first_export_at) counters.first_export_at = now;
            counters.last_export_at = now;
        }
        if (eventName === 'copy_to_clipboard_completed') {
            increment('total_copies');
            if (!counters.first_copy_at) counters.first_copy_at = now;
            counters.last_copy_at = now;
        }
        if (eventName === 'collage_exported') increment('total_collages');
        if (eventName === 'tab_recording_started') {
            increment('total_recordings');
            if (!counters.first_recording_at) counters.first_recording_at = now;
            counters.last_recording_at = now;
        }
        if (eventName === 'tab_recording_export_completed') increment('total_webm_exports');
        await storageSet({ [STORAGE_KEYS.counters]: counters });
    }

    async function emitMilestoneIfNeeded(triggerEventName, emit) {
        const result = await storageGet([STORAGE_KEYS.milestones, STORAGE_KEYS.session]);
        const milestones = { ...(result[STORAGE_KEYS.milestones] || {}) };
        const session = { ...(result[STORAGE_KEYS.session] || {}) };
        const now = Date.now();
        let changed = false;

        const captureTriggers = new Set(['capture_completed', 'upload_completed', 'quick_capture_completed', 'quick_copy_success']);
        if (captureTriggers.has(triggerEventName) && !milestones.activation_first_capture) {
            milestones.activation_first_capture = true;
            changed = true;
            emit('activation_first_capture');
        }

        const exportTriggers = new Set(['export_completed', 'copy_to_clipboard_completed', 'collage_exported', 'tab_recording_export_completed']);
        if (exportTriggers.has(triggerEventName)) {
            if (!milestones.activation_first_export) {
                milestones.activation_first_export = true;
                milestones.first_export_action_at = now;
                changed = true;
                emit('activation_first_export');
            } else if (!milestones.activation_repeat_export_7d
                && milestones.first_export_action_at
                && (now - milestones.first_export_action_at <= 7 * 24 * 60 * 60 * 1000)) {
                milestones.activation_repeat_export_7d = true;
                changed = true;
                emit('activation_repeat_export_7d');
            }
        }

        const sessionTriggers = new Set(['popup_opened', 'editor_opened', 'video_editor_opened', 'welcome_page_opened']);
        if (sessionTriggers.has(triggerEventName)) {
            if (!session.first_seen_at) {
                session.first_seen_at = now;
                session.last_session_started_at = now;
                session.session_count = 1;
                changed = true;
            } else if (!session.last_session_started_at || (now - session.last_session_started_at) > SESSION_GAP_MS) {
                session.last_session_started_at = now;
                session.session_count = Number(session.session_count || 1) + 1;
                changed = true;
            }
            if (!milestones.activation_second_session && Number(session.session_count || 0) >= 2) {
                milestones.activation_second_session = true;
                changed = true;
                emit('activation_second_session');
            }
        }

        if (changed) {
            await storageSet({
                [STORAGE_KEYS.milestones]: milestones,
                [STORAGE_KEYS.session]: session
            });
        }
    }

    self.fsAnalyticsMetrics = { updateCounters, emitMilestoneIfNeeded };
}());

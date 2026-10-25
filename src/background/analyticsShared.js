(function () {
    const DEFAULT_MEASUREMENT_ID = 'G-R8F4PZQ6Q0';
    const DEFAULT_PRODUCTION_ENDPOINT = 'https://framed-shot.com/api/analytics';
    const SESSION_GAP_MS = 30 * 60 * 1000;

    const STORAGE_KEYS = {
        clientId: 'ga4_client_id',
        counters: 'analytics_counters',
        milestones: 'analytics_milestones',
        session: 'analytics_session',
        endpoint: 'analytics_endpoint',
        apiSecret: 'ga4_api_secret',
        measurementId: 'ga4_measurement_id',
        debugMode: 'analytics_debug_mode'
    };

    const ALLOWED_EVENTS = new Set([
        'analytics_test', 'extension_installed', 'extension_updated', 'popup_opened', 'popup_closed_no_action', 'welcome_page_opened', 'editor_opened',
        'editor_session_ended', 'output_context_menu_opened', 'output_drag_started',
        'video_editor_opened', 'request_feature_clicked', 'request_feature_submitted', 'quick_copy_enabled', 'quick_copy_disabled',
        'quick_copy_used', 'quick_copy_success', 'quick_copy_failed', 'screenshot_tab_clicked', 'select_area_clicked',
        'full_page_clicked', 'full_page_blocked',
        'upload_image_clicked', 'create_collage_clicked', 'record_tab_clicked', 'supporter_clicked', 'capture_started',
        'capture_completed', 'capture_failed', 'area_selection_started', 'area_selection_completed', 'area_selection_cancelled',
        'upload_started', 'upload_completed', 'upload_failed', 'quick_copy_toggle_changed', 'quick_capture_started',
        'quick_capture_completed', 'quick_capture_failed', 'frame_enabled', 'frame_disabled', 'frame_style_changed',
        'background_changed', 'padding_changed', 'shadow_changed', 'layout_changed', 'theme_changed', 'annotation_used',
        'annotation_removed', 'redaction_used', 'redaction_removed', 'collage_started', 'collage_image_added',
        'collage_layout_changed', 'collage_exported', 'export_preset_selected', 'custom_size_used', 'high_res_scale_selected',
        'export_started', 'export_completed', 'export_failed', 'copy_to_clipboard_started', 'copy_to_clipboard_completed',
        'copy_to_clipboard_failed', 'batch_export_zip_started', 'batch_export_zip_completed', 'batch_export_zip_failed',
        'style_preset_saved', 'style_preset_applied', 'style_preset_deleted', 'style_preset_updated', 'keyboard_shortcut_used',
        'tab_recording_started', 'tab_recording_stopped', 'tab_recording_preview_played', 'tab_recording_trim_changed',
        'tab_recording_frame_changed', 'tab_recording_export_started', 'tab_recording_export_completed', 'tab_recording_export_failed',
        'tab_recording_discarded', 'supporter_checkout_started', 'supporter_payment_completed', 'supporter_payment_failed',
        'activation_first_capture', 'activation_first_export', 'activation_second_session', 'activation_repeat_export_7d',
        'capture_session_started', 'capture_session_resumed', 'capture_session_finished',
        'capture_session_cancelled', 'capture_session_frame_removed', 'capture_session_max_frames_reached',
        'request_feature_failed'
    ]);

    const ALLOWED_PARAM_KEYS = new Set([
        'annotation_type', 'app_name', 'capture_type', 'duration_ms', 'enabled', 'engagement_time_msec', 'error_type', 'export_scale',
        'extension_version', 'feature', 'file_type', 'format', 'layout_type', 'mode', 'platform', 'preset_type',
        'reason', 'redaction_mode', 'result', 'shortcut_action', 'source', 'theme', 'any_export_attempted', 'any_copy_attempted',
        'any_drag_started', 'any_context_menu_opened', 'frame_index', 'frame_count'
    ]);

    function inDevelopment() {
        return !chrome.runtime.getManifest()?.update_url;
    }

    function safeDebug(method, message, detail) {
        if (!inDevelopment()) return;
        const fn = console[method] || console.debug;
        fn(`[analytics] ${message}`, detail || '');
    }

    function normalizeErrorType(value) {
        const source = String(value || '').toLowerCase();
        if (source.includes('permission')) return 'permission';
        if (source.includes('network')) return 'network';
        if (source.includes('clipboard')) return 'clipboard';
        if (source.includes('timeout')) return 'timeout';
        if (source.includes('validation')) return 'validation';
        if (source.includes('unsupported')) return 'unsupported';
        if (source.includes('already running') || source.includes('in progress')) return 'in_progress';
        if (source.includes('not found')) return 'not_found';
        return 'unknown';
    }

    function sanitizeParams(params) {
        const sanitized = {};
        const source = params && typeof params === 'object' ? params : {};
        for (const [key, raw] of Object.entries(source)) {
            if (!ALLOWED_PARAM_KEYS.has(key)) continue;
            if (raw === null || raw === undefined) continue;
            if (key === 'error_type') {
                sanitized[key] = normalizeErrorType(raw);
                continue;
            }
            const type = typeof raw;
            if (type === 'string') sanitized[key] = raw.slice(0, 120);
            else if (type === 'boolean' || (type === 'number' && Number.isFinite(raw))) sanitized[key] = raw;
        }
        if (sanitized.result && !['success', 'failure'].includes(String(sanitized.result))) delete sanitized.result;
        return sanitized;
    }

    self.fsAnalyticsShared = {
        DEFAULT_MEASUREMENT_ID,
        DEFAULT_PRODUCTION_ENDPOINT,
        SESSION_GAP_MS,
        STORAGE_KEYS,
        ALLOWED_EVENTS,
        inDevelopment,
        safeDebug,
        sanitizeParams
    };
}());

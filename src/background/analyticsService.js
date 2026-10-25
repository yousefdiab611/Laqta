(function () {
    const shared = self.fsAnalyticsShared;
    const metrics = self.fsAnalyticsMetrics;
    const {
        DEFAULT_MEASUREMENT_ID,
        DEFAULT_PRODUCTION_ENDPOINT,
        STORAGE_KEYS,
        ALLOWED_EVENTS,
        inDevelopment,
        safeDebug,
        sanitizeParams
    } = shared;

    const GA4_COLLECT_BASE = 'https://www.google-analytics.com/mp/collect';
    const GA4_DEBUG_COLLECT_BASE = 'https://www.google-analytics.com/debug/mp/collect';

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

    async function getClientId() {
        const result = await storageGet([STORAGE_KEYS.clientId]);
        if (typeof result[STORAGE_KEYS.clientId] === 'string' && result[STORAGE_KEYS.clientId]) {
            return result[STORAGE_KEYS.clientId];
        }
        const clientId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        await storageSet({ [STORAGE_KEYS.clientId]: clientId });
        return clientId;
    }

    async function getTransportConfig() {
        const result = await storageGet([
            STORAGE_KEYS.endpoint,
            STORAGE_KEYS.apiSecret,
            STORAGE_KEYS.measurementId,
            STORAGE_KEYS.debugMode
        ]);
        const configuredEndpoint = typeof result[STORAGE_KEYS.endpoint] === 'string' ? result[STORAGE_KEYS.endpoint] : '';
        return {
            endpoint: configuredEndpoint || (inDevelopment() ? '' : DEFAULT_PRODUCTION_ENDPOINT),
            apiSecret: typeof result[STORAGE_KEYS.apiSecret] === 'string' ? result[STORAGE_KEYS.apiSecret] : '',
            measurementId: typeof result[STORAGE_KEYS.measurementId] === 'string'
                ? result[STORAGE_KEYS.measurementId]
                : DEFAULT_MEASUREMENT_ID,
            debugMode: Boolean(result[STORAGE_KEYS.debugMode])
        };
    }

    async function sendToAnalyticsEndpoint(config, payload) {
        if (config.endpoint) {
            const endpointUrl = config.debugMode
                ? `${config.endpoint}${config.endpoint.includes('?') ? '&' : '?'}debug=true`
                : config.endpoint;
            const response = await fetch(endpointUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            return response.ok;
        }

        if (!inDevelopment() || !config.apiSecret) return false;

        const base = config.debugMode ? GA4_DEBUG_COLLECT_BASE : GA4_COLLECT_BASE;
        const url = `${base}?measurement_id=${encodeURIComponent(config.measurementId)}&api_secret=${encodeURIComponent(config.apiSecret)}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        return response.ok;
    }

    async function trackEvent(eventName, params = {}, options = {}) {
        if (!ALLOWED_EVENTS.has(eventName)) return false;
        const safeParams = sanitizeParams(params);
        const mergedParams = {
            extension_version: chrome.runtime.getManifest().version,
            platform: 'chrome_extension',
            app_name: 'framedshot',
            engagement_time_msec: 1,
            ...safeParams
        };
        const payload = {
            client_id: await getClientId(),
            events: [{ name: eventName, params: mergedParams }]
        };

        try {
            const transportConfig = await getTransportConfig();
            await sendToAnalyticsEndpoint(transportConfig, payload);
        } catch (error) {
            safeDebug('warn', `Failed to send ${eventName}.`, error?.message || 'unknown error');
        }

        try {
            await metrics.updateCounters(eventName, mergedParams);
            if (!options.skipMilestones) {
                await metrics.emitMilestoneIfNeeded(eventName, (milestoneEvent) => {
                    trackEvent(milestoneEvent, {}, { skipMilestones: true });
                });
            }
        } catch (error) {
            safeDebug('warn', `Failed local analytics bookkeeping for ${eventName}.`, error?.message || 'unknown error');
        }
        return true;
    }

    self.fsAnalytics = { trackEvent };
}());

(function () {
    const OFFSCREEN_URL = 'src/offscreen/recorder.html';

    function runtimeUrl(path) {
        return chrome.runtime.getURL(path);
    }

    async function hasOffscreenDocument() {
        if (!chrome.offscreen || typeof chrome.offscreen.hasDocument !== 'function') return false;
        return chrome.offscreen.hasDocument();
    }

    async function ensureOffscreen() {
        if (!chrome.offscreen) throw new Error('Offscreen documents are not available in this browser.');
        if (await hasOffscreenDocument()) return;
        await chrome.offscreen.createDocument({
            url: OFFSCREEN_URL,
            reasons: ['USER_MEDIA'],
            justification: 'Record the active tab after the user starts recording from the popup.'
        });
    }

    function sendRuntimeMessage(message) {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(message, (response) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                resolve(response || { ok: false });
            });
        });
    }

    function getTabStreamId(tabId) {
        return new Promise((resolve, reject) => {
            chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (streamId) => {
                if (chrome.runtime.lastError || !streamId) {
                    reject(new Error(chrome.runtime.lastError?.message || 'Could not create recording stream.'));
                    return;
                }
                resolve(streamId);
            });
        });
    }

    async function sendToOffscreen(message) {
        await ensureOffscreen();
        let lastError;
        for (let attempt = 0; attempt < 5; attempt++) {
            try {
                return await sendRuntimeMessage(message);
            } catch (error) {
                lastError = error;
                await new Promise((resolve) => setTimeout(resolve, 100));
            }
        }
        throw lastError || new Error('Offscreen recorder is not ready.');
    }

    async function closeOffscreenIfIdle() {
        if (!chrome.offscreen || !(await hasOffscreenDocument())) return;
        const status = await sendRuntimeMessage({ type: 'OFFSCREEN_RECORDING_STATUS' }).catch(() => null);
        if (status && status.recording) return;
        await chrome.offscreen.closeDocument().catch(() => {});
    }

    async function openRecordingEditor(recordingId) {
        const editorUrl = new URL('editor/index.html', runtimeUrl('/'));
        editorUrl.searchParams.set('recordingId', recordingId);
        await self.fsBackgroundShared.createTab({ url: editorUrl.toString() });
    }

    async function startRecording(message) {
        const streamId = message.streamId || await getTabStreamId(message.tabId);
        const response = await sendToOffscreen({
            type: 'OFFSCREEN_RECORDING_START',
            streamId,
            tabId: message.tabId,
            title: message.title,
            includeAudio: message.includeAudio !== false
        });
        if (!response.ok) return response;
        return { ok: true, recordingId: response.recordingId, startedAt: response.startedAt };
    }

    async function stopRecording(recordingId) {
        const response = await sendToOffscreen({ type: 'OFFSCREEN_RECORDING_STOP', recordingId });
        if (!response.ok) return response;
        await openRecordingEditor(response.recordingId);
        await closeOffscreenIfIdle();
        return { ok: true, recordingId: response.recordingId };
    }

    async function getRecordingStatus() {
        if (!chrome.offscreen || !(await hasOffscreenDocument())) return { ok: true, recording: null };
        return sendRuntimeMessage({ type: 'OFFSCREEN_RECORDING_STATUS' });
    }

    self.fsRecordingController = {
        getRecordingStatus,
        startRecording,
        stopRecording,
        openRecordingEditor,
        closeOffscreenIfIdle
    };
}());

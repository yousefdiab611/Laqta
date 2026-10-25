import { appendChunk, createRecording, updateRecording } from '../lib/recordingStore.js';

const MIME_TYPE_CANDIDATES = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
];

const TIMESLICE_MS = 1000;
let active = null;

function createRecordingId() {
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
    const random = Math.random().toString(36).slice(2, 8);
    return `rec_${stamp}_${random}`;
}

function getSupportedMimeType() {
    return MIME_TYPE_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

function stopTracks(stream) {
    if (!stream) return;
    stream.getTracks().forEach((track) => track.stop());
}

async function restoreTabAudio(stream) {
    const audioTracks = stream.getAudioTracks();
    if (!audioTracks.length) return null;
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) return null;
    const audioContext = new AudioContextCtor();
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(audioContext.destination);
    return audioContext;
}

async function getTabStream(streamId, includeAudio) {
    const audio = includeAudio
        ? { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } }
        : false;
    return navigator.mediaDevices.getUserMedia({
        audio,
        video: {
            mandatory: {
                chromeMediaSource: 'tab',
                chromeMediaSourceId: streamId,
            },
        },
    });
}

async function finalizeActive(status = 'complete') {
    if (!active || active.finalizing) return null;
    const current = active;
    current.finalizing = true;

    if (current.recorder && current.recorder.state !== 'inactive') {
        await new Promise((resolve) => {
            current.recorder.addEventListener('stop', resolve, { once: true });
            current.recorder.requestData();
            current.recorder.stop();
        });
    }
    // Null `active` only AFTER the stop flush: requestData() fires a final 'dataavailable' that
    // the listener must still record (it bails on !active). Nulling first dropped the last chunk
    // on the native "Stop sharing" path, truncating the recording. `finalizing` guards re-entry.
    active = null;
    stopTracks(current.stream);
    if (current.audioContext) await current.audioContext.close().catch(() => {});
    await Promise.all(current.pendingWrites).catch(() => {});

    const endedAt = Date.now();
    await updateRecording(current.recordingId, {
        endedAt,
        status,
        durationMs: endedAt - current.startedAt,
        sizeBytes: current.sizeBytes,
    });

    return current.recordingId;
}

async function startRecording(message) {
    if (active) throw new Error('A recording is already in progress.');
    if (!message.streamId) throw new Error('Missing tab stream id.');

    const recordingId = createRecordingId();
    const startedAt = Date.now();
    const mimeType = getSupportedMimeType();
    const stream = await getTabStream(message.streamId, message.includeAudio !== false);
    const audioContext = await restoreTabAudio(stream);

    await createRecording({
        recordingId,
        startedAt,
        endedAt: null,
        title: message.title || 'لقطة — Laqta recording',
        mimeType: mimeType || 'video/webm',
        durationMs: 0,
        sizeBytes: 0,
        status: 'recording',
    });

    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    active = {
        audioContext,
        index: 0,
        mimeType,
        pendingWrites: [],
        recorder,
        recordingId,
        sizeBytes: 0,
        startedAt,
        stream,
    };

    recorder.addEventListener('dataavailable', async (event) => {
        if (!event.data || event.data.size === 0 || !active) return;
        const chunkIndex = active.index;
        active.index += 1;
        active.sizeBytes += event.data.size;
        const write = appendChunk(recordingId, chunkIndex, event.data);
        active.pendingWrites.push(write);
        await write;
    });

    recorder.addEventListener('stop', () => {
        stopTracks(stream);
    });

    stream.getVideoTracks().forEach((track) => {
        track.addEventListener('ended', () => {
            finalizeActive('partial').then((id) => {
                if (id) chrome.runtime.sendMessage({ type: 'RECORDING_ENDED', recordingId: id, status: 'partial' });
            });
        });
    });

    recorder.start(TIMESLICE_MS);
    return { recordingId, startedAt };
}

async function stopRecording(recordingId) {
    if (!active || active.recordingId !== recordingId) throw new Error('No matching recording is in progress.');
    await new Promise((resolve) => {
        const recorder = active.recorder;
        recorder.addEventListener('stop', resolve, { once: true });
        recorder.requestData();
        recorder.stop();
    });
    const id = await finalizeActive('complete');
    return { recordingId: id };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !message.type) return undefined;

    if (message.type === 'OFFSCREEN_RECORDING_START') {
        startRecording(message)
            .then((result) => sendResponse({ ok: true, ...result }))
            .catch((error) => sendResponse({ ok: false, error: error.message || 'Failed to start recording.' }));
        return true;
    }

    if (message.type === 'OFFSCREEN_RECORDING_STOP') {
        stopRecording(message.recordingId)
            .then((result) => sendResponse({ ok: true, ...result }))
            .catch((error) => sendResponse({ ok: false, error: error.message || 'Failed to stop recording.' }));
        return true;
    }

    if (message.type === 'OFFSCREEN_RECORDING_STATUS') {
        sendResponse({
            ok: true,
            recording: active ? { recordingId: active.recordingId, startedAt: active.startedAt } : null,
        });
        return undefined;
    }

    return undefined;
});

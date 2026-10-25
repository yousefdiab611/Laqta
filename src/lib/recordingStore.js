const DB_NAME = 'framedshot-recordings';
const DB_VERSION = 1;
const CHUNKS_STORE = 'chunks';
const RECORDINGS_STORE = 'recordings';
const DAY_MS = 24 * 60 * 60 * 1000;

function openRecordingDb() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = () => reject(request.error || new Error('Failed to open recordings database.'));
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(CHUNKS_STORE)) {
                db.createObjectStore(CHUNKS_STORE, { keyPath: ['recordingId', 'index'] });
            }
            if (!db.objectStoreNames.contains(RECORDINGS_STORE)) {
                db.createObjectStore(RECORDINGS_STORE, { keyPath: 'recordingId' });
            }
        };
    });
}

function withStore(storeName, mode, callback) {
    return openRecordingDb().then((db) => new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        let result;
        tx.oncomplete = () => {
            db.close();
            resolve(result);
        };
        tx.onerror = () => {
            db.close();
            reject(tx.error || new Error('Recording database transaction failed.'));
        };
        result = callback(store);
    }));
}

function requestToPromise(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('Recording database request failed.'));
    });
}

export function createRecording(recording) {
    return withStore(RECORDINGS_STORE, 'readwrite', (store) => {
        store.put(recording);
    });
}

export function updateRecording(recordingId, patch) {
    return withStore(RECORDINGS_STORE, 'readwrite', (store) => {
        const request = store.get(recordingId);
        request.onsuccess = () => {
            const existing = request.result || { recordingId };
            store.put({ ...existing, ...patch });
        };
    });
}

export function getRecording(recordingId) {
    return withStore(RECORDINGS_STORE, 'readonly', (store) => requestToPromise(store.get(recordingId)));
}

export function appendChunk(recordingId, index, blob) {
    return withStore(CHUNKS_STORE, 'readwrite', (store) => {
        store.put({ recordingId, index, blob, size: blob.size, ts: Date.now() });
    });
}

export function listChunks(recordingId) {
    return withStore(CHUNKS_STORE, 'readonly', (store) => requestToPromise(store.getAll()).then((chunks) => (
        chunks
            .filter((chunk) => chunk.recordingId === recordingId)
            .sort((a, b) => a.index - b.index)
    )));
}

export async function assembleRecordingBlob(recordingId, mimeType = 'video/webm') {
    const chunks = await listChunks(recordingId);
    return new Blob(chunks.map((chunk) => chunk.blob), { type: mimeType });
}

export async function assembleRecordingBlobUrl(recordingId, mimeType = 'video/webm') {
    const blob = await assembleRecordingBlob(recordingId, mimeType);
    return { blob, url: URL.createObjectURL(blob) };
}

export async function deleteRecording(recordingId) {
    const db = await openRecordingDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction([CHUNKS_STORE, RECORDINGS_STORE], 'readwrite');
        tx.objectStore(RECORDINGS_STORE).delete(recordingId);
        const chunkStore = tx.objectStore(CHUNKS_STORE);
        const request = chunkStore.getAll();
        request.onsuccess = () => {
            request.result
                .filter((chunk) => chunk.recordingId === recordingId)
                .forEach((chunk) => chunkStore.delete([chunk.recordingId, chunk.index]));
        };
        tx.oncomplete = () => {
            db.close();
            resolve();
        };
        tx.onerror = () => {
            db.close();
            reject(tx.error || new Error('Failed to delete recording.'));
        };
    });
}

export async function sweepOldRecordings(now = Date.now()) {
    const db = await openRecordingDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(RECORDINGS_STORE, 'readonly');
        const request = tx.objectStore(RECORDINGS_STORE).getAll();
        request.onsuccess = async () => {
            const expired = request.result.filter((recording) => (
                !recording.endedAt || recording.endedAt < now - DAY_MS
            ));
            await Promise.all(expired.map((recording) => deleteRecording(recording.recordingId)));
            resolve(expired.length);
        };
        request.onerror = () => reject(request.error || new Error('Failed to sweep recordings.'));
        tx.oncomplete = () => db.close();
    });
}

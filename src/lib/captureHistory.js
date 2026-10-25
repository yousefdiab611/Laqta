(function () {
    'use strict';

    const DB_NAME = 'framedshot-capture-history';
    const STORE_NAME = 'captures';
    const MAX_CAPTURES = 20;

    function openHistoryDb() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, 1);
            request.onerror = () => reject(request.error || new Error('Could not open capture history.'));
            request.onsuccess = () => resolve(request.result);
            request.onupgradeneeded = () => {
                request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
            };
        });
    }

    async function historyStore(mode) {
        const database = await openHistoryDb();
        const transaction = database.transaction(STORE_NAME, mode);
        return { database, transaction, store: transaction.objectStore(STORE_NAME) };
    }

    function indexedDbRequest(request) {
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error || new Error('History request failed.'));
        });
    }

    function transactionComplete(database, transaction) {
        return new Promise((resolve, reject) => {
            transaction.oncomplete = () => { database.close(); resolve(); };
            transaction.onerror = () => { database.close(); reject(transaction.error); };
        });
    }

    async function listCaptures() {
        const { database, transaction, store } = await historyStore('readonly');
        const completed = transactionComplete(database, transaction);
        const captures = await indexedDbRequest(store.getAll());
        await completed;
        return captures.sort((left, right) => right.createdAt - left.createdAt);
    }

    async function saveCapture(dataUrl) {
        const { database, transaction, store } = await historyStore('readwrite');
        store.put({ id: crypto.randomUUID(), createdAt: Date.now(), dataUrl });
        await transactionComplete(database, transaction);
        await trimHistory();
    }

    async function trimHistory() {
        const captures = await listCaptures();
        await Promise.all(captures.slice(MAX_CAPTURES).map((capture) => deleteCapture(capture.id)));
    }

    async function deleteCapture(captureId) {
        const { database, transaction, store } = await historyStore('readwrite');
        store.delete(captureId);
        await transactionComplete(database, transaction);
    }

    async function clearHistory() {
        const { database, transaction, store } = await historyStore('readwrite');
        store.clear();
        await transactionComplete(database, transaction);
    }

    globalThis.fsCaptureHistory = { clearHistory, deleteCapture, listCaptures, saveCapture };
}());

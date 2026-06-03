// ============================================================
// shared/idb.ts — IndexedDB Helper for Aura Recorder
// Provides typed CRUD operations for storing video recording
// blobs locally. Zero external dependencies.
// ============================================================
const DB_NAME = 'AuraRecorderDB';
const DB_VERSION = 1;
const STORE_NAME = 'recordings';
/** Open (or create) the IndexedDB database */
function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                store.createIndex('createdAt', 'createdAt', { unique: false });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}
/** Save a recording entry into IndexedDB */
export async function saveRecording(entry) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.put(entry);
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => { resolve(); db.close(); };
        tx.onerror = () => { reject(tx.error); db.close(); };
    });
}
/** Retrieve a single recording by ID */
export async function getRecording(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
    });
}
/** List all recordings ordered by most recent first */
export async function listRecordings() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const idx = store.index('createdAt');
        const req = idx.openCursor(null, 'prev'); // newest first
        const results = [];
        req.onsuccess = () => {
            const cursor = req.result;
            if (cursor) {
                results.push(cursor.value);
                cursor.continue();
            }
            else {
                resolve(results);
            }
        };
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
    });
}
/** Delete a recording by ID */
export async function deleteRecording(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.delete(id);
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => { resolve(); db.close(); };
        tx.onerror = () => { reject(tx.error); db.close(); };
    });
}
/** Generate a unique recording ID */
export function generateId() {
    return `rec_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

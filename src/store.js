// Pieces are kept in the browser on this device (IndexedDB): the notes and settings always, and the recording when
// the browser has room for it. Nothing is sent anywhere.

// The store keeps the app's first name, so pieces saved before it was renamed are still there.
const NAME = 'kudunotes', VERSION = 1;
export const BIGGEST_SOUND = 80 * 1024 * 1024; // recordings larger than this aren't kept (the notes still are)

let opening = null;
function open() {
  opening = opening || new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('pieces')) db.createObjectStore('pieces', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('sounds')) db.createObjectStore('sounds');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return opening;
}

function run(stores, mode, work) {
  return open().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = tx.onabort = () => reject(tx.error || new Error('The browser could not save.'));
    result = work(tx);
  }));
}
const asked = req => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });

/** Every saved piece, the one changed last first. */
export async function list() {
  const all = await run(['pieces'], 'readonly', tx => asked(tx.objectStore('pieces').getAll()));
  return all.sort((a, b) => (b.changed || 0) - (a.changed || 0));
}

export function get(id) {
  return run(['pieces'], 'readonly', tx => asked(tx.objectStore('pieces').get(id)));
}

/** Saves a piece (plain data from Piece.plain()). Returns its id. */
export async function put(piece) {
  const data = { ...piece, changed: Date.now() };
  if (data.id == null) delete data.id;
  return run(['pieces'], 'readwrite', tx => asked(tx.objectStore('pieces').put(data)));
}

/** Keeps a piece's recording. False when it's too big or the browser has no room; the notes are safe either way. */
export async function putSound(id, blob, name = '') {
  if (!blob || blob.size > BIGGEST_SOUND) return false;
  try {
    await run(['sounds'], 'readwrite', tx => { tx.objectStore('sounds').put({ blob, name }, id); });
    return true;
  } catch {
    return false;
  }
}

export async function getSound(id) {
  try { return (await run(['sounds'], 'readonly', tx => asked(tx.objectStore('sounds').get(id)))) || null; }
  catch { return null; }
}

export async function remove(id) {
  await run(['pieces', 'sounds'], 'readwrite', tx => { tx.objectStore('pieces').delete(id); tx.objectStore('sounds').delete(id); });
}

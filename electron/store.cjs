'use strict';

/**
 * The library of the app: saved missions and the history of flown flights, kept as files in the application's own data
 * folder. The pilot does not choose a place; the folder is made and used automatically.
 *
 * Every item is two files: `<id>.json` holds the data and `<id>.meta.json` a small summary, so a list can be shown
 * without reading the data. Files are written to a temporary name and renamed, so a crash cannot leave half a file.
 * The file system is passed in (`fs`, `path`) so the store can be tested without touching a disk.
 */

const KINDS = {
  // missions: never removed by the store itself, only by the pilot; flights: the oldest go when there are more than `max`
  missions: { max: 500, maxBytes: 4 * 1024 * 1024, autoPrune: false },
  flights: { max: 50, maxBytes: 30 * 1024 * 1024, autoPrune: true },
};

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_META_BYTES = 16 * 1024;

function createStore({ root, fs, path }) {
  function kindOf(kind) {
    if (!Object.prototype.hasOwnProperty.call(KINDS, kind)) throw new Error('Unknown kind of item');
    return KINDS[kind];
  }

  function idOf(id) {
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) throw new Error('Invalid item name');
    return id;
  }

  const dirOf = (kind) => path.join(root, kind);
  const dataFile = (kind, id) => path.join(dirOf(kind), `${id}.json`);
  const metaFile = (kind, id) => path.join(dirOf(kind), `${id}.meta.json`);

  function ensureDir(kind) {
    fs.mkdirSync(dirOf(kind), { recursive: true });
  }

  function writeAtomic(file, text) {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, text, 'utf8');
    fs.renameSync(tmp, file);
  }

  function removeFile(file) {
    try {
      fs.unlinkSync(file);
    } catch {
      /* already gone */
    }
  }

  function list(kind) {
    kindOf(kind);
    ensureDir(kind);
    const items = [];
    for (const name of fs.readdirSync(dirOf(kind))) {
      if (!name.endsWith('.meta.json')) continue;
      const id = name.slice(0, -'.meta.json'.length);
      if (!ID_PATTERN.test(id)) continue;
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(dirOf(kind), name), 'utf8'));
        // A summary without its data is a leftover of an interrupted removal: not shown
        if (meta && typeof meta === 'object' && fs.existsSync(dataFile(kind, id))) items.push({ id, meta });
      } catch {
        /* a damaged summary is skipped */
      }
    }
    const savedAt = (m) => (typeof m.meta.savedAt === 'number' ? m.meta.savedAt : 0);
    return items.sort((a, b) => savedAt(b) - savedAt(a));
  }

  function read(kind, id) {
    kindOf(kind);
    idOf(id);
    return JSON.parse(fs.readFileSync(dataFile(kind, id), 'utf8'));
  }

  function write(kind, id, meta, data) {
    const cfg = kindOf(kind);
    idOf(id);
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) throw new Error('Invalid summary');
    const metaText = JSON.stringify(meta);
    if (metaText.length > MAX_META_BYTES) throw new Error('Summary too large');
    const dataText = JSON.stringify(data);
    if (dataText === undefined) throw new Error('Nothing to save');
    if (dataText.length > cfg.maxBytes) throw new Error('Item too large');

    ensureDir(kind);
    const existing = list(kind);
    if (!cfg.autoPrune && !existing.some((i) => i.id === id) && existing.length >= cfg.max) {
      throw new Error(`The library is full (${cfg.max} items): delete some first`);
    }

    // The data first, then the summary: an item is listed only when both are there
    writeAtomic(dataFile(kind, id), dataText);
    writeAtomic(metaFile(kind, id), metaText);

    if (cfg.autoPrune) {
      const all = list(kind);
      for (const old of all.slice(cfg.max)) remove(kind, old.id);
    }
  }

  function remove(kind, id) {
    kindOf(kind);
    idOf(id);
    // The summary first: the item disappears from the list at once
    removeFile(metaFile(kind, id));
    removeFile(dataFile(kind, id));
  }

  return { list, read, write, remove };
}

module.exports = { createStore, KINDS, ID_PATTERN };

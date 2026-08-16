// localStorage persistence. Everything is namespaced so SowmiCraft never
// collides with anything else served from the same origin, and every read is
// defensive — a corrupt save should drop you back to the menu, not crash.

const NS = 'sowmicraft:';

let available = true;
try {
  const probe = NS + '__probe';
  localStorage.setItem(probe, '1');
  localStorage.removeItem(probe);
} catch {
  available = false;
}

/** In-memory fallback so private-browsing modes still work for one session. */
const memory = new Map();

function rawGet(key) {
  if (!available) return memory.has(key) ? memory.get(key) : null;
  try { return localStorage.getItem(NS + key); } catch { return null; }
}

function rawSet(key, value) {
  if (!available) { memory.set(key, value); return true; }
  try { localStorage.setItem(NS + key, value); return true; }
  catch (e) {
    console.warn('[storage] write failed', key, e);
    return false;
  }
}

function rawRemove(key) {
  if (!available) { memory.delete(key); return; }
  try { localStorage.removeItem(NS + key); } catch { /* ignore */ }
}

export function load(key, fallback = null) {
  const raw = rawGet(key);
  if (raw === null) return fallback;
  try { return JSON.parse(raw); }
  catch (e) {
    console.warn('[storage] corrupt entry, discarding:', key, e);
    rawRemove(key);
    return fallback;
  }
}

export function save(key, value) {
  let json;
  try { json = JSON.stringify(value); }
  catch (e) { console.warn('[storage] could not serialise', key, e); return false; }
  return rawSet(key, json);
}

export function remove(key) { rawRemove(key); }

export function keys(prefix = '') {
  if (!available) return [...memory.keys()].filter((k) => k.startsWith(prefix));
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(NS + prefix)) out.push(k.slice(NS.length));
    }
  } catch { /* ignore */ }
  return out;
}

export const isAvailable = () => available;

// ------------------------------------------------------------------ worlds

const WORLD_PREFIX = 'world:';

export function listWorlds() {
  return keys(WORLD_PREFIX + 'meta:')
    .map((k) => load(k))
    .filter(Boolean)
    .sort((a, b) => b.lastPlayed - a.lastPlayed);
}

export function saveWorldMeta(meta) {
  return save(`${WORLD_PREFIX}meta:${meta.id}`, meta);
}

export function loadWorldData(id) {
  return load(`${WORLD_PREFIX}data:${id}`, null);
}

export function saveWorldData(id, data) {
  return save(`${WORLD_PREFIX}data:${id}`, data);
}

export function deleteWorld(id) {
  remove(`${WORLD_PREFIX}meta:${id}`);
  remove(`${WORLD_PREFIX}data:${id}`);
}

/** Rough byte cost of the current save set — surfaced in the world-select UI. */
export function usageBytes() {
  let total = 0;
  for (const k of keys()) {
    const v = rawGet(k);
    if (v) total += (k.length + v.length) * 2;
  }
  return total;
}

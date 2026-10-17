/**
 * Simple browser database (IndexedDB) for saved practice works.
 * Each work has a renameable title plus the French text (and optional vocab snapshot).
 */

const DB_NAME = 'frc-works-db'
const DB_VERSION = 1
const STORE = 'works'

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB indisponible dans ce navigateur'))
      return
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onerror = () => reject(request.error || new Error('Ouverture DB impossible'))
    request.onsuccess = () => resolve(request.result)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' })
        store.createIndex('updatedAt', 'updatedAt', { unique: false })
        store.createIndex('title', 'title', { unique: false })
      }
    }
  })
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error || new Error('Transaction DB échouée'))
    tx.onabort = () => reject(tx.error || new Error('Transaction DB annulée'))
  })
}

function newId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `work-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function defaultWorkTitle(text = '') {
  const first = String(text)
    .trim()
    .split(/\n|[.!?…]/)[0]
    ?.trim()
  if (first && first.length > 3) {
    return first.length > 48 ? `${first.slice(0, 45)}…` : first
  }
  const stamp = new Date().toLocaleString('fr-FR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
  return `Travail ${stamp}`
}

/** @returns {Promise<Array<{id:string,title:string,text:string,updatedAt:string,createdAt:string}>>} */
export async function listWorks() {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).getAll()
    req.onsuccess = () => {
      const rows = Array.isArray(req.result) ? req.result : []
      rows.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
      resolve(rows)
    }
    req.onerror = () => reject(req.error)
  })
}

export async function getWork(id) {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(id)
    req.onsuccess = () => resolve(req.result || null)
    req.onerror = () => reject(req.error)
  })
}

/**
 * Create or update a work.
 * @param {{ id?: string, title: string, text: string, vocab?: unknown[], note?: string }} input
 */
export async function saveWork(input) {
  const text = String(input?.text ?? '').trim()
  if (!text) throw new Error('Ajoutez un texte avant de sauver.')
  const title = String(input?.title ?? '').trim() || defaultWorkTitle(text)
  const now = new Date().toISOString()
  const id = input?.id || newId()

  const db = await openDb()
  const existing = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(id)
    req.onsuccess = () => resolve(req.result || null)
    req.onerror = () => reject(req.error)
  })

  const record = {
    id,
    title,
    text,
    note: String(input?.note ?? existing?.note ?? '').trim(),
    vocab: Array.isArray(input?.vocab)
      ? input.vocab
      : Array.isArray(existing?.vocab)
        ? existing.vocab
        : [],
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  }

  const tx = db.transaction(STORE, 'readwrite')
  tx.objectStore(STORE).put(record)
  await txDone(tx)
  return record
}

export async function renameWork(id, title) {
  const work = await getWork(id)
  if (!work) throw new Error('Travail introuvable')
  const nextTitle = String(title ?? '').trim()
  if (!nextTitle) throw new Error('Le titre ne peut pas être vide')
  return saveWork({ ...work, title: nextTitle })
}

export async function deleteWork(id) {
  const db = await openDb()
  const tx = db.transaction(STORE, 'readwrite')
  tx.objectStore(STORE).delete(id)
  await txDone(tx)
}

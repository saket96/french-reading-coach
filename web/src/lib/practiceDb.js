/**
 * IndexedDB for TCF pronunciation practice sessions, attempts, and weaknesses.
 * Local-first (no auth) — keyed by anonymous learner id in localStorage.
 */

const DB_NAME = 'frc-practice-db'
const DB_VERSION = 1
const STORE_ATTEMPTS = 'attempts'
const STORE_WEAKNESSES = 'weaknesses'
const LEARNER_KEY = 'frc-learner-id'

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
      if (!db.objectStoreNames.contains(STORE_ATTEMPTS)) {
        const attempts = db.createObjectStore(STORE_ATTEMPTS, { keyPath: 'id' })
        attempts.createIndex('taskId', 'taskId', { unique: false })
        attempts.createIndex('learnerId', 'learnerId', { unique: false })
        attempts.createIndex('createdAt', 'createdAt', { unique: false })
        attempts.createIndex('taskLearner', ['taskId', 'learnerId'], { unique: false })
      }
      if (!db.objectStoreNames.contains(STORE_WEAKNESSES)) {
        const weak = db.createObjectStore(STORE_WEAKNESSES, { keyPath: 'id' })
        weak.createIndex('learnerId', 'learnerId', { unique: false })
        weak.createIndex('kind', 'kind', { unique: false })
        weak.createIndex('updatedAt', 'updatedAt', { unique: false })
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

function newId(prefix = 'id') {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return `${prefix}-${crypto.randomUUID()}`
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/** Stable anonymous learner id for this browser profile. */
export function getLearnerId() {
  try {
    let id = localStorage.getItem(LEARNER_KEY)
    if (!id) {
      id = newId('learner')
      localStorage.setItem(LEARNER_KEY, id)
    }
    return id
  } catch {
    return 'learner-local'
  }
}

/**
 * @param {{
 *   taskId: string,
 *   mode: string,
 *   expectedText: string,
 *   transcript?: string,
 *   analysis?: object,
 *   audioDataUrl?: string | null,
 *   durationMs?: number,
 * }} input
 */
export async function savePracticeAttempt(input) {
  const learnerId = getLearnerId()
  const taskId = String(input.taskId || '').trim()
  if (!taskId) throw new Error('taskId requis')
  const previous = await listAttemptsForTask(taskId)
  const attemptNumber = previous.length + 1
  const now = new Date().toISOString()
  const record = {
    id: newId('attempt'),
    learnerId,
    taskId,
    attemptNumber,
    mode: String(input.mode || 'complete'),
    expectedText: String(input.expectedText || ''),
    transcript: String(input.transcript || ''),
    analysis: input.analysis || null,
    audioDataUrl: input.audioDataUrl || null,
    durationMs: Number(input.durationMs) || 0,
    createdAt: now,
  }
  const db = await openDb()
  const tx = db.transaction(STORE_ATTEMPTS, 'readwrite')
  tx.objectStore(STORE_ATTEMPTS).put(record)
  await txDone(tx)

  if (input.analysis?.weaknesses?.length) {
    await mergeWeaknesses(input.analysis.weaknesses, { taskId, attemptId: record.id })
  }
  return record
}

export async function listAttemptsForTask(taskId) {
  const learnerId = getLearnerId()
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_ATTEMPTS, 'readonly')
    const store = tx.objectStore(STORE_ATTEMPTS)
    const index = store.index('taskId')
    const req = index.getAll(String(taskId))
    req.onsuccess = () => {
      const rows = (Array.isArray(req.result) ? req.result : []).filter(
        (row) => row.learnerId === learnerId,
      )
      rows.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
      resolve(rows)
    }
    req.onerror = () => reject(req.error)
  })
}

export async function getAttempt(id) {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_ATTEMPTS, 'readonly')
    const req = tx.objectStore(STORE_ATTEMPTS).get(id)
    req.onsuccess = () => resolve(req.result || null)
    req.onerror = () => reject(req.error)
  })
}

export async function deleteAttempt(id) {
  const db = await openDb()
  const tx = db.transaction(STORE_ATTEMPTS, 'readwrite')
  tx.objectStore(STORE_ATTEMPTS).delete(id)
  await txDone(tx)
}

/**
 * Upsert weakness tallies for the learner.
 * @param {Array<{ id: string, kind: string, label: string, detail?: string, examples?: string[] }>} items
 */
export async function mergeWeaknesses(items, { taskId, attemptId } = {}) {
  if (!Array.isArray(items) || !items.length) return []
  const learnerId = getLearnerId()
  const db = await openDb()
  const now = new Date().toISOString()
  const out = []

  for (const item of items) {
    const weakId = `${learnerId}::${item.id || item.kind || item.label}`
    const existing = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_WEAKNESSES, 'readonly')
      const req = tx.objectStore(STORE_WEAKNESSES).get(weakId)
      req.onsuccess = () => resolve(req.result || null)
      req.onerror = () => reject(req.error)
    })
    const examples = [
      ...(Array.isArray(existing?.examples) ? existing.examples : []),
      ...(Array.isArray(item.examples) ? item.examples : []),
    ]
      .filter(Boolean)
      .slice(-12)
    const record = {
      id: weakId,
      learnerId,
      kind: item.kind || 'other',
      label: item.label || item.kind || 'Faiblesse',
      detail: item.detail || existing?.detail || '',
      count: (existing?.count || 0) + 1,
      examples,
      lastTaskId: taskId || existing?.lastTaskId || '',
      lastAttemptId: attemptId || existing?.lastAttemptId || '',
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    }
    const tx = db.transaction(STORE_WEAKNESSES, 'readwrite')
    tx.objectStore(STORE_WEAKNESSES).put(record)
    await txDone(tx)
    out.push(record)
  }
  return out
}

export async function listWeaknesses() {
  const learnerId = getLearnerId()
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_WEAKNESSES, 'readonly')
    const req = tx.objectStore(STORE_WEAKNESSES).getAll()
    req.onsuccess = () => {
      const rows = (Array.isArray(req.result) ? req.result : []).filter(
        (row) => row.learnerId === learnerId,
      )
      rows.sort((a, b) => (b.count || 0) - (a.count || 0) || String(b.updatedAt).localeCompare(String(a.updatedAt)))
      resolve(rows)
    }
    req.onerror = () => reject(req.error)
  })
}

/** Compare two attempts' overall scores for progress UI. */
export function compareAttempts(previous, current) {
  const prevScore = Number(previous?.analysis?.overallScore)
  const currScore = Number(current?.analysis?.overallScore)
  if (!Number.isFinite(prevScore) || !Number.isFinite(currScore)) {
    return { delta: null, improved: null, previousScore: prevScore || null, currentScore: currScore || null }
  }
  const delta = Math.round((currScore - prevScore) * 10) / 10
  return {
    delta,
    improved: delta > 0.5 ? true : delta < -0.5 ? false : null,
    previousScore: prevScore,
    currentScore: currScore,
  }
}

/** Exportable slice for browser backup. */
export async function exportPracticeBackup() {
  const learnerId = getLearnerId()
  const db = await openDb()
  const attempts = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_ATTEMPTS, 'readonly')
    const req = tx.objectStore(STORE_ATTEMPTS).getAll()
    req.onsuccess = () =>
      resolve((req.result || []).filter((row) => row.learnerId === learnerId))
    req.onerror = () => reject(req.error)
  })
  const weaknesses = await listWeaknesses()
  return { learnerId, attempts, weaknesses }
}

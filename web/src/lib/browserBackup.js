/**
 * Export / import learner data so Opera ↔ Safari (and other browsers) can share
 * Mes travaux, vocabulaire, texte perso and settings.
 * Browsers never share localStorage/IndexedDB with each other.
 */

import { loadCustomText, saveCustomText } from './customText.js'
import { loadVocabulary, saveVocabulary } from './vocabulary.js'
import { listWorks, saveWork } from './worksDb.js'

const SETTINGS_KEYS = [
  'frc-click-learn',
  'frc-click-target',
  'frc-speaking-pace',
  'frc-french-voice',
  'frc-whisper-model',
  'frc-shadow-mode',
]

const BACKUP_VERSION = 1

function readSettings() {
  const settings = {}
  if (typeof localStorage === 'undefined') return settings
  for (const key of SETTINGS_KEYS) {
    try {
      const value = localStorage.getItem(key)
      if (value != null) settings[key] = value
    } catch {
      // ignore
    }
  }
  return settings
}

function writeSettings(settings = {}) {
  if (typeof localStorage === 'undefined' || !settings || typeof settings !== 'object') return
  for (const key of SETTINGS_KEYS) {
    if (!(key in settings)) continue
    try {
      const value = settings[key]
      if (value == null || value === '') localStorage.removeItem(key)
      else localStorage.setItem(key, String(value))
    } catch {
      // ignore
    }
  }
}

/** Build a portable JSON backup of everything stored in this browser. */
export async function exportBrowserBackup() {
  const works = await listWorks()
  return {
    version: BACKUP_VERSION,
    app: 'coach-de-lecture-francaise',
    exportedAt: new Date().toISOString(),
    works,
    vocabulary: loadVocabulary(),
    customText: loadCustomText(),
    settings: readSettings(),
  }
}

/**
 * Restore a backup into this browser.
 * @param {object} backup
 * @param {{ mergeWorks?: boolean }} [options] mergeWorks=true keeps existing works and upserts by id
 */
export async function importBrowserBackup(backup, { mergeWorks = true } = {}) {
  if (!backup || typeof backup !== 'object') {
    throw new Error('Fichier de sauvegarde invalide')
  }
  if (backup.app && backup.app !== 'coach-de-lecture-francaise') {
    throw new Error('Ce fichier ne vient pas du Coach de lecture française')
  }

  const works = Array.isArray(backup.works) ? backup.works : []
  let importedWorks = 0
  for (const work of works) {
    if (!work?.text?.trim()) continue
    await saveWork({
      id: mergeWorks ? work.id : undefined,
      title: work.title,
      text: work.text,
      note: work.note,
      vocab: work.vocab,
    })
    importedWorks += 1
  }

  if (Array.isArray(backup.vocabulary)) {
    const incoming = backup.vocabulary
    if (mergeWorks) {
      const current = loadVocabulary()
      const byWord = new Map(current.map((entry) => [entry.word, entry]))
      for (const entry of incoming) {
        if (!entry?.word) continue
        byWord.set(entry.word, { ...byWord.get(entry.word), ...entry })
      }
      saveVocabulary([...byWord.values()])
    } else {
      saveVocabulary(incoming)
    }
  }

  if (typeof backup.customText === 'string' && backup.customText.trim()) {
    saveCustomText(backup.customText)
  }

  if (backup.settings && typeof backup.settings === 'object') {
    writeSettings(backup.settings)
  }

  return {
    works: importedWorks,
    vocabulary: Array.isArray(backup.vocabulary) ? backup.vocabulary.length : 0,
  }
}

export function downloadBackupJson(backup, filename) {
  const stamp = new Date().toISOString().slice(0, 10)
  const name = filename || `coach-lecture-sauvegarde-${stamp}.json`
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function readBackupFile(file) {
  const text = await file.text()
  return JSON.parse(text)
}

/**
 * TCF-oriented practice task catalog.
 * Reuses existing library passages + saved works (Mes travaux) — no duplicate content stores.
 */

import { passages } from '../passages.js'
import { listWorks } from './worksDb.js'

/** @typedef {'ee1' | 'ee2' | 'ee3' | 'orale' | 'autre'} TcfCategory */

export const TCF_CATEGORIES = [
  {
    id: 'ee1',
    label: 'Expression Écrite — Tâche 1',
    short: 'EE1',
    description: 'Message court / situation de communication (réemploi de textes courts).',
  },
  {
    id: 'ee2',
    label: 'Expression Écrite — Tâche 2',
    short: 'EE2',
    description: 'Article / essai argumentatif de longueur moyenne.',
  },
  {
    id: 'ee3',
    label: 'Expression Écrite — Tâche 3',
    short: 'EE3',
    description: 'Essai long, registre soutenu (passages B2+ de la bibliothèque).',
  },
  {
    id: 'orale',
    label: 'Expression Orale',
    short: 'Orale',
    description: 'Cartes de prise de parole (sujet + consignes orales).',
  },
  {
    id: 'autre',
    label: 'Autres supports',
    short: 'Autre',
    description: 'Travaux enregistrés (Mes travaux) et textes personnels.',
  },
]

/** Heuristic length bands for mapping library essays → EE tasks. */
function categoryForPassage(passage, index) {
  const len = String(passage?.text || '').length
  // Rotate a few into orale speaking prompts; rest by length.
  if (index % 5 === 0) return 'orale'
  if (len < 900) return 'ee1'
  if (len < 1200) return 'ee2'
  return 'ee3'
}

function oralePromptFromPassage(passage) {
  const topic = passage.topic || 'Société'
  return {
    id: `orale-${passage.id}`,
    sourceType: 'orale-prompt',
    sourceId: passage.id,
    category: 'orale',
    title: `Prise de parole · ${passage.title}`,
    topic,
    /** Text the learner reads aloud (model + shadowing). */
    text: `Sujet : ${topic}. ${passage.title}.\n\nPrésentez le problème en une minute, donnez deux arguments précis, puis proposez une piste concrète. Parlez clairement, avec des liaisons et un rythme naturel.\n\nPoints à couvrir :\n1. Contexte et enjeux\n2. Deux arguments illustrés\n3. Une proposition réaliste\n\nTexte de référence (à lire ou paraphraser) :\n${passage.text}`,
    prompt: `Exposez le sujet « ${passage.title} » à l’oral (2–3 minutes).`,
    solved: true,
  }
}

function libraryTaskFromPassage(passage, index) {
  const category = categoryForPassage(passage, index)
  if (category === 'orale') return oralePromptFromPassage(passage)
  return {
    id: `lib-${passage.id}`,
    sourceType: 'library',
    sourceId: passage.id,
    category,
    title: passage.title,
    topic: passage.topic || '',
    text: passage.text,
    prompt: '',
    solved: true,
  }
}

/**
 * Static TCF-flavoured catalog from the built-in library.
 * @returns {Array<object>}
 */
export function listLibraryTcfTasks() {
  return passages.map((passage, index) => libraryTaskFromPassage(passage, index))
}

/**
 * Saved works become “solved / personal” practice materials (Autre).
 * @returns {Promise<Array<object>>}
 */
export async function listWorkTcfTasks() {
  const works = await listWorks()
  return works.map((work) => ({
    id: `work-${work.id}`,
    sourceType: 'work',
    sourceId: work.id,
    category: 'autre',
    title: work.title || 'Travail sans titre',
    topic: 'Personnel',
    text: work.text,
    prompt: work.note || '',
    solved: true,
    updatedAt: work.updatedAt,
  }))
}

/**
 * Full selectable task list for pronunciation practice.
 * @param {{ category?: TcfCategory | 'all', query?: string }} [opts]
 */
export async function listPracticeTasks(opts = {}) {
  const category = opts.category || 'all'
  const query = String(opts.query || '')
    .trim()
    .toLowerCase()
  const library = listLibraryTcfTasks()
  let works = []
  try {
    works = await listWorkTcfTasks()
  } catch {
    works = []
  }
  let rows = [...library, ...works]
  if (category && category !== 'all') {
    rows = rows.filter((row) => row.category === category)
  }
  if (query) {
    rows = rows.filter((row) => {
      const hay = `${row.title} ${row.topic} ${row.text}`.toLowerCase()
      return hay.includes(query)
    })
  }
  return rows
}

export function getLibraryTaskById(taskId) {
  return listLibraryTcfTasks().find((task) => task.id === taskId) || null
}

export function categoryMeta(categoryId) {
  return TCF_CATEGORIES.find((c) => c.id === categoryId) || null
}

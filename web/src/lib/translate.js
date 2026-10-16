/**
 * Vocabulary lookup: inline FR→EN via MyMemory (Reverso’s API is Cloudflare-blocked
 * from servers/Docker). Always deep-link to Reverso Context so the learner can open
 * real bilingual examples in the browser.
 */

export function reversoContextUrl(word, { from = 'french', to = 'english' } = {}) {
  const q = encodeURIComponent(String(word ?? '').trim())
  return `https://context.reverso.net/translation/${from}-${to}/${q}`
}

async function translateWithMyMemory(text) {
  const url =
    'https://api.mymemory.translated.net/get?langpair=fr|en&q=' + encodeURIComponent(text)

  const response = await fetch(url)
  if (!response.ok) throw new Error(`Traduction a renvoyé ${response.status}`)

  const data = await response.json()
  const translated = String(data?.responseData?.translatedText ?? '').trim()
  const alternatives = []
  if (Array.isArray(data?.matches)) {
    for (const row of data.matches) {
      const alt = String(row?.translation ?? '').trim()
      if (alt && alt.toLowerCase() !== translated.toLowerCase() && !alternatives.includes(alt)) {
        alternatives.push(alt)
      }
      if (alternatives.length >= 4) break
    }
  }
  if (!translated) throw new Error('Traduction vide')
  return { translated, alternatives }
}

/** Attempt Reverso when reachable (rare from Docker); ignore 403. */
async function tryReverso(text) {
  try {
    const response = await fetch('/reverso-translate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        format: 'text',
        from: 'fra',
        to: 'eng',
        input: text,
        options: {
          sentenceSplitter: true,
          origin: 'reversomobile',
          contextResults: true,
          languageDetection: true,
        },
      }),
    })
    if (!response.ok) return null
    const data = await response.json()
    const translated = Array.isArray(data?.translation)
      ? data.translation.join('').trim()
      : typeof data?.translation === 'string'
        ? data.translation.trim()
        : ''
    const alternatives = []
    const context = data?.contextResults?.results ?? []
    if (Array.isArray(context)) {
      for (const row of context.slice(0, 5)) {
        const alt = row?.translation ?? row?.trans
        if (typeof alt === 'string' && alt.trim()) alternatives.push(alt.trim())
      }
    }
    if (!translated && !alternatives.length) return null
    return {
      translated: translated || alternatives[0],
      alternatives: alternatives.filter((a) => a !== translated).slice(0, 4),
      provider: 'reverso',
    }
  } catch {
    return null
  }
}

export async function translateFrenchToEnglish(word) {
  const text = String(word ?? '').trim()
  if (!text) throw new Error('Texte vide')

  const url = reversoContextUrl(text)
  const isPhrase = /\s/.test(text)

  // Full sentences: MyMemory first — more reliable sentence-level FR→EN from Docker.
  // Single words: try Reverso, then fall back to MyMemory.
  const order = isPhrase
    ? ['mymemory', 'reverso']
    : ['reverso', 'mymemory']

  for (const provider of order) {
    if (provider === 'reverso') {
      const fromReverso = await tryReverso(text)
      if (fromReverso?.translated) {
        return {
          source: text,
          translated: fromReverso.translated,
          alternatives: fromReverso.alternatives,
          url,
          provider: 'reverso',
        }
      }
      continue
    }
    try {
      const result = await translateWithMyMemory(text)
      return {
        source: text,
        translated: result.translated,
        alternatives: result.alternatives,
        url,
        provider: 'mymemory',
      }
    } catch {
      // try next
    }
  }

  return {
    source: text,
    translated: '',
    alternatives: [],
    url,
    provider: 'reverso-link',
    note: 'Ouvrez Reverso Context pour la traduction (API bloquée depuis Docker).',
  }
}

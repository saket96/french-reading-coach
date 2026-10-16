/**
 * Translate French → English via Reverso (context-aware), proxied by Vite
 * to avoid browser CORS. Falls back to a Reverso Context URL.
 */
export function reversoContextUrl(word, { from = 'french', to = 'english' } = {}) {
  const q = encodeURIComponent(String(word ?? '').trim())
  return `https://context.reverso.net/translation/${from}-${to}/${q}`
}

export async function translateFrenchToEnglish(word) {
  const text = String(word ?? '').trim()
  if (!text) throw new Error('Mot vide')

  let response
  try {
    response = await fetch('/reverso-translate', {
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
          origin: 'translation.web',
          contextResults: true,
          languageDetection: true,
        },
      }),
    })
  } catch {
    throw new Error('Reverso inaccessible. Vérifiez votre connexion.')
  }

  if (!response.ok) {
    throw new Error(`Reverso a renvoyé ${response.status}`)
  }

  const data = await response.json()
  const translated = Array.isArray(data?.translation)
    ? data.translation.join('').trim()
    : typeof data?.translation === 'string'
      ? data.translation.trim()
      : ''

  const alternatives = []
  const context = data?.contextResults?.results ?? data?.contextResults ?? []
  if (Array.isArray(context)) {
    for (const row of context.slice(0, 5)) {
      const alt = row?.translation ?? row?.trans ?? row?.target
      if (typeof alt === 'string' && alt.trim()) alternatives.push(alt.trim())
    }
  }

  if (!translated && !alternatives.length) throw new Error('Traduction Reverso vide')

  return {
    source: text,
    translated: translated || alternatives[0] || '',
    alternatives: alternatives.filter((a) => a !== translated).slice(0, 4),
    url: reversoContextUrl(text),
  }
}

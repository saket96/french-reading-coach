/**
 * Translate French → English via Google's public gtx endpoint (no API key).
 * Falls back to a Google Translate URL the user can open.
 */
export function googleTranslateUrl(word, { sl = 'fr', tl = 'en' } = {}) {
  const q = encodeURIComponent(word)
  return `https://translate.google.com/?sl=${sl}&tl=${tl}&text=${q}&op=translate`
}

export async function translateFrenchToEnglish(word) {
  const text = String(word ?? '').trim()
  if (!text) throw new Error('Mot vide')

  const url =
    'https://translate.googleapis.com/translate_a/single?client=gtx&sl=fr&tl=en&dt=t&q=' +
    encodeURIComponent(text)

  let response
  try {
    response = await fetch(url)
  } catch {
    throw new Error('Google Translate inaccessible. Vérifiez votre connexion.')
  }

  if (!response.ok) {
    throw new Error(`Google Translate a renvoyé ${response.status}`)
  }

  const data = await response.json()
  const translated = Array.isArray(data?.[0])
    ? data[0]
        .map((part) => part?.[0] ?? '')
        .join('')
        .trim()
    : ''

  if (!translated) throw new Error('Traduction vide')
  return { source: text, translated, url: googleTranslateUrl(text) }
}

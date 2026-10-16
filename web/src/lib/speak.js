/** Speak French text with the best available fr-* system voice. */
export function speakFrench(text, { rate = 0.92 } = {}) {
  if (!text || typeof window === 'undefined' || !window.speechSynthesis) {
    return Promise.reject(new Error('Synthèse vocale indisponible'))
  }

  window.speechSynthesis.cancel()

  return new Promise((resolve, reject) => {
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = 'fr-FR'
    utterance.rate = rate

    const voices = window.speechSynthesis.getVoices()
    const french =
      voices.find(
        (v) =>
          v.lang?.toLowerCase().startsWith('fr') &&
          /thomas|am[eé]lie|audrey|google.*fran[cç]|marie|claire|daniel/i.test(v.name),
      ) || voices.find((v) => v.lang?.toLowerCase().startsWith('fr'))
    if (french) utterance.voice = french

    utterance.onend = () => resolve()
    utterance.onerror = () => reject(new Error('Lecture vocale interrompue'))
    window.speechSynthesis.speak(utterance)
  })
}

export function stopSpeaking() {
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    window.speechSynthesis.cancel()
  }
}

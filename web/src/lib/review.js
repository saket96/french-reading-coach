/**
 * Build a short post-task focus review from alignment + liaison/termination + phonemes.
 */
export function buildFocusReview({
  alignment,
  liaisonSites,
  liaisonIssues,
  terminationIssues,
  pronounceTips,
}) {
  const focuses = []
  const wrongOps = (alignment?.ops ?? []).filter((op) => op.type === 'wrong' || op.type === 'missing')
  const extraOps = (alignment?.ops ?? []).filter((op) => op.type === 'extra')

  if (wrongOps.length) {
    const words = wrongOps
      .map((op) => op.target)
      .filter(Boolean)
      .slice(0, 6)
    focuses.push({
      id: 'words',
      title: 'Mots à retravailler',
      detail: words.length
        ? `Priorité : ${words.join(', ')}. Écoutez le modèle, puis réécoutez ce que vous avez dit.`
        : 'Quelques mots ont divergé du texte.',
      words: wrongOps
        .filter((op) => op.type === 'wrong')
        .map((op) => ({ target: op.target, hyp: op.hyp })),
    })
  }

  if (liaisonIssues?.length) {
    focuses.push({
      id: 'liaison-issues',
      title: 'Liaisons à corriger',
      detail: liaisonIssues
        .slice(0, 4)
        .map((item) => item.tip)
        .join(' '),
      pairs: liaisonIssues.slice(0, 4).map((item) => item.pair),
    })
  } else if (liaisonSites?.length) {
    focuses.push({
      id: 'liaison-practice',
      title: 'Liaisons à soigner',
      detail: `Dans ce passage : ${liaisonSites
        .slice(0, 5)
        .map((s) => `« ${s.left}‿${s.right} »`)
        .join(', ')}. Enchaînez sans pause.`,
      pairs: liaisonSites.slice(0, 5).map((item) => item.pair),
    })
  }

  if (terminationIssues?.length) {
    focuses.push({
      id: 'termination',
      title: 'Terminaisons',
      detail: terminationIssues
        .slice(0, 4)
        .map((item) => item.tip)
        .join(' '),
      words: terminationIssues.slice(0, 4).map((item) => ({
        target: item.word,
        hyp: item.heard,
      })),
    })
  }

  if (pronounceTips?.errors?.length) {
    focuses.push({
      id: 'phonemes',
      title: 'Sons / phonèmes',
      detail: pronounceTips.errors
        .slice(0, 4)
        .map(
          (err) =>
            `« ${err.word} » : attendu /${err.expected}/ → entendu /${err.actual || '—'}/`,
        )
        .join(' · '),
      words: pronounceTips.errors.slice(0, 4).map((err) => ({
        target: err.word,
        hyp: err.actual,
      })),
    })
  }

  if (extraOps.length) {
    focuses.push({
      id: 'extra',
      title: 'Mots en trop',
      detail: `Vous avez ajouté : ${extraOps
        .map((op) => op.hyp)
        .slice(0, 5)
        .join(', ')}. Ralentissez et lisez uniquement le texte affiché.`,
    })
  }

  if (!focuses.length) {
    focuses.push({
      id: 'ok',
      title: 'Bien joué',
      detail:
        'Peu d’écarts sur cette étape. Passez à la suivante, ou réécoutez le modèle pour ancrer le rythme.',
    })
  }

  const score = alignment?.score ?? 0
  const summary =
    score >= 0.9
      ? 'Étape solide — consolidez liaisons et rythme.'
      : score >= 0.7
        ? 'Correct : focalisez les points ci-dessous avant d’avancer.'
        : 'À retravailler : relisez en ciblant les points listés, puis réenregistrez.'

  return { summary, focuses, score }
}

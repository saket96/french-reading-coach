import { tokenizeFrench } from './tokenize.js'

/** Left-side words that usually trigger obligatory / frequent liaison. */
const LIAISON_LEFT = new Set([
  'les',
  'des',
  'aux',
  'mes',
  'tes',
  'ses',
  'nos',
  'vos',
  'leurs',
  'un',
  'tous',
  'toutes',
  'quelques',
  'certains',
  'certaines',
  'nous',
  'vous',
  'ils',
  'elles',
  'on',
  'en',
  'chez',
  'dans',
  'sans',
  'sous',
  'très',
  'plus',
  'moins',
  'bien',
  'quand',
  'dont',
  'est',
  'sont',
  'était',
  'étaient',
  'petit',
  'grande',
  'grand',
  'premier',
  'premiers',
  'première',
  'premières',
])

const SILENT_FINAL = /[tsdxz]$/i
const MUTE_E = /e$/i

function startsWithVowelSound(word) {
  if (!word) return false
  return /^[aeiouyàâäéèêëïîôöùûüœæh]/i.test(word)
}

function findSites(targetWords) {
  const sites = []
  for (let i = 0; i < targetWords.length - 1; i += 1) {
    const left = targetWords[i]
    const right = targetWords[i + 1]
    if (!LIAISON_LEFT.has(left) || !startsWithVowelSound(right)) continue
    sites.push({
      left,
      right,
      pair: `${left} ${right}`,
      tip: `Liaison « ${left}‿${right} » — enchaînez le son final de « ${left} » sans pause.`,
    })
  }
  const seen = new Set()
  return sites.filter((item) => {
    if (seen.has(item.pair)) return false
    seen.add(item.pair)
    return true
  })
}

/**
 * List liaison sites in the target and mark which ones look shaky from the hyp.
 */
export function analyzeLiaisons(targetText, hypText, alignmentOps = []) {
  const target = tokenizeFrench(targetText)
  const sites = findSites(target)
  const problemWords = new Set()
  for (const op of alignmentOps) {
    if (op.type === 'wrong' || op.type === 'missing') {
      if (op.target) problemWords.add(op.target)
    }
  }

  const issues = sites
    .filter((site) => problemWords.has(site.left) || problemWords.has(site.right))
    .map((site) => ({
      ...site,
      tip: `Liaison à revoir autour de « ${site.pair} » (un des mots a divergé). ${site.tip}`,
    }))

  return { sites, issues }
}

/**
 * Flag possible final-sound / termination issues from wrong/missing ops.
 */
export function analyzeTerminations(ops) {
  const issues = []
  for (const op of ops ?? []) {
    if (op.type === 'wrong' && op.target && op.hyp) {
      const target = op.target
      const hyp = op.hyp
      if (target.length - hyp.length >= 2 && target.startsWith(hyp.slice(0, Math.min(3, hyp.length)))) {
        issues.push({
          type: 'termination',
          word: target,
          heard: hyp,
          tip: `Terminaison tronquée : visez la fin de « ${target} » (entendu plutôt « ${hyp} »).`,
        })
      } else if (SILENT_FINAL.test(target) && hyp.length > target.length + 1) {
        issues.push({
          type: 'termination',
          word: target,
          heard: hyp,
          tip: `Attention à la finale de « ${target} » : ne forcez pas une consonne muette hors liaison.`,
        })
      } else if (MUTE_E.test(target) && hyp !== target && /e/i.test(hyp.slice(-2))) {
        issues.push({
          type: 'termination',
          word: target,
          heard: hyp,
          tip: `Finale de « ${target} » — e caduc léger, sans son parasite (entendu « ${hyp} »).`,
        })
      } else if (target.slice(-2) !== hyp.slice(-2) && target.length > 3) {
        issues.push({
          type: 'termination',
          word: target,
          heard: hyp,
          tip: `Finale différente : « ${target} » → entendu « ${hyp} ». Relisez en soignant la terminaison.`,
        })
      }
    }
    if (op.type === 'missing' && op.target && op.target.length > 4) {
      issues.push({
        type: 'termination',
        word: op.target,
        heard: '',
        tip: `Mot manquant « ${op.target} » — articulez bien le début et la fin.`,
      })
    }
  }

  const seen = new Set()
  return issues.filter((item) => {
    const key = `${item.word}|${item.tip}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

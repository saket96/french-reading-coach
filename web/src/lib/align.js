/**
 * French-aware word alignment.
 * - exact match → green
 * - close (accents, genre/nombre, petites variantes ASR) → amber "presque"
 * - wrong / missing → red
 * - extra → gray
 *
 * Soft matching avoids cascading false errors when Whisper drifts slightly.
 */

const ARTICLES = new Map([
  ['le', 'DET'],
  ['la', 'DET'],
  ['les', 'DET'],
  ['l', 'DET'],
  ['un', 'DET'],
  ['une', 'DET'],
  ['des', 'DET'],
  ['du', 'DET'],
  ['de', 'PREP'],
  ['d', 'PREP'],
])

/** Common Whisper FR confusions that are not true reading errors. */
const ASR_NEAR = [
  ["s'est", "c'est"],
  ["s'est", 'ces'],
  ["c'est", 'ces'],
  ['télétravail', 'teletravail'],
  ['réservé', 'reserve'],
  ['réservé', 'reservé'],
  ['imposé', 'impose'],
  ['nuancé', 'nuance'],
]

function foldAccents(word) {
  return String(word ?? '')
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
}

function stripElision(word) {
  const w = String(word ?? '').toLowerCase()
  const m = w.match(/^([lcdjmnstqu]|jusqu|lorsqu|puisqu|quoiqu)'(.+)$/)
  return m ? m[2] : w
}

/** Rough French ending fold for agreement noise (é/ée/és/ées, e/es, …). */
function foldEnding(word) {
  let w = foldAccents(stripElision(word))
  w = w.replace(/ées$/, 'e').replace(/és$/, 'e').replace(/ée$/, 'e').replace(/é$/, 'e')
  w = w.replace(/iques$/, 'ique').replace(/eaux$/, 'eau').replace(/aux$/, 'al')
  w = w.replace(/([^aeiou])s$/, '$1')
  w = w.replace(/e$/, '')
  return w
}

function levenshtein(a, b) {
  const n = a.length
  const m = b.length
  if (!n) return m
  if (!m) return n
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = 0; i <= n; i += 1) dp[i][0] = i
  for (let j = 0; j <= m; j += 1) dp[0][j] = j
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost)
    }
  }
  return dp[n][m]
}

function pairKey(a, b) {
  return [a, b].sort().join('|')
}

const ASR_NEAR_SET = new Set(ASR_NEAR.map(([a, b]) => pairKey(foldAccents(a), foldAccents(b))))

/**
 * @returns {'exact' | 'close' | 'different'}
 */
export function frenchMatchKind(target, hyp) {
  if (!target || !hyp) return 'different'
  if (target === hyp) return 'exact'

  const ft = foldAccents(target)
  const fh = foldAccents(hyp)
  if (ft === fh) return 'close'

  if (ASR_NEAR_SET.has(pairKey(ft, fh))) return 'close'

  // Articles / determiners of the same class (un↔une, le↔la, de↔des)
  if (ARTICLES.has(ft) && ARTICLES.has(fh) && ARTICLES.get(ft) === ARTICLES.get(fh)) {
    return 'close'
  }
  if (
    (ft === 'de' || ft === 'des' || ft === 'du' || ft === 'd') &&
    (fh === 'de' || fh === 'des' || fh === 'du' || fh === 'd')
  ) {
    return 'close'
  }

  const st = foldEnding(target)
  const sh = foldEnding(hyp)
  if (st && sh && st === sh) return 'close'

  // Prefix/suffix containment for compounds / truncations (télétravail ↔ travaille)
  const longer = ft.length >= fh.length ? ft : fh
  const shorter = ft.length >= fh.length ? fh : ft
  if (
    shorter.length >= 5 &&
    (longer.startsWith(shorter) || longer.endsWith(shorter)) &&
    longer.length - shorter.length <= 8
  ) {
    return 'close'
  }

  const dist = levenshtein(ft, fh)
  const maxLen = Math.max(ft.length, fh.length)
  if (maxLen >= 6 && dist <= 2) return 'close'
  if (maxLen >= 4 && dist <= 1) return 'close'

  return 'different'
}

function subCost(target, hyp) {
  const kind = frenchMatchKind(target, hyp)
  if (kind === 'exact') return 0
  if (kind === 'close') return 1 // cheaper than different in integer DP scaled
  return 3
}

/**
 * Word-level alignment with French soft matches.
 * score counts exact + close as successful for the pass threshold.
 */
export function alignWords(targetWords, hypWords) {
  const n = targetWords.length
  const m = hypWords.length
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))

  for (let i = 0; i <= n; i += 1) dp[i][0] = i * 3
  for (let j = 0; j <= m; j += 1) dp[0][j] = j * 3

  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const cost = subCost(targetWords[i - 1], hypWords[j - 1])
      dp[i][j] = Math.min(
        dp[i - 1][j] + 3,
        dp[i][j - 1] + 3,
        dp[i - 1][j - 1] + cost,
      )
    }
  }

  const ops = []
  let i = n
  let j = m
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const kind = frenchMatchKind(targetWords[i - 1], hypWords[j - 1])
      const cost = subCost(targetWords[i - 1], hypWords[j - 1])
      if (dp[i][j] === dp[i - 1][j - 1] + cost) {
        if (kind === 'exact') {
          ops.push({ type: 'match', target: targetWords[i - 1], hyp: hypWords[j - 1] })
        } else if (kind === 'close') {
          ops.push({
            type: 'close',
            target: targetWords[i - 1],
            hyp: hypWords[j - 1],
            tip: 'Presque — accent, genre/nombre, ou variante reconnue par Whisper',
          })
        } else {
          ops.push({ type: 'wrong', target: targetWords[i - 1], hyp: hypWords[j - 1] })
        }
        i -= 1
        j -= 1
        continue
      }
    }
    if (i > 0 && dp[i][j] === dp[i - 1][j] + 3) {
      ops.push({ type: 'missing', target: targetWords[i - 1] })
      i -= 1
    } else if (j > 0 && dp[i][j] === dp[i][j - 1] + 3) {
      ops.push({ type: 'extra', hyp: hypWords[j - 1] })
      j -= 1
    } else if (i > 0 && j > 0) {
      // Fallback diagonal
      const kind = frenchMatchKind(targetWords[i - 1], hypWords[j - 1])
      ops.push({
        type: kind === 'exact' ? 'match' : kind === 'close' ? 'close' : 'wrong',
        target: targetWords[i - 1],
        hyp: hypWords[j - 1],
      })
      i -= 1
      j -= 1
    } else if (i > 0) {
      ops.push({ type: 'missing', target: targetWords[i - 1] })
      i -= 1
    } else {
      ops.push({ type: 'extra', hyp: hypWords[j - 1] })
      j -= 1
    }
  }

  ops.reverse()
  const exact = ops.filter((op) => op.type === 'match').length
  const close = ops.filter((op) => op.type === 'close').length
  const matched = exact + close
  const score = n === 0 ? 0 : matched / n
  const hardWrong = ops.filter((op) => op.type === 'wrong').length
  const asrUnreliable = n > 0 && hardWrong / n > 0.45 && score < 0.4

  return {
    ops,
    matched,
    exact,
    close,
    targetCount: n,
    score,
    asrUnreliable,
  }
}

/** Content-word hard errors worth practising (skip tiny function words when ASR drifted). */
export function practiceErrors(ops, { asrUnreliable = false } = {}) {
  const wrongs = (ops ?? []).filter((op) => op.type === 'wrong' && op.hyp && op.target)
  if (!wrongs.length) return []

  const meaningful = wrongs.filter((op) => {
    const t = op.target
    if (t.length <= 2) return false
    if (ARTICLES.has(foldAccents(t))) return false
    return true
  })

  // If ASR likely failed, only show a short list of the clearest mismatches
  const list = meaningful.length ? meaningful : wrongs
  if (asrUnreliable) return list.slice(0, 6)
  return list.slice(0, 12)
}

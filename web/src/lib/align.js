/**
 * Word-level Levenshtein alignment.
 * match = green, wrong/missing = red, extra = gray
 * score = matched / target word count
 */
export function alignWords(targetWords, hypWords) {
  const n = targetWords.length
  const m = hypWords.length
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))

  for (let i = 0; i <= n; i += 1) dp[i][0] = i
  for (let j = 0; j <= m; j += 1) dp[0][j] = j

  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const subCost = targetWords[i - 1] === hypWords[j - 1] ? 0 : 1
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + subCost,
      )
    }
  }

  const ops = []
  let i = n
  let j = m
  while (i > 0 || j > 0) {
    if (
      i > 0 &&
      j > 0 &&
      dp[i][j] === dp[i - 1][j - 1] &&
      targetWords[i - 1] === hypWords[j - 1]
    ) {
      ops.push({ type: 'match', target: targetWords[i - 1], hyp: hypWords[j - 1] })
      i -= 1
      j -= 1
    } else if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + 1) {
      ops.push({ type: 'wrong', target: targetWords[i - 1], hyp: hypWords[j - 1] })
      i -= 1
      j -= 1
    } else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
      ops.push({ type: 'missing', target: targetWords[i - 1] })
      i -= 1
    } else {
      ops.push({ type: 'extra', hyp: hypWords[j - 1] })
      j -= 1
    }
  }

  ops.reverse()
  const matched = ops.filter((op) => op.type === 'match').length
  const score = n === 0 ? 0 : matched / n
  return { ops, matched, targetCount: n, score }
}

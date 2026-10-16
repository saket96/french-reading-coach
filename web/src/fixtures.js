import { passages } from './passages.js'
import { passageChunks } from './lib/chunks.js'

/** First 2-sentence chunk of télétravail, with deliberate word errors for demos. */
export const FIXTURE_PASSAGE_ID = passages[0].id
export const FIXTURE_CHUNK_INDEX = 0

const firstChunk = passageChunks(passages[0].text, 2)[0]

/** Imperfect reading of the first practice step only. */
export const FIXTURE_TRANSCRIPT = firstChunk
  .replace('privilège', 'privilege')
  .replace('domicile', 'maison')
  .replace(/,/g, '')

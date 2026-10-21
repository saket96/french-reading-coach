/**
 * Extract plain French reading text from PDF / Word uploads in the browser.
 */

const PDF_TYPES = new Set(['application/pdf'])
const DOCX_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
])

/** Collapse OCR/export junk into readable paragraphs for the coach. */
export function normalizeImportedText(raw) {
  return String(raw ?? '')
    .replaceAll('\0', '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

export function detectDocumentKind(file) {
  if (!file) return ''
  const name = String(file.name || '').toLowerCase()
  const type = String(file.type || '').toLowerCase()
  if (name.endsWith('.pdf') || PDF_TYPES.has(type)) return 'pdf'
  if (name.endsWith('.docx') || type.includes('wordprocessingml')) return 'docx'
  // Legacy .doc is not supported by mammoth in the browser
  if (name.endsWith('.doc') || DOCX_TYPES.has(type)) return 'doc'
  return ''
}

function itemX(item) {
  const t = item?.transform
  return Array.isArray(t) && Number.isFinite(t[4]) ? t[4] : 0
}

function itemY(item) {
  const t = item?.transform
  return Array.isArray(t) && Number.isFinite(t[5]) ? t[5] : 0
}

function itemFontSize(item) {
  const t = item?.transform
  if (!Array.isArray(t)) return 12
  const a = Number(t[0]) || 0
  const b = Number(t[1]) || 0
  const size = Math.hypot(a, b)
  return size > 0 ? size : 12
}

/**
 * Rebuild readable text from pdf.js TextContent items using x/y layout
 * so lines and paragraphs keep spacing (not one giant run-on).
 */
export function layoutPdfTextItems(items) {
  const rows = (Array.isArray(items) ? items : []).filter(
    (item) => item && typeof item.str === 'string' && item.str.length > 0,
  )
  if (!rows.length) return ''

  // Reading order: top→bottom (higher y first in PDF space), then left→right.
  const sorted = [...rows].sort((a, b) => {
    const dy = itemY(b) - itemY(a)
    if (Math.abs(dy) > 2) return dy
    return itemX(a) - itemX(b)
  })

  let out = ''
  let prev = null

  for (const item of sorted) {
    const text = item.str
    if (!prev) {
      out = text
      prev = item
      continue
    }

    const prevY = itemY(prev)
    const y = itemY(item)
    const prevX = itemX(prev)
    const x = itemX(item)
    const font = Math.max(itemFontSize(prev), itemFontSize(item), 10)
    const prevWidth = Number.isFinite(item.width) ? item.width : font * 0.5 * String(prev.str).length
    const gapX = x - (prevX + prevWidth)
    const gapY = prevY - y // positive when moving down the page

    const lineThreshold = font * 0.35
    const paragraphThreshold = font * 1.35

    if (gapY > paragraphThreshold) {
      out += '\n\n'
    } else if (gapY > lineThreshold || prev.hasEOL) {
      // New visual line: paragraph break after sentence end, else a word space.
      if (/[.!?…:]$/.test(out.trimEnd())) {
        out = `${out.trimEnd()}\n\n`
      } else if (/[-‑–—]$/.test(out)) {
        // keep hyphenated word join across lines
      } else if (!/\s$/.test(out) && !/^\s/.test(text)) {
        out += ' '
      }
    } else if (gapX > font * 0.12) {
      if (!/\s$/.test(out) && !/^\s/.test(text) && !/^[,.;:!?…)»\]%]/.test(text)) {
        out += ' '
      }
    } else if (gapX < -font * 0.5) {
      // Wrapped line with little y delta — still separate words
      if (!/\s$/.test(out) && !/^\s/.test(text)) out += ' '
    }

    out += text
    prev = item
  }

  return out
}

async function extractPdfText(arrayBuffer) {
  const pdfjs = await import('pdfjs-dist')
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  if (pdfjs.GlobalWorkerOptions) {
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  }

  const loadingTask = pdfjs.getDocument({ data: arrayBuffer })
  const pdf = await loadingTask.promise
  const parts = []
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
    const page = await pdf.getPage(pageNum)
    const content = await page.getTextContent({
      // Keep spaces that the PDF already encodes between glyphs
      disableCombineTextItems: false,
    })
    const pageText = layoutPdfTextItems(content.items)
    if (pageText.trim()) parts.push(pageText.trim())
  }
  try {
    await pdf.destroy?.()
  } catch {
    // ignore
  }
  return parts.join('\n\n')
}

async function extractDocxText(arrayBuffer) {
  const mammoth = await import('mammoth')
  const result = await mammoth.extractRawText({ arrayBuffer })
  return result?.value || ''
}

/**
 * Read a File (PDF or .docx) and return cleaned plain text.
 * @returns {Promise<{ text: string, kind: 'pdf' | 'docx', fileName: string }>}
 */
export async function extractTextFromDocument(file) {
  if (!file) throw new Error('Aucun fichier sélectionné')
  const kind = detectDocumentKind(file)
  if (kind === 'doc') {
    throw new Error(
      'Les fichiers .doc (Word ancien) ne sont pas pris en charge. Enregistrez en .docx ou PDF, ou collez le texte.',
    )
  }
  if (kind !== 'pdf' && kind !== 'docx') {
    throw new Error('Formats acceptés : PDF (.pdf) ou Word (.docx).')
  }

  const arrayBuffer = await file.arrayBuffer()
  const raw = kind === 'pdf' ? await extractPdfText(arrayBuffer) : await extractDocxText(arrayBuffer)
  const text = normalizeImportedText(raw)
  if (!text) {
    throw new Error(
      kind === 'pdf'
        ? 'Aucun texte extractible dans ce PDF (souvent un scan image). Utilisez un PDF texte, ou collez le contenu.'
        : 'Aucun texte trouvé dans ce document Word.',
    )
  }
  return { text, kind, fileName: file.name || 'document' }
}

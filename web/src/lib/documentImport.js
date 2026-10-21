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
    const content = await page.getTextContent()
    const pageText = content.items
      .map((item) => (typeof item?.str === 'string' ? item.str : ''))
      .join(' ')
    if (pageText.trim()) parts.push(pageText)
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

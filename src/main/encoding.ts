import iconv from 'iconv-lite'
import * as chardet from 'chardet'

export interface DecodedBuffer {
  text: string
  encoding: string
  bom: boolean
  binary: boolean
  size: number
}

const BOM_UTF8 = Buffer.from([0xef, 0xbb, 0xbf])
const BOM_UTF16LE = Buffer.from([0xff, 0xfe])
const BOM_UTF16BE = Buffer.from([0xfe, 0xff])

function looksBinary(buf: Buffer): boolean {
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0) return true
  }
  return false
}

function mapDetected(name: string | null): string {
  const enc = (name || '').toUpperCase()
  if (!enc) return 'utf8'
  if (enc.includes('UTF-16LE')) return 'utf16le'
  if (enc.includes('UTF-16BE')) return 'utf16-be'
  if (enc.includes('UTF-8')) return 'utf8'
  if (enc.includes('GB') || enc.includes('2312')) return 'gb18030'
  if (enc.includes('BIG5')) return 'big5'
  if (enc.includes('SHIFT') || enc.includes('SJIS')) return 'shift_jis'
  if (enc.includes('EUC-JP')) return 'euc-jp'
  if (enc.includes('ISO-8859') || enc.includes('WINDOWS-1252') || enc.includes('ASCII')) return 'win1252'
  return 'utf8'
}

export function decodeBuffer(buf: Buffer): DecodedBuffer {
  const size = buf.length

  if (buf.length >= 3 && buf.subarray(0, 3).equals(BOM_UTF8)) {
    return {
      text: buf.subarray(3).toString('utf8'),
      encoding: 'utf8',
      bom: true,
      binary: false,
      size
    }
  }
  if (buf.length >= 2 && buf.subarray(0, 2).equals(BOM_UTF16LE)) {
    return {
      text: iconv.decode(buf.subarray(2), 'utf16le'),
      encoding: 'utf16le',
      bom: true,
      binary: false,
      size
    }
  }
  if (buf.length >= 2 && buf.subarray(0, 2).equals(BOM_UTF16BE)) {
    return {
      text: iconv.decode(buf.subarray(2), 'utf16-be'),
      encoding: 'utf16-be',
      bom: true,
      binary: false,
      size
    }
  }

  if (looksBinary(buf)) {
    return { text: '', encoding: 'binary', bom: false, binary: true, size }
  }

  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buf)
    return { text, encoding: 'utf8', bom: false, binary: false, size }
  } catch {
    /* not valid utf-8 */
  }

  let detected = 'gb18030'
  try {
    detected = mapDetected(chardet.detect(buf))
  } catch {
    detected = 'gb18030'
  }
  if (detected === 'utf8') detected = 'gb18030'

  // Chinese GBK bytes are often misdetected as Shift_JIS: decode all plausible
  // candidates and pick the one that yields the most natural text.
  const candidates = [...new Set([detected, 'gb18030', 'big5', 'shift_jis', 'euc-jp', 'win1252'])]
  let encoding = detected
  let bestScore = Number.NEGATIVE_INFINITY
  for (const candidate of candidates) {
    let text = ''
    try {
      text = iconv.decode(buf, candidate)
    } catch {
      continue
    }
    let score = textScore(text)
    if (candidate === detected) score += 1
    if (candidate === 'gb18030' && /[一-鿿]/.test(text)) {
      // Mainland Chinese files are commonly GBK/GB18030, which is often
      // ambiguous with Big5/Shift_JIS. Prefer GB18030 when CJK is present.
      score += 3
    } else if (candidate === 'big5' && /[一-鿿]/.test(text)) {
      score += 1
    }
    if (score > bestScore) {
      bestScore = score
      encoding = candidate
    }
  }

  const text = iconv.decode(buf, encoding)
  return { text, encoding, bom: false, binary: false, size }
}

function textScore(text: string): number {
  let score = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    if (code === 0xfffd) score -= 25
    else if (code >= 0xff61 && code <= 0xff9f) score -= 4 // half-width katakana
    else if (code >= 0x3040 && code <= 0x30ff) score += 2 // kana
    else if (code >= 0x4e00 && code <= 0x9fff) score += 3 // CJK ideographs
    else if (code >= 0x3000 && code <= 0x303f) score += 1 // CJK punctuation
    else if (code >= 0xc0 && code <= 0xff && code !== 0xd7 && code !== 0xf7) score += 1 // latin-1 letters
    else if (code >= 0x80 && code <= 0x9f) score -= 3 // C1 controls
    else if (code < 0x20 && code !== 9 && code !== 10 && code !== 13) score -= 5
  }
  return score
}

const LOSSY_CHECK_ENCODINGS = new Set(['gb18030', 'big5', 'shift_jis', 'euc-jp', 'win1252'])

export function encodeTextChecked(text: string, encoding: string, bom: boolean): Buffer {
  const data = encodeText(text, encoding, bom)
  if (LOSSY_CHECK_ENCODINGS.has(encoding) && iconv.decode(data, encoding) !== text) {
    throw new Error(
      `当前编码（${encoding.toUpperCase()}）无法无损保存该文件，请先另存为 UTF-8 或移除不支持的字符`
    )
  }
  return data
}

export function encodeText(text: string, encoding: string, bom: boolean): Buffer {
  let body: Buffer
  if (encoding === 'utf8') {
    body = Buffer.from(text, 'utf8')
  } else {
    body = iconv.encode(text, encoding)
  }
  if (!bom) return body
  if (encoding === 'utf8') return Buffer.concat([BOM_UTF8, body])
  if (encoding === 'utf16le') return Buffer.concat([BOM_UTF16LE, body])
  if (encoding === 'utf16-be') return Buffer.concat([BOM_UTF16BE, body])
  return body
}

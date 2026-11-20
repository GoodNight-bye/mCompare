import { describe, expect, it } from 'vitest'
import iconv from 'iconv-lite'
import { decodeBuffer, encodeText, encodeTextChecked } from './encoding'

describe('decodeBuffer', () => {
  it('decodes plain UTF-8 and ASCII', () => {
    expect(decodeBuffer(Buffer.from('hello\n', 'utf8'))).toMatchObject({
      text: 'hello\n',
      encoding: 'utf8',
      bom: false,
      binary: false
    })
    expect(decodeBuffer(Buffer.from('中文 UTF-8\n', 'utf8'))).toMatchObject({
      text: '中文 UTF-8\n',
      encoding: 'utf8',
      bom: false
    })
  })

  it('strips a UTF-8 BOM and reports it', () => {
    const result = decodeBuffer(Buffer.from('﻿中文\n', 'utf8'))
    expect(result.text).toBe('中文\n')
    expect(result.encoding).toBe('utf8')
    expect(result.bom).toBe(true)
    expect(result.size).toBe(10)
  })

  it('decodes UTF-16LE and UTF-16BE with BOM', () => {
    const le = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      iconv.encode('中文 LE\n', 'utf16le')
    ])
    expect(decodeBuffer(le)).toMatchObject({
      text: '中文 LE\n',
      encoding: 'utf16le',
      bom: true
    })

    const be = Buffer.concat([
      Buffer.from([0xfe, 0xff]),
      iconv.encode('中文 BE\n', 'utf16-be')
    ])
    expect(decodeBuffer(be)).toMatchObject({
      text: '中文 BE\n',
      encoding: 'utf16-be',
      bom: true
    })
  })

  it('detects GBK Chinese instead of Shift_JIS', () => {
    const buf = iconv.encode('中文 GBK 测试\n第二行\n', 'gb18030')
    const result = decodeBuffer(buf)
    expect(result.binary).toBe(false)
    expect(result.text).toBe('中文 GBK 测试\n第二行\n')
    expect(result.encoding).toBe('gb18030')
  })

  it('marks NUL-containing data as binary', () => {
    expect(decodeBuffer(Buffer.from([0x41, 0x00, 0x42]))).toMatchObject({
      binary: true,
      text: ''
    })
  })

  it('handles empty and BOM-only files', () => {
    expect(decodeBuffer(Buffer.alloc(0))).toMatchObject({
      text: '',
      encoding: 'utf8',
      binary: false,
      size: 0
    })
    expect(decodeBuffer(Buffer.from([0xef, 0xbb, 0xbf]))).toMatchObject({
      text: '',
      bom: true,
      binary: false
    })
  })
})

describe('encodeText', () => {
  it('round-trips UTF-8 with BOM', () => {
    const buf = encodeText('中文\n', 'utf8', true)
    expect(buf.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]))
    expect(decodeBuffer(buf)).toMatchObject({
      text: '中文\n',
      encoding: 'utf8',
      bom: true
    })
  })

  it('round-trips UTF-16LE/BE with BOM', () => {
    const le = encodeText('中文 LE', 'utf16le', true)
    expect(le.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xfe]))
    expect(decodeBuffer(le).text).toBe('中文 LE')

    const be = encodeText('中文 BE', 'utf16-be', true)
    expect(be.subarray(0, 2)).toEqual(Buffer.from([0xfe, 0xff]))
    expect(decodeBuffer(be).text).toBe('中文 BE')
  })

  it('round-trips GB18030 without BOM', () => {
    const buf = encodeText('中文 GBK', 'gb18030', false)
    expect(buf[0]).not.toBe(0xef)
    expect(decodeBuffer(buf).text).toBe('中文 GBK')
  })
})

 describe('encodeTextChecked', () => {
  it('allows lossless GB18030 text', () => {
    expect(() => encodeTextChecked('中文 GBK', 'gb18030', false)).not.toThrow()
  })

  it('rejects characters not representable in the target encoding', () => {
    expect(() => encodeTextChecked('emoji 😀', 'win1252', false)).toThrow(/无法无损/)
  })

  it('allows UTF-8 for any Unicode text', () => {
    expect(() => encodeTextChecked('emoji 😀', 'utf8', true)).not.toThrow()
  })
})

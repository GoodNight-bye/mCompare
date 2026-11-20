import { describe, expect, it } from 'vitest'
import type { ConnectionView, Location } from '../../shared/types'
import {
  displayLocationInput,
  joinLocation,
  joinLocationPath,
  locKey,
  resolveLocationInput,
  sameLocation,
  splitMasks,
  tabLabel
} from './utils'

const connections: ConnectionView[] = [
  {
    id: 'c1',
    name: 'dev',
    host: '192.0.2.10',
    port: 22,
    username: 'alice',
    hasPassword: true
  },
  {
    id: 'c2',
    name: 'other',
    host: 'server2',
    port: 2222,
    username: 'root',
    hasPassword: true
  }
]

const remote = (connectionId: string, path: string): Location => ({
  kind: 'remote',
  connectionId,
  path
})

describe('resolveLocationInput', () => {
  it('parses scp-like paths with optional user and port', () => {
    expect(resolveLocationInput('192.0.2.10:/home/alice/x', connections, null)).toEqual({
      location: remote('c1', '/home/alice/x')
    })
    expect(
      resolveLocationInput('alice@192.0.2.10:/home/alice/x', connections, null)
    ).toEqual({ location: remote('c1', '/home/alice/x') })
    expect(resolveLocationInput('root@server2:2222:/home/x', connections, null)).toEqual({
      location: remote('c2', '/home/x')
    })
  })

  it('parses ssh:// URLs and decodes the pathname', () => {
    expect(resolveLocationInput('ssh://root@server2:2222/home/a%20b', connections, null)).toEqual({
      location: remote('c2', '/home/a b')
    })
    expect(resolveLocationInput('ssh://192.0.2.10', connections, null)).toEqual({
      location: remote('c1', '/')
    })
  })

  it('reports malformed or unknown SSH targets', () => {
    const malformed = resolveLocationInput('ssh://[bad', connections, null)
    expect(malformed.error).toContain('无效的 SSH 地址')
    const unknown = resolveLocationInput('unknown:/home/x', connections, null)
    expect(unknown.error).toContain('未找到 unknown')
    expect(resolveLocationInput('192.0.2.10:/home/x', [], null).error).toContain(
      '未找到'
    )
  })

  it('keeps Windows drives and UNC paths local even when a remote is current', () => {
    const current = remote('c1', '/')
    expect(resolveLocationInput('C:\\work\\a.ts', connections, current)).toEqual({
      location: { kind: 'local', path: 'C:\\work\\a.ts' }
    })
    expect(resolveLocationInput('d:/work/a.ts', connections, current)).toEqual({
      location: { kind: 'local', path: 'd:/work/a.ts' }
    })
    expect(resolveLocationInput('\\\\server\\share\\a', connections, current)).toEqual({
      location: { kind: 'local', path: '\\\\server\\share\\a' }
    })
  })

  it('keeps the current remote connection for bare absolute paths', () => {
    expect(resolveLocationInput('/home/x', connections, remote('c1', '/home'))).toEqual({
      location: remote('c1', '/home/x')
    })
  })

  it('falls back to a local path with no remote context', () => {
    expect(resolveLocationInput('/home/x', connections, null)).toEqual({
      location: { kind: 'local', path: '/home/x' }
    })
  })

  it('trims quotes and rejects empty input', () => {
    expect(resolveLocationInput('  "C:\\a b\\c.ts"  ', connections, null)).toEqual({
      location: { kind: 'local', path: 'C:\\a b\\c.ts' }
    })
    expect(resolveLocationInput("'192.0.2.10:/home/x'", connections, null)).toEqual({
      location: remote('c1', '/home/x')
    })
    expect(resolveLocationInput('   ', connections, null).error).toBe('路径不能为空')
  })

  it('currently rejects home/relative remote paths in matchRemote', () => {
    expect(resolveLocationInput('alice@192.0.2.10:~/repo', connections, null).error).toContain(
      '绝对路径'
    )
    expect(resolveLocationInput('alice@192.0.2.10:./repo', connections, null).error).toContain(
      '绝对路径'
    )
  })
})

describe('location helpers', () => {
  it('displays local and SSH-native locations', () => {
    expect(displayLocationInput(null, connections)).toBe('')
    expect(displayLocationInput({ kind: 'local', path: 'C:\\a' }, connections)).toBe(
      'C:\\a'
    )
    expect(displayLocationInput(remote('c1', '/home/x'), connections)).toBe(
      'alice@192.0.2.10:/home/x'
    )
    expect(displayLocationInput(remote('c2', '/home/x'), connections)).toBe(
      'root@server2:2222:/home/x'
    )
    expect(displayLocationInput(remote('missing', '/home/x'), connections)).toBe('/home/x')
  })

  it('joins paths for local and remote locations', () => {
    expect(joinLocationPath({ kind: 'local', path: 'C:\\root\\' }, 'a/b')).toBe(
      'C:\\root\\a\\b'
    )
    expect(joinLocationPath(remote('c1', '/home/x/'), '/a/b')).toBe('/home/x/a/b')
    expect(joinLocation(remote('c1', '/'), 'a')).toEqual(remote('c1', '/a'))
    expect(joinLocation({ kind: 'local', path: 'D:/x' }, 'a')).toEqual({
      kind: 'local',
      path: 'D:/x\\a'
    })
  })

  it('compares and keys locations', () => {
    expect(locKey(null)).toBe('')
    expect(locKey({ kind: 'local', path: 'C:\\A' })).toBe('L:C:\\A')
    expect(locKey(remote('c1', '/x'))).toBe('R:c1:/x')
    expect(sameLocation(remote('c1', '/x'), remote('c1', '/x'))).toBe(true)
    expect(sameLocation(remote('c1', '/x'), remote('c2', '/x'))).toBe(false)
    expect(sameLocation(null, null)).toBe(true)
    expect(sameLocation(null, { kind: 'local', path: 'a' })).toBe(false)
  })

  it('normalizes filter masks', () => {
    expect(splitMasks('*.ts, ./src/;node_modules\n*.ts')).toEqual([
      '*.ts',
      'src',
      'node_modules'
    ])
    expect(splitMasks('   ')).toEqual([])
  })

  it('labels tabs', () => {
    expect(tabLabel({ id: '1', kind: 'file', left: null, right: null, view: 'auto' })).toBe(
      '新建文件对比'
    )
    expect(tabLabel({ id: '1', kind: 'folder', left: null, right: null })).toBe(
      '新建文件夹对比'
    )
    expect(
      tabLabel({
        id: '1',
        kind: 'file',
        left: { kind: 'local', path: 'C:\\a\\x.ts' },
        right: { kind: 'local', path: 'C:/b/y.ts' },
        view: 'auto'
      })
    ).toBe('x.ts ↔ y.ts')
  })
})

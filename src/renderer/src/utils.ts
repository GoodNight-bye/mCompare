import type { ConnectionView, Location } from '../../shared/types'
import { normalizeGlobPatterns } from '../../shared/globs'
import type { TabModel } from './tabs'

export function locKey(loc: Location | null): string {
  if (!loc) return ''
  return loc.kind === 'local' ? `L:${loc.path}` : `R:${loc.connectionId}:${loc.path}`
}

export function basename(p: string): string {
  const parts = p.split(/[\\/]/)
  const last = parts[parts.length - 1]
  return last || p
}

export function locationLabel(loc: Location | null, connections: ConnectionView[]): string {
  if (!loc) return '未选择'
  if (loc.kind === 'local') return loc.path
  const conn = connections.find((c) => c.id === loc.connectionId)
  return `${conn ? `${conn.username}@${conn.host}` : 'remote'}:${loc.path}`
}

export function locationShort(loc: Location | null, connections: ConnectionView[]): string {
  if (!loc) return '未选择'
  if (loc.kind === 'local') return loc.path
  const conn = connections.find((c) => c.id === loc.connectionId)
  return `${conn ? conn.name : 'remote'}:${loc.path}`
}

export function sameLocation(a: Location | null, b: Location | null): boolean {
  if (!a || !b) return a === b
  if (a.kind !== b.kind) return false
  if (a.kind === 'local') return a.path === b.path
  if (b.kind !== 'remote') return false
  return a.connectionId === b.connectionId && a.path === b.path
}

/**
 * Text shown in the editable location field.
 * Remote locations use the native scp-like form: user@host:/path
 */
export function displayLocationInput(
  loc: Location | null,
  connections: ConnectionView[]
): string {
  if (!loc) return ''
  if (loc.kind === 'local') return loc.path
  const conn = connections.find((item) => item.id === loc.connectionId)
  if (!conn) return loc.path
  const portPart = conn.port && conn.port !== 22 ? `:${conn.port}` : ''
  return `${conn.username}@${conn.host}${portPart}:${loc.path}`
}

export interface LocationParseResult {
  location?: Location
  error?: string
}

function matchRemote(
  host: string,
  port: number,
  username: string | undefined,
  remotePath: string,
  connections: ConnectionView[]
): LocationParseResult {
  if (!remotePath.startsWith('/')) {
    return { error: '远端路径请使用绝对路径，例如 /home/user/code' }
  }
  const candidates = connections.filter(
    (conn) =>
      conn.host.toLowerCase() === host.toLowerCase() &&
      conn.port === port &&
      (!username || conn.username.toLowerCase() === username.toLowerCase())
  )
  if (candidates.length === 0) {
    const label = `${username ? username + '@' : ''}${host}${port !== 22 ? ':' + port : ''}`
    return {
      error: `未找到 ${label} 对应的 SSH 连接，请先在“SSH 连接管理”中保存该服务器`
    }
  }
  return {
    location: { kind: 'remote', connectionId: candidates[0].id, path: remotePath }
  }
}

/**
 * Accepts local paths as well as pasted SSH paths:
 *   /home/user/repo
 *   192.0.2.10:/home/user/repo
 *   user@192.0.2.10:/home/user/repo
 *   user@192.0.2.10:2222:/home/user/repo
 *   ssh://user@host:2222/home/user/repo
 */
export function resolveLocationInput(
  raw: string,
  connections: ConnectionView[],
  current: Location | null
): LocationParseResult {
  let input = raw.trim()
  if (
    (input.startsWith('"') && input.endsWith('"')) ||
    (input.startsWith("'") && input.endsWith("'"))
  ) {
    input = input.slice(1, -1).trim()
  }
  if (!input) return { error: '路径不能为空' }

  if (/^ssh:\/\//i.test(input)) {
    try {
      const url = new URL(input)
      const remotePath = decodeURIComponent(url.pathname) || '/'
      return matchRemote(
        url.hostname,
        url.port ? Number(url.port) : 22,
        url.username || undefined,
        remotePath,
        connections
      )
    } catch {
      return { error: '无效的 SSH 地址' }
    }
  }

  // Windows drive and UNC paths are always local.
  if (/^[a-zA-Z]:[\\/]/.test(input) || /^\\\\/.test(input)) {
    return { location: { kind: 'local', path: input } }
  }

  const scpLike = input.match(/^(?:([^@\s:]+)@)?([^@\s:/]+)(?::(\d+))?:(.+)$/)
  if (
    scpLike &&
    (scpLike[4].startsWith('/') || scpLike[4].startsWith('~') || scpLike[4].startsWith('.'))
  ) {
    return matchRemote(
      scpLike[2],
      scpLike[3] ? Number(scpLike[3]) : 22,
      scpLike[1] || undefined,
      scpLike[4],
      connections
    )
  }

  // Typing only the path part keeps the current SSH connection.
  if (
    current?.kind === 'remote' &&
    (input.startsWith('/') || input.startsWith('~') || input.startsWith('.'))
  ) {
    return {
      location: { kind: 'remote', connectionId: current.connectionId, path: input }
    }
  }

  return { location: { kind: 'local', path: input } }
}

export function splitMasks(text: string): string[] {
  return normalizeGlobPatterns([text])
}

export function joinLocation(loc: Location, relPath: string): Location {
  const path = joinLocationPath(loc, relPath)
  return loc.kind === 'local'
    ? { kind: 'local', path }
    : { kind: 'remote', connectionId: loc.connectionId, path }
}

export function joinLocationPath(loc: Location, relPath: string): string {
  const base = loc.path.replace(/[\\/]+$/, '')
  const rel = relPath.replace(/^\/+/, '').replace(/\//g, loc.kind === 'local' ? '\\' : '/')
  return (base === '' && loc.kind === 'remote' ? '' : base) + (loc.kind === 'remote' ? '/' : '\\') + rel
}

export function tabLabel(tab: TabModel): string {
  const left = tab.left ? basename(tab.left.path) : '未选择'
  const right = tab.right ? basename(tab.right.path) : '未选择'
  const which = tab.kind === 'file' ? '文件' : '文件夹'
  if (!tab.left && !tab.right) return `新建${which}对比`
  return `${left} ↔ ${right}`
}

export function formatSize(size: number | undefined): string {
  if (size === undefined || size === null) return ''
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`
  return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export function formatTime(ms: number | undefined): string {
  if (!ms) return ''
  const d = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function errText(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}


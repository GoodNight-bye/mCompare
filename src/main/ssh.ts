import { app, dialog, safeStorage } from 'electron'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { readJsonFile, writeJsonFileAtomic } from './jsonStore'
import { Client, type SFTPWrapper, type FileEntry } from 'ssh2'
import type { ConnectionInput, ConnectionView, RemoteEntry } from '../shared/types'
import { MAX_SCAN_DEPTH, type BufferResult, type SideEntry, type WalkOptions } from './local'

interface StoredConnection {
  id: string
  name: string
  host: string
  port: number
  username: string
  passwordSecret?: string
  hostKey?: string
}

interface Session {
  client: Client
  sftp: SFTPWrapper
  alive: boolean
}

type AttrType = 'dir' | 'file' | 'link' | 'other'

function attrType(mode: number, longname?: string): AttrType {
  const bits = mode & 0o170000
  if (bits === 0o040000) return 'dir'
  if (bits === 0o100000) return 'file'
  if (bits === 0o120000) return 'link'
  // Some SFTP servers don't report type bits in mode; fall back to longname.
  if (longname) {
    if (longname.startsWith('d')) return 'dir'
    if (longname.startsWith('-')) return 'file'
    if (longname.startsWith('l')) return 'link'
  }
  return 'other'
}

function rjoin(base: string, rel: string): string {
  if (!rel) return base
  const b = base.replace(/\/+$/, '')
  const r = rel.replace(/^\/+/, '')
  return (b === '' ? '/' : b + '/') + r
}

function rdirname(p: string): string {
  const idx = p.lastIndexOf('/')
  if (idx <= 0) return '/'
  return p.slice(0, idx)
}

export class SshManager {
  private connections: StoredConnection[] = []
  private sessions = new Map<string, Session>()
  private sessionPromises = new Map<string, Promise<Session>>()
  private readonly storePath: string

  constructor() {
    this.storePath = path.join(app.getPath('userData'), 'connections.json')
    this.load()
  }

  private load(): void {
    const parsed = readJsonFile<{ connections?: StoredConnection[] }>(this.storePath)
    this.connections = Array.isArray(parsed?.connections) ? parsed.connections : []
  }

  private persist(): void {
    writeJsonFileAtomic(this.storePath, { connections: this.connections })
  }

  private seal(password: string): string {
    try {
      if (safeStorage.isEncryptionAvailable()) {
        return 'enc:' + safeStorage.encryptString(password).toString('base64')
      }
    } catch {
      /* fall through */
    }
    return 'b64:' + Buffer.from(password, 'utf8').toString('base64')
  }

  private unseal(secret?: string): string {
    if (!secret) return ''
    try {
      if (secret.startsWith('enc:')) {
        return safeStorage.decryptString(Buffer.from(secret.slice(4), 'base64'))
      }
      if (secret.startsWith('b64:')) {
        return Buffer.from(secret.slice(4), 'base64').toString('utf8')
      }
    } catch {
      return ''
    }
    return ''
  }

  private toView(c: StoredConnection): ConnectionView {
    return {
      id: c.id,
      name: c.name || `${c.username}@${c.host}`,
      host: c.host,
      port: c.port,
      username: c.username,
      hasPassword: Boolean(c.passwordSecret)
    }
  }

  list(): ConnectionView[] {
    return this.connections.map((c) => this.toView(c))
  }

  save(input: ConnectionInput): ConnectionView {
    const host = input.host.trim()
    const username = input.username.trim()
    if (!host || !username) throw new Error('主机和用户名不能为空')
    const port = Number(input.port) || 22
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('端口必须是 1-65535 的整数')
    }
    let item = input.id ? this.connections.find((c) => c.id === input.id) : undefined
    if (!item) {
      item = {
        id: crypto.randomUUID(),
        name: input.name.trim() || `${username}@${host}`,
        host,
        port,
        username
      }
      this.connections.push(item)
    } else {
      const endpointChanged = item.host !== host || item.port !== port
      const credentialChanged =
        item.username !== username || (input.password !== undefined && input.password !== '')
      if (endpointChanged || credentialChanged) {
        this.closeSession(item.id)
      }
      if (endpointChanged) {
        // Host key and password belong to the old endpoint; require fresh
        // verification/credentials instead of silently reusing them.
        item.hostKey = undefined
        if (!input.password) item.passwordSecret = undefined
      }
      item.name = input.name.trim() || `${username}@${host}`
      item.host = host
      item.port = port
      item.username = username
    }
    if (input.password !== undefined && input.password !== '') {
      item.passwordSecret = this.seal(input.password)
    }
    this.persist()
    return this.toView(item)
  }

  private closeSession(id: string): void {
    this.sessionPromises.delete(id)
    const session = this.sessions.get(id)
    if (!session) return
    session.alive = false
    try {
      session.client.end()
    } catch {
      /* ignore */
    }
    this.sessions.delete(id)
  }

  async remove(id: string): Promise<void> {
    this.closeSession(id)
    this.connections = this.connections.filter((c) => c.id !== id)
    this.persist()
  }

  disconnectAll(): void {
    this.sessionPromises.clear()
    for (const session of this.sessions.values()) {
      try {
        session.client.end()
      } catch {
        /* ignore */
      }
    }
    this.sessions.clear()
  }

  private async connectWith(config: {
    host: string
    port: number
    username: string
    password: string
    expectedFingerprint?: string
    onTrustFingerprint?: (fingerprint: string) => void
  }): Promise<Client> {
    const client = new Client()
    await new Promise<void>((resolve, reject) => {
      let settled = false
      client.on('keyboard-interactive', (_n, _i, _l, _p, finish) => finish([config.password]))
      client.once('ready', () => {
        settled = true
        resolve()
      })
      client.once('error', (err) => {
        if (!settled) {
          settled = true
          reject(err)
        }
      })
      client.connect({
        host: config.host,
        port: config.port,
        username: config.username,
        password: config.password,
        readyTimeout: 20000,
        keepaliveInterval: 15000,
        keepaliveCountMax: 3,
        tryKeyboard: true,
        hostHash: 'sha256',
        hostVerifier: (fingerprint: string): boolean => {
          if (!fingerprint) return false
          if (config.expectedFingerprint) {
            if (config.expectedFingerprint === fingerprint) return true
            dialog.showMessageBoxSync({
              type: 'error',
              title: 'SSH 主机密钥不匹配',
              message: `连接到 ${config.host}:${config.port} 的主机密钥与已保存的不一致。`,
              detail: `已保存: ${config.expectedFingerprint}\n当前:   ${fingerprint}\n\n这可能是服务器重装，也可能是中间人攻击。已阻止连接。`,
              buttons: ['知道了']
            })
            return false
          }
          const response = dialog.showMessageBoxSync({
            type: 'warning',
            title: '验证 SSH 主机密钥',
            message: `首次连接到 ${config.host}:${config.port}`,
            detail: `SHA256 指纹: ${fingerprint}\n\n请确认该指纹与服务器管理员提供的值一致。信任后连接信息会保存在本机。`,
            buttons: ['信任并连接', '取消'],
            defaultId: 0,
            cancelId: 1,
            noLink: true
          })
          if (response !== 0) return false
          config.onTrustFingerprint?.(fingerprint)
          return true
        }
      })
    })
    client.on('error', () => {
      /* keep process alive; session close is handled below */
    })
    return client
  }

  async test(input: ConnectionInput): Promise<void> {
    const host = input.host.trim()
    const username = input.username.trim()
    const port = Number(input.port) || 22
    const stored = input.id
      ? this.connections.find((connection) => connection.id === input.id)
      : undefined
    const endpointMatches =
      Boolean(stored) &&
      stored!.host === host &&
      stored!.port === port &&
      stored!.username === username
    const password = input.password || (endpointMatches ? this.unseal(stored!.passwordSecret) : '')
    if (!password) {
      throw new Error(endpointMatches ? '请输入密码' : '主机或用户名已改变，请重新输入密码')
    }
    const client = await this.connectWith({
      host,
      port,
      username,
      password,
      expectedFingerprint: endpointMatches ? stored!.hostKey : undefined,
      onTrustFingerprint: endpointMatches
        ? (fingerprint) => {
            stored!.hostKey = fingerprint
            this.persist()
          }
        : undefined
    })
    client.end()
  }

  private async getSession(id: string): Promise<Session> {
    const existing = this.sessions.get(id)
    if (existing?.alive) return existing
    const pending = this.sessionPromises.get(id)
    if (pending) return pending
    const promise = this.createSession(id)
    this.sessionPromises.set(id, promise)
    try {
      return await promise
    } finally {
      if (this.sessionPromises.get(id) === promise) this.sessionPromises.delete(id)
    }
  }

  private async createSession(id: string): Promise<Session> {
    const cfg = this.connections.find((c) => c.id === id)
    if (!cfg) throw new Error('连接不存在，可能已被删除')
    const password = this.unseal(cfg.passwordSecret)
    if (!password) throw new Error(`连接 ${cfg.name} 缺少密码，请编辑连接并重新输入`)
    const expectedPasswordSecret = cfg.passwordSecret
    const client = await this.connectWith({
      host: cfg.host,
      port: cfg.port,
      username: cfg.username,
      password,
      expectedFingerprint: cfg.hostKey,
      onTrustFingerprint: (fingerprint) => {
        const current = this.connections.find((c) => c.id === id)
        if (current === cfg) {
          cfg.hostKey = fingerprint
          this.persist()
        }
      }
    })
    let sftp: SFTPWrapper
    try {
      sftp = await new Promise<SFTPWrapper>((resolve, reject) => {
        client.sftp((err, wrapper) => (err ? reject(err) : resolve(wrapper)))
      })
    } catch (error) {
      client.end()
      throw error
    }
    const current = this.connections.find((c) => c.id === id)
    if (!current || current.passwordSecret !== expectedPasswordSecret) {
      client.end()
      throw new Error('连接配置已改变，请重试')
    }
    const session: Session = { client, sftp, alive: true }
    client.on('close', () => {
      session.alive = false
      if (this.sessions.get(id) === session) this.sessions.delete(id)
    })
    this.sessions.set(id, session)
    return session
  }

  private async getSftp(id: string): Promise<SFTPWrapper> {
    return (await this.getSession(id)).sftp
  }

  async remoteList(id: string, dir: string): Promise<RemoteEntry[]> {
    const sftp = await this.getSftp(id)
    const target = dir || '/'
    const list = await new Promise<FileEntry[]>((resolve, reject) => {
      sftp.readdir(target, (err, entries) => (err ? reject(err) : resolve(entries)))
    })
    const out: RemoteEntry[] = []
    for (const entry of list) {
      if (entry.filename === '.' || entry.filename === '..') continue
      const type = attrType(entry.attrs.mode, entry.longname)
      if (type !== 'dir' && type !== 'file') continue
      out.push({
        name: entry.filename,
        path: rjoin(target, entry.filename),
        type,
        size: entry.attrs.size,
        mtimeMs: entry.attrs.mtime * 1000
      })
    }
    out.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    })
    return out
  }

  private async statRemote(id: string, p: string): Promise<{ size: number; dir: boolean }> {
    const sftp = await this.getSftp(id)
    const stats = await new Promise<{ size: number; dir: boolean }>((resolve, reject) => {
      sftp.stat(p, (err, st) => {
        if (err) reject(err)
        else resolve({ size: st.size, dir: st.isDirectory() })
      })
    })
    return stats
  }

  async remoteStat(id: string, p: string): Promise<{ type: 'file' | 'dir'; size: number }> {
    const info = await this.statRemote(id, p)
    return { type: info.dir ? 'dir' : 'file', size: info.size }
  }

  async readRemoteHead(id: string, filePath: string, limit: number): Promise<BufferResult> {
    const info = await this.statRemote(id, filePath)
    if (info.dir) throw new Error('不是文件: ' + filePath)
    const size = info.size
    if (size === 0) return { buf: Buffer.alloc(0), truncated: false, size: 0 }
    const sftp = await this.getSftp(id)
    const readLimit = Math.min(size, limit)
    const buf = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = []
      let total = 0
      let finished = false
      const finish = (): void => {
        if (finished) return
        finished = true
        resolve(Buffer.concat(chunks).subarray(0, readLimit))
      }
      const stream = sftp.createReadStream(filePath, { start: 0, end: readLimit - 1 })
      stream.on('data', (chunk: Buffer) => {
        if (total >= readLimit) return
        const remain = readLimit - total
        const part = chunk.length > remain ? chunk.subarray(0, remain) : chunk
        chunks.push(Buffer.from(part))
        total += part.length
      })
      stream.on('end', finish)
      stream.on('error', reject)
    })
    return { buf, truncated: size > limit, size }
  }

  async readRemoteBuffer(id: string, filePath: string, maxBytes: number): Promise<Buffer> {
    const result = await this.readRemoteHead(id, filePath, maxBytes)
    return result.buf
  }

  async writeRemoteText(id: string, filePath: string, data: Buffer): Promise<void> {
    const sftp = await this.getSftp(id)
    await this.ensureRemoteDir(id, rdirname(filePath))
    await new Promise<void>((resolve, reject) => {
      sftp.writeFile(filePath, data, (err) => (err ? reject(err) : resolve()))
    })
  }

  async ensureRemoteDir(id: string, dir: string): Promise<void> {
    if (!dir || dir === '/' || dir === '.') return
    const sftp = await this.getSftp(id)
    const absolute = dir.startsWith('/')
    const parts = dir.split('/').filter(Boolean)
    let cur = absolute ? '' : '.'
    for (const part of parts) {
      cur = cur === '' ? '/' + part : cur === '.' ? part : cur + '/' + part
      const exists = await new Promise<boolean>((resolve) => {
        sftp.stat(cur, (err, st) => {
          if (err) resolve(false)
          else resolve(st.isDirectory())
        })
      })
      if (exists) continue
      await new Promise<void>((resolve, reject) => {
        sftp.mkdir(cur, (err) => {
          if (err) {
            sftp.stat(cur, (statErr, st) => {
              if (!statErr && st.isDirectory()) resolve()
              else reject(err)
            })
          } else resolve()
        })
      })
    }
  }

  async downloadFile(id: string, remotePath: string, localPath: string): Promise<void> {
    await fsp.mkdir(path.dirname(localPath), { recursive: true })
    const sftp = await this.getSftp(id)
    await new Promise<void>((resolve, reject) => {
      sftp.fastGet(remotePath, localPath, (err) => (err ? reject(err) : resolve()))
    })
  }

  async uploadFile(id: string, localPath: string, remotePath: string): Promise<void> {
    await this.ensureRemoteDir(id, path.posix.dirname(remotePath))
    const sftp = await this.getSftp(id)
    await new Promise<void>((resolve, reject) => {
      sftp.fastPut(localPath, remotePath, (err) => (err ? reject(err) : resolve()))
    })
  }

  async scanRemoteSide(
    id: string,
    root: string,
    shouldSkip?: (relPath: string, name: string, isDir: boolean) => boolean,
    options?: WalkOptions
  ): Promise<Map<string, SideEntry>> {
    const sftp = await this.getSftp(id)
    const map = new Map<string, SideEntry>()
    const target = root || '/'

    const walk = async (dir: string, rel: string, depth: number): Promise<void> => {
      if (depth > MAX_SCAN_DEPTH) {
        options?.onWarning?.(
          rel,
          `目录层级超过 ${MAX_SCAN_DEPTH} 层，已停止继续递归`
        )
        return
      }
      if (options?.shouldCancel?.()) throw new Error('SCAN_CANCELLED')
      if (options?.isSkipped?.(rel)) return
      options?.onDirectory?.(rel)
      let list: FileEntry[]
      try {
        list = await new Promise<FileEntry[]>((resolve, reject) => {
          sftp.readdir(dir, (err, entries) => (err ? reject(err) : resolve(entries)))
        })
      } catch (err) {
        options?.onWarning?.(
          rel,
          `无法读取目录: ${err instanceof Error ? err.message : String(err)}`
        )
        return
      }
      for (const entry of list) {
        if (options?.shouldCancel?.()) throw new Error('SCAN_CANCELLED')
        if (options?.isSkipped?.(rel)) return
        if (entry.filename === '.' || entry.filename === '..') continue
        const type = attrType(entry.attrs.mode, entry.longname)
        if (type !== 'dir' && type !== 'file') continue
        const childRel = rel ? `${rel}/${entry.filename}` : entry.filename
        if (shouldSkip?.(childRel, entry.filename, type === 'dir')) continue
        if (type === 'dir') {
          const item: SideEntry = {
            relPath: childRel,
            type: 'dir',
            size: 0,
            mtimeMs: entry.attrs.mtime * 1000
          }
          map.set(childRel, item)
          options?.onEntry?.(item)
          await walk(rjoin(dir, entry.filename), childRel, depth + 1)
        } else {
          const item: SideEntry = {
            relPath: childRel,
            type: 'file',
            size: entry.attrs.size,
            mtimeMs: entry.attrs.mtime * 1000
          }
          map.set(childRel, item)
          options?.onEntry?.(item)
        }
      }
    }

    await walk(target, '', 0)
    return map
  }

  async hashRemoteFile(id: string, filePath: string): Promise<string> {
    const info = await this.statRemote(id, filePath)
    if (info.dir) throw new Error('不是文件: ' + filePath)
    const sftp = await this.getSftp(id)
    return new Promise<string>((resolve, reject) => {
      const hash = crypto.createHash('sha256')
      const stream = sftp.createReadStream(filePath)
      stream.on('data', (chunk: Buffer) => hash.update(chunk))
      stream.on('error', reject)
      stream.on('end', () => resolve(hash.digest('hex')))
    })
  }

  async tempPath(name: string): Promise<string> {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcompare-'))
    return path.join(dir, name.replace(/[\\/]/g, '_'))
  }
}

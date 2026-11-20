import fs from 'node:fs'
import path from 'node:path'

export function readJsonFile<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return null
    // Preserve a corrupt file for manual recovery instead of silently losing
    // credentials or history on the next write.
    try {
      const backup = `${filePath}.corrupt-${Date.now()}`
      fs.renameSync(filePath, backup)
      console.error(`[mcompare] corrupted JSON moved to ${backup}`, error)
    } catch {
      console.error('[mcompare] failed to read JSON store', error)
    }
    return null
  }
}

export function writeJsonFileAtomic(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random()
    .toString(36)
    .slice(2)}.tmp`
  try {
    fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), 'utf8')
    fs.renameSync(tempPath, filePath)
  } catch (error) {
    try {
      fs.unlinkSync(tempPath)
    } catch {
      /* ignore cleanup */
    }
    throw error
  }
}

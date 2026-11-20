import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'

const PREFIX = 'mcompare.setting.'

export function readSetting<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    if (raw === null) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function writeSetting<T>(key: string, value: T): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    /* storage may be unavailable */
  }
}

export function useSetting<T>(
  key: string,
  fallback: T
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => readSetting(key, fallback))
  useEffect(() => {
    writeSetting(key, value)
  }, [key, value])
  return [value, setValue]
}

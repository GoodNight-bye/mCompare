import type { Location } from '../../shared/types'

export interface FileTabModel {
  id: string
  kind: 'file'
  left: Location | null
  right: Location | null
  view: 'auto' | 'text' | 'hex'
}

export interface FolderTabModel {
  id: string
  kind: 'folder'
  left: Location | null
  right: Location | null
}

export type TabModel = FileTabModel | FolderTabModel
export type Theme = 'dark' | 'light'
export type Notify = (text: string, kind?: 'info' | 'success' | 'error') => void

import type { JSX } from 'react'

export interface DiffBlock {
  start: number
  end: number
  important: boolean
}

interface Props {
  blocks: DiffBlock[]
  totalLines: number
  onJump: (line: number) => void
}

export default function OverviewStrip({ blocks, totalLines, onJump }: Props): JSX.Element {
  const total = Math.max(1, totalLines)
  return (
    <div className="overview-strip" aria-label="差异概览">
      {blocks.map((block, index) => {
        const top = ((block.start - 1) / total) * 100
        const height = Math.max(1.5, ((block.end - block.start + 1) / total) * 100)
        return (
          <button
            key={`${block.start}-${index}`}
            type="button"
            className={`overview-block ${block.important ? 'important' : 'unimportant'}`}
            style={{ top: `${top}%`, height: `${height}%` }}
            title={`第 ${block.start} 行 · ${block.important ? '代码差异' : '注释/排版差异'}`}
            onClick={() => onJump(block.start)}
          />
        )
      })}
    </div>
  )
}

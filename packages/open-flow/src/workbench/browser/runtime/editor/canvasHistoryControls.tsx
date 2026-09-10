import type { CanvasHistory } from '../stores/canvasHistory.ts'

import { useTranslate } from 'val-i18n-react'
import { isMac } from '../../../../canvas/browser/base/dom.ts'
import { CanvasTooltip } from '../../../../canvas/browser/components/tooltip.tsx'
import { Button } from '../../../../ui/browser/button.tsx'

export interface CanvasHistoryControlsProps {
  readonly state: CanvasHistory['state$']['value']
  readonly onUndo: () => void
  readonly onRedo: () => void
  readonly onRetry: () => void
  readonly disabled?: boolean
}

export function CanvasHistoryControls({ state, onUndo, onRedo, onRetry, disabled }: CanvasHistoryControlsProps) {
  const t = useTranslate()
  return (
    <div className="designer-actions">
      {(['undo', 'redo'] as const).map((direction) => {
        const entry = state[direction]
        const name = t(`history.${direction}`)
        const shortcut = isMac ? (direction == 'undo' ? '⌘Z' : '⇧⌘Z') : direction == 'undo' ? 'Ctrl+Z' : 'Ctrl+Shift+Z / Ctrl+Y'
        const label =
          entry == null
            ? name
            : `${name}: ${t(`history.${entry.action}${entry.count == 1 && ['add', 'delete', 'paste', 'move'].includes(entry.action) ? 'One' : ''}`, { count: entry.count })}`
        return (
          <CanvasTooltip key={direction} placement="top" title={`${label} (${shortcut})`}>
            <Button
              aria-label={label}
              disabled={disabled || !(direction == 'undo' ? state.canUndo : state.canRedo)}
              onClick={direction == 'undo' ? onUndo : onRedo}
              variant="ghost"
              size="icon"
            >
              <i aria-hidden="true" className={direction == 'undo' ? 'i-lucide:undo-2' : 'i-lucide:redo-2'} />
            </Button>
          </CanvasTooltip>
        )
      })}
      {state.failed && (
        <CanvasTooltip placement="top" title={t('history.retry')}>
          <Button aria-label={t('history.retry')} onClick={onRetry} variant="ghost" size="icon">
            <i aria-hidden="true" className="i-lucide:refresh-cw" />
          </Button>
        </CanvasTooltip>
      )}
    </div>
  )
}

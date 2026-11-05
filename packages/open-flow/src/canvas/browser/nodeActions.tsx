import { useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { Button } from '../../ui/browser/button.tsx'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '../../ui/browser/dropdown-menu.tsx'

export function NodeActions({
  ignored,
  onIgnore,
  onDuplicate,
  onDelete,
  className,
  contentClassName,
  container,
  align = 'end',
}: {
  readonly ignored: boolean
  readonly onIgnore?: (ignored: boolean) => void
  readonly className?: string
  readonly contentClassName?: string
  readonly container?: HTMLElement
  readonly align?: 'start' | 'end'
  readonly onDuplicate?: () => void
  readonly onDelete?: () => void
}) {
  const t = useTranslate()
  const [root, setRoot] = useState<HTMLDivElement | null>(null)
  return (
    <div ref={setRoot} className="inline-flex shrink-0">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button className={className} title={t('nodeActions.more')} aria-label={t('nodeActions.more')} size="icon-xs" variant="ghost">
              <i className="i-codicon:ellipsis" />
            </Button>
          }
        />
        <DropdownMenuContent align={align} container={container ?? root} className={contentClassName} sideOffset={0}>
          <DropdownMenuGroup>
            {onDuplicate && (
              <DropdownMenuItem onClick={() => onDuplicate()}>
                <i className="i-codicon:copy" />
                {t('nodeActions.duplicate')}
              </DropdownMenuItem>
            )}
            {onIgnore && (
              <DropdownMenuItem onClick={() => onIgnore(!ignored)}>
                <i className={ignored ? 'i-carbon:view-off' : 'i-carbon:view'} />
                {t(ignored ? 'nodeActions.skipDisable' : 'nodeActions.skipEnable')}
              </DropdownMenuItem>
            )}
            {onDelete && (
              <DropdownMenuItem onClick={() => onDelete()} variant="destructive">
                <i className="i-codicon:trash" />
                {t('nodeActions.delete')}
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

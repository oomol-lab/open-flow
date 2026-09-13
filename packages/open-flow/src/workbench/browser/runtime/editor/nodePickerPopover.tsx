import type { BlockLibraryProps } from './contextPanel.tsx'

import { useCallback, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { Button } from '../../../../ui/browser/button.tsx'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '../../../../ui/browser/popover.tsx'
import { Icon } from '../icons.tsx'
import { BlockLibrary } from './contextPanel.tsx'

export function NodePickerPopover(props: BlockLibraryProps) {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  const [root, setRoot] = useState<HTMLElement | null>(null)
  const mount = useCallback((element: HTMLDivElement | null) => setRoot(element?.closest<HTMLElement>('.open-flow-workbench') ?? null), [])
  return (
    <div ref={mount}>
      <Popover open={open && !props.disabled} onOpenChange={setOpen}>
        <PopoverTrigger disabled={props.disabled} render={<Button type="button" variant="ghost" className="pr-3 text-[13px]" />}>
          <Icon data-icon="inline-start" name="plus" />
          {t('designer.addNode')}
        </PopoverTrigger>
        <PopoverContent
          container={root}
          side="top"
          align="start"
          sideOffset={12}
          className="h-[min(560px,var(--available-height))] max-h-[calc(100dvh-32px)] w-[440px] max-w-[calc(100vw-32px)] gap-0 overflow-hidden p-0"
        >
          <PopoverTitle className="sr-only">{t('designer.addNode')}</PopoverTitle>
          {open && (
            <BlockLibrary
              {...props}
              presentation="picker"
              draggable={false}
              onAdd={async (option) => {
                const id = await props.onAdd(option)
                if (id != null) setOpen(false)
                return id
              }}
            />
          )}
        </PopoverContent>
      </Popover>
    </div>
  )
}

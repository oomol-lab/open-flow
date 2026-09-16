import type { FlowCanvasViewProps } from '../../../../canvas/browser/graph/FlowCanvas/model.ts'
import type { BlockLibraryProps } from './contextPanel.tsx'

import { useCallback, useState } from 'react'
import { flushSync } from 'react-dom'
import { useTranslate } from 'val-i18n-react'
import { Button } from '../../../../ui/browser/button.tsx'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '../../../../ui/browser/popover.tsx'
import { Icon } from '../icons.tsx'
import { BlockLibrary } from './contextPanel.tsx'

export function NodePickerPopover(
  props: BlockLibraryProps & { readonly anchor?: { readonly x: number; readonly y: number }; readonly centered?: boolean; readonly onClose?: () => void },
) {
  const t = useTranslate()
  const [open, setOpen] = useState(props.anchor != null)
  const [adding, setAdding] = useState(false)
  const [root, setRoot] = useState<HTMLElement | null>(null)
  const mount = useCallback(
    (element: HTMLDivElement | null) => setRoot(element?.closest<HTMLElement>(props.centered ? '.canvas-panel' : '.open-flow-workbench') ?? null),
    [props.centered],
  )
  const canvas = () => (root?.matches('.workbench-canvas, .react-flow') ? root : root?.querySelector<HTMLElement>('.workbench-canvas, .react-flow'))
  const close = () => {
    props.onClose?.()
    if (props.anchor) canvas()?.focus({ preventScroll: true })
  }
  return (
    <div ref={mount}>
      <Popover
        open={open && !props.disabled}
        onOpenChange={(value) => {
          setOpen(value)
          if (!value) close()
        }}
      >
        {props.anchor ? (
          <PopoverTrigger
            tabIndex={-1}
            aria-label={t('designer.addNode')}
            nativeButton={false}
            render={<span style={{ position: 'fixed', left: props.anchor.x, top: props.anchor.y }} />}
          />
        ) : (
          <PopoverTrigger disabled={props.disabled || adding} render={<Button type="button" variant="ghost" className="pr-3 text-[13px]" />}>
            <Icon data-icon="inline-start" name="plus" />
            {t('designer.addNode')}
          </PopoverTrigger>
        )}
        <PopoverContent
          finalFocus={props.anchor ? () => canvas() ?? false : undefined}
          container={root}
          positionerClassName={props.centered ? 'node-picker-centered-positioner' : undefined}
          positionerStyle={props.centered ? { position: 'absolute', inset: 0, transform: 'none' } : undefined}
          side={props.anchor ? 'bottom' : 'top'}
          align="start"
          sideOffset={props.anchor ? 4 : 12}
          className="h-[min(560px,var(--available-height))] max-h-[calc(100dvh-32px)] w-[440px] max-w-[calc(100vw-32px)] gap-0 overflow-hidden p-0"
          style={props.centered ? { height: 'min(560px, calc(100% - 32px))', maxHeight: 'calc(100% - 32px)' } : undefined}
        >
          <PopoverTitle className="sr-only">{t('designer.addNode')}</PopoverTitle>
          {open && (
            <BlockLibrary
              {...props}
              presentation="picker"
              draggable={false}
              onAdd={async (option) => {
                flushSync(() => {
                  setAdding(true)
                  setOpen(false)
                })
                try {
                  return await props.onAdd(option)
                } finally {
                  setAdding(false)
                  close()
                }
              }}
            />
          )}
        </PopoverContent>
      </Popover>
    </div>
  )
}

export type CanvasNodePickerRequest = Parameters<NonNullable<FlowCanvasViewProps['onRequestAddNode']>>[0]

export function CanvasNodePicker({
  request,
  centered,
  ...props
}: BlockLibraryProps & { readonly request: CanvasNodePickerRequest; readonly centered?: boolean; readonly onClose: () => void }) {
  return (
    <NodePickerPopover
      {...props}
      anchor={request.screenPosition}
      centered={centered}
      isOptionDisabled={(option) =>
        request.connectionSide != null &&
        (option.kind == 'trigger' || option.kind == 'comment' || (request.connectionSide == 'left' && (option.kind == 'condition' || option.kind == 'wait')))
      }
    />
  )
}

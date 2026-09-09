import type { ReactElement } from 'react'
import type { ConnectorAction } from '../api.ts'
import type { ConnectorStore } from '../stores/connectorStore.ts'
import type { AddNodeOption } from './addNodeOptions.ts'

import { Plus } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { Button } from '../../../../ui/browser/button.tsx'
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '../../../../ui/browser/dialog.tsx'
import { FieldError } from '../../../../ui/browser/field.tsx'
import { BlockLibrary } from './contextPanel.tsx'

const empty: readonly AddNodeOption[] = []

export function ActionPicker({
  connectors,
  disabled,
  label,
  exclude = [],
  onSelect,
}: {
  readonly connectors: ConnectorStore
  readonly disabled: boolean
  readonly label: string
  readonly exclude?: readonly string[]
  readonly onSelect: (action: ConnectorAction) => Promise<boolean>
}): ReactElement {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  const [root, setRoot] = useState<HTMLElement | null>(null)
  const portal = useCallback((element: HTMLDivElement | null) => setRoot(element?.closest<HTMLElement>('.open-flow-workbench') ?? null), [])
  const [error, setError] = useState<string>()
  const excluded = exclude.join(',')
  const choices = useCallback(
    async (id: string, signal: AbortSignal) => {
      const options = await connectors.provideAddNodeOptionChoices(id, signal)
      return options?.filter((option) => option.kind != 'connector' || !excluded.split(',').includes(option.connector.actionId))
    },
    [connectors, excluded],
  )
  const search = useCallback(
    async (query: string, signal: AbortSignal) => {
      const options = await connectors.provideAddNodeOptions(query, signal)
      return options?.filter((option) => option.kind != 'connector' || !excluded.split(',').includes(option.connector.actionId))
    },
    [connectors, excluded],
  )
  return (
    <div ref={portal}>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          setOpen(value)
          setError(undefined)
        }}
      >
        <DialogTrigger disabled={disabled} render={<Button type="button" variant="outline" size="xs" />}>
          <Plus />
          {label}
        </DialogTrigger>
        <DialogContent container={root} closeLabel={t('contextPanel.close')} className="flex h-[min(560px,80dvh)] flex-col gap-2 overflow-hidden sm:max-w-lg">
          <DialogTitle>{t('actionPicker.title')}</DialogTitle>
          {open && (
            <BlockLibrary
              browseOptions={connectors.browseAddNodeOptions}
              searchOptions={search}
              provideChoices={choices}
              disabled={disabled}
              draggable={false}
              focusRequest={0}
              options={empty}
              onAdd={async (option) => {
                if (option.kind != 'connector') return
                setError(undefined)
                try {
                  if (!(await onSelect(option.connector))) {
                    setError(t('actionPicker.failed'))
                    return
                  }
                  setOpen(false)
                  return option.connector.actionId
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : String(cause))
                }
              }}
            />
          )}
          {error != null && <FieldError>{error}</FieldError>}
        </DialogContent>
      </Dialog>
    </div>
  )
}

import type { ReactElement } from 'react'
import type { ConnectorConnection } from '../api.ts'
import type { ConnectorStore } from '../stores/connectorStore.ts'
import type { ConnectorActionView } from '../workspace.ts'
import type { AddNodeOption } from './addNodeOptions.ts'

import { Plus } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { Button } from '../../../../ui/browser/button.tsx'
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '../../../../ui/browser/dialog.tsx'
import { FieldError } from '../../../../ui/browser/field.tsx'
import { mapSource } from '../stores/optionSource.ts'
import { BlockLibrary } from './contextPanel.tsx'

const empty: readonly AddNodeOption[] = []

export function ActionPicker({
  connectors,
  disabled,
  label,
  exclude = [],
  onSelect,
  prepare,
}: {
  readonly connectors: ConnectorStore
  readonly disabled: boolean
  readonly label: string
  readonly exclude?: readonly string[]
  readonly onSelect: (action: ConnectorActionView, connections: readonly ConnectorConnection[]) => Promise<boolean>
  readonly prepare?: (
    action: ConnectorActionView,
  ) => Promise<{ readonly action: ConnectorActionView; readonly connections: readonly ConnectorConnection[] } | undefined>
}): ReactElement {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  const [root, setRoot] = useState<HTMLElement | null>(null)
  const portal = useCallback((element: HTMLDivElement | null) => setRoot(element?.closest<HTMLElement>('.open-flow-workbench') ?? null), [])
  const [error, setError] = useState<string>()
  const excluded = exclude.join(',')
  const choices = useCallback(
    (id: string, signal: AbortSignal) =>
      mapSource(connectors.provideAddNodeOptionChoices(id, signal), signal, (options) =>
        options.filter((option) => option.kind != 'connector' || !excluded.split(',').includes(option.connector.actionId)),
      ),
    [connectors, excluded],
  )
  const search = useCallback(
    (query: string, signal: AbortSignal) =>
      mapSource(connectors.provideAddNodeOptions(query, signal), signal, (options) =>
        options.filter((option) => option.kind != 'connector' || !excluded.split(',').includes(option.connector.actionId)),
      ),
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
              refreshCatalog={connectors.retryCatalog}
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
                  const prepared = prepare == null ? { action: option.connector, connections: [] } : await prepare(option.connector)
                  if (prepared == null) return
                  if (!(await onSelect(prepared.action, prepared.connections))) {
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

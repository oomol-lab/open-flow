import type { ReactElement } from 'react'
import type { ConnectorStore } from '../stores/connectorStore.ts'
import type { AddNodeOption } from './addNodeOptions.ts'

import { useCallback, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { Button } from '../../../../ui/browser/button.tsx'
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '../../../../ui/browser/dialog.tsx'
import { mapSource } from '../stores/optionSource.ts'
import { BlockLibrary } from './blockLibrary.tsx'

const empty: readonly AddNodeOption[] = []

export function ServicePicker({
  connectors,
  exclude,
  onSelect,
}: {
  readonly connectors: ConnectorStore
  readonly exclude: readonly string[]
  readonly onSelect: (providerId: string) => Promise<boolean>
}): ReactElement {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  const [root, setRoot] = useState<HTMLElement | null>(null)
  const portal = useCallback(
    (element: HTMLDivElement | null) =>
      setRoot(element?.closest<HTMLElement>('.open-flow-workbench') ?? element?.closest<HTMLElement>('.open-flow-theme') ?? null),
    [],
  )
  const excluded = JSON.stringify(exclude)
  const search = useCallback(
    (query: string, signal: AbortSignal) => {
      const ids: readonly string[] = JSON.parse(excluded)
      const term = query.trim().toLocaleLowerCase()
      return mapSource(connectors.browseAddNodeOptions(signal), signal, (options) =>
        options.filter(
          (option) =>
            option.kind == 'connector-group' &&
            !option.noSetup &&
            !ids.includes(option.serviceId) &&
            `${option.label} ${option.serviceId}`.toLocaleLowerCase().includes(term),
        ),
      )
    },
    [connectors, excluded],
  )
  const browse = useCallback((signal: AbortSignal) => search('', signal), [search])
  return (
    <div ref={portal}>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger render={<Button className="text-muted-foreground" size="xs" type="button" variant="ghost" />}>
          {t('connectorAccess.addService')}
        </DialogTrigger>
        <DialogContent container={root} closeLabel={t('contextPanel.close')} className="flex h-[min(560px,80dvh)] flex-col gap-3 overflow-hidden sm:max-w-lg">
          <DialogTitle>{t('connectorAccess.addService')}</DialogTitle>
          {open && (
            <BlockLibrary
              presentation="providers"
              refreshCatalog={connectors.retryCatalog}
              browseOptions={browse}
              searchOptions={search}
              provideChoices={connectors.provideAddNodeOptionChoices}
              disabled={false}
              draggable={false}
              focusRequest={0}
              options={empty}
              onAdd={async (option) => {
                if (option.kind != 'connector-group') return
                if (!(await onSelect(option.serviceId))) return
                setOpen(false)
                return option.serviceId
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

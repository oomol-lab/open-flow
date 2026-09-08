import type { FormEvent, ReactElement } from 'react'
import type { WorkbenchTheme } from '../contract.ts'
import type { RunInputGroup, RunInputRequest, RunRequestStore } from './runRequestStore.ts'

import { useVal } from 'use-value-enhancer'
import { useTranslate } from 'val-i18n-react'
import { Alert, AlertDescription } from '../../../../ui/browser/alert.tsx'
import { Button } from '../../../../ui/browser/button.tsx'
import { Spinner } from '../../../../ui/browser/spinner.tsx'
import { FlowRunInputEditor } from '../../flowRunInputEditor.tsx'
import { Icon } from '../icons.tsx'

function InputGroup({
  attempted,
  group,
  title,
  hint,
  theme,
}: {
  readonly attempted: boolean
  readonly title: string
  readonly hint?: string
  readonly group: RunInputGroup
  readonly theme: WorkbenchTheme
}): ReactElement {
  return (
    <section className="run-input-group">
      <header>
        <strong>{title}</strong>
        {hint != null && <p>{hint}</p>}
      </header>
      <FlowRunInputEditor store={group.editor} theme={theme} showErrors={attempted} />
    </section>
  )
}

function Form({
  onStarted,
  request,
  store,
  theme,
}: {
  readonly onStarted: () => void
  readonly request: RunInputRequest
  readonly store: RunRequestStore
  readonly theme: WorkbenchTheme
}): ReactElement {
  const t = useTranslate()
  const valid = useVal(request.valid)
  const starting = useVal(store.$.starting)

  function close(): void {
    if (!starting) store.dismissInputs()
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (await store.confirmInputs()) onStarted()
  }

  return (
    <form aria-busy={starting} onSubmit={(event) => void submit(event)}>
      <header>
        <div>
          <strong>{t('runInput.title')}</strong>
          <span>{request.triggers.find((trigger) => trigger.nodeId == request.triggerId)?.title ?? request.flow.name}</span>
        </div>
        <Button aria-label={t('runInput.close')} disabled={starting} onClick={close} size="icon-sm" type="button" variant="ghost">
          <Icon name="close" />
        </Button>
      </header>
      <div className="run-input-content">
        <p>{t('runInput.remembered')}</p>
        {request.attempted && !valid && (
          <Alert variant="destructive">
            <Icon name="alert" />
            <AlertDescription>{t('runInput.invalid')}</AlertDescription>
          </Alert>
        )}
        {request.groups.map((group) => (
          <InputGroup
            attempted={request.attempted}
            group={group}
            key={group.nodeId}
            title={group.nodeId == request.triggerId ? t('runInput.triggerData') : group.title}
            hint={group.nodeId == request.triggerId ? t('runInput.triggerDataHint') : undefined}
            theme={theme}
          />
        ))}
      </div>
      <footer>
        <Button disabled={starting} onClick={close} type="button" variant="secondary">
          {t('common.close')}
        </Button>
        <Button disabled={starting || request.triggerId == null} type="submit">
          {starting ? <Spinner data-icon="inline-start" /> : <Icon data-icon="inline-start" name="play" />}
          {t(starting ? 'workspace.starting' : 'runInput.startTest')}
        </Button>
      </footer>
    </form>
  )
}

export function RunInputPanel({
  onStarted,
  store,
  theme,
}: {
  readonly onStarted: () => void
  readonly store: RunRequestStore
  readonly theme: WorkbenchTheme
}): ReactElement | null {
  const request = useVal(store.$.inputRequest)
  return request == null ? null : <Form onStarted={onStarted} request={request} store={store} theme={theme} />
}

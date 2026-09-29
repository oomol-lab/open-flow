import type { FormEvent, ReactElement } from 'react'
import type { WorkbenchTheme } from '../contract.ts'
import type { RunInputRequest, RunRequestStore } from './runRequestStore.ts'

import { useVal } from 'use-value-enhancer'
import { useTranslate } from 'val-i18n-react'
import { Alert, AlertDescription } from '../../../../ui/browser/alert.tsx'
import { Button } from '../../../../ui/browser/button.tsx'
import { Spinner } from '../../../../ui/browser/spinner.tsx'
import { FlowRunInputEditor } from '../../flowRunInputEditor.tsx'
import { Icon } from '../icons.tsx'

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
    <form className="open-flow-property-panel" aria-busy={starting} onSubmit={(event) => void submit(event)}>
      <header>
        <div>
          <strong>{t('runInput.title')}</strong>
          <span>
            {t('runInput.triggerSubtitle', { name: request.triggers.find((trigger) => trigger.nodeId == request.triggerId)?.title ?? request.flow.name })}
          </span>
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
        {request.editor && (
          <section className="run-input-group">
            <header>
              <strong>{t('inspector.ports.outputsTitle')}</strong>
            </header>
            <FlowRunInputEditor store={request.editor} theme={theme} showErrors={request.attempted} />
          </section>
        )}
      </div>
      <footer>
        <Button disabled={starting} onClick={close} type="button" variant="secondary">
          {t('common.close')}
        </Button>
        <Button className="pr-3" disabled={starting || request.triggerId == null} type="submit">
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

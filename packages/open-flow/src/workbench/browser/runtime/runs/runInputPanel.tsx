import type { FormEvent, KeyboardEvent, ReactElement } from 'react'
import type { WorkbenchTheme } from '../contract.ts'
import type { RunInputGroup, RunInputRequest, RunRequestStore } from './runRequestStore.ts'

import { useEffect, useRef } from 'react'
import { useVal } from 'use-value-enhancer'
import { useTranslate } from 'val-i18n-react'
import { Alert, AlertDescription } from '../../../../ui/browser/alert.tsx'
import { Button } from '../../../../ui/browser/button.tsx'
import { Spinner } from '../../../../ui/browser/spinner.tsx'
import { FlowRunInputEditor } from '../../flowRunInputEditor.tsx'
import { Icon } from '../icons.tsx'

interface Props {
  readonly onStarted: () => void
  readonly store: RunRequestStore
  readonly theme: WorkbenchTheme
}

function InputGroup({ attempted, group, theme }: { readonly attempted: boolean; readonly group: RunInputGroup; readonly theme: WorkbenchTheme }): ReactElement {
  const t = useTranslate()
  const valid = useVal(group.editor.valid$)
  return (
    <section className={`run-input-group ${attempted && !valid ? 'invalid' : ''}`}>
      <header>
        <div>
          <strong>{group.title}</strong>
          <code>{group.nodeId}</code>
        </div>
        {attempted && !valid && <span>{t('runInput.groupInvalid')}</span>}
      </header>
      <FlowRunInputEditor store={group.editor} theme={theme} />
    </section>
  )
}

function Panel({ onStarted, request, store, theme }: Props & { readonly request: RunInputRequest }): ReactElement {
  const t = useTranslate()
  const valid = useVal(request.valid)
  const starting = useVal(store.$.starting)
  const panel = useRef<HTMLElement>(null)
  const previousFocus = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null)

  useEffect(() => {
    panel.current?.focus({ preventScroll: true })
    return () => previousFocus.current?.focus({ preventScroll: true })
  }, [])

  function close(): void {
    if (!starting) store.dismissInputs()
  }

  function keyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.key != 'Escape') return
    event.stopPropagation()
    close()
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (await store.confirmInputs()) onStarted()
  }

  return (
    <aside
      aria-busy={starting}
      aria-describedby="run-input-description"
      aria-labelledby="run-input-title"
      className="run-input-panel"
      id="run-input-panel"
      onKeyDown={keyDown}
      ref={panel}
      role="dialog"
      tabIndex={-1}
    >
      <form onSubmit={(event) => void submit(event)}>
        <header>
          <div>
            <strong id="run-input-title">{t('runInput.title')}</strong>
            <span>
              {request.flow.name} · {t(request.source == 'draft' ? 'run.sourceDraft' : 'run.sourceLive')}
            </span>
          </div>
          <Button aria-label={t('runInput.close')} disabled={starting} onClick={close} size="icon-sm" type="button" variant="ghost">
            <Icon name="close" />
          </Button>
        </header>
        <div className="run-input-content">
          <p id="run-input-description">{t('runInput.description')}</p>
          {request.attempted && !valid && (
            <Alert className="mb-4" variant="destructive">
              <Icon name="alert" />
              <AlertDescription>{t('runInput.invalid')}</AlertDescription>
            </Alert>
          )}
          {request.groups.map((group) => (
            <InputGroup attempted={request.attempted} group={group} key={group.nodeId} theme={theme} />
          ))}
        </div>
        <footer>
          <Button disabled={starting} onClick={close} type="button" variant="secondary">
            {t('common.cancel')}
          </Button>
          <Button disabled={starting} type="submit">
            {starting ? <Spinner data-icon="inline-start" /> : <Icon data-icon="inline-start" name="play" />}
            {t(starting ? 'workspace.starting' : request.source == 'draft' ? 'workspace.runDraft' : 'workspace.runLive')}
          </Button>
        </footer>
      </form>
    </aside>
  )
}

export function RunInputPanel({ onStarted, store, theme }: Props): ReactElement | null {
  const request = useVal(store.$.inputRequest)
  return request == null ? null : <Panel onStarted={onStarted} request={request} store={store} theme={theme} />
}

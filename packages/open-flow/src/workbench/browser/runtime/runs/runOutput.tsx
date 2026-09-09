import type { ReactElement, ReactNode } from 'react'
import type { JsonValue, RunEvent, RunResult } from '../api.ts'

import { useLang, useTranslate } from 'val-i18n-react'
import { controlErrorCode } from '../../../../control/common/errors.ts'
import { Alert, AlertDescription, AlertTitle } from '../../../../ui/browser/alert.tsx'
import { Button } from '../../../../ui/browser/button.tsx'
import { collapseAllNested, JSONViewer } from '../../../../ui/browser/json-viewer/index.ts'
import { Icon } from '../icons.tsx'
import { agentLog } from './runGroups.ts'

function RunError({ code, message, children }: { readonly code: string; readonly message: string; readonly children?: ReactNode }): ReactElement {
  return (
    <Alert className="mt-2.5" variant="error">
      <Icon name="alert" />
      <AlertTitle className="whitespace-pre-wrap wrap-anywhere">{message}</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-2">
        <code className="text-xs wrap-anywhere" translate="no">
          {code}
        </code>
        {children}
      </AlertDescription>
    </Alert>
  )
}

function JsonValueView({ label, value }: { readonly label: string; readonly value: JsonValue }): ReactElement {
  return (
    <div aria-label={label} className="run-json">
      <JSONViewer data={value} shouldExpandNode={collapseAllNested} />
    </div>
  )
}

function EventDetail({ children, label }: { readonly children: ReactNode; readonly label: string }): ReactElement {
  return (
    <div className="event-detail" role="row">
      <div role="cell">
        <strong>{label}</strong>
        {children}
      </div>
    </div>
  )
}

export function eventHasDetails(event: RunEvent): boolean {
  return (
    event.kind == 'node.artifact' ||
    event.kind == 'node.failed' ||
    event.kind == 'node.log' ||
    (event.kind == 'node.completed' && Object.keys(event.payload.outputs).length > 0)
  )
}

export function RunEventDetail({
  event,
  onConfigureConnector,
}: {
  readonly event: RunEvent
  readonly onConfigureConnector?: (() => void) | undefined
}): ReactElement | null {
  const t = useTranslate()
  switch (event.kind) {
    case 'node.completed': {
      const outputs = event.payload.outputs
      if (Object.keys(outputs).length == 0) return null
      return (
        <EventDetail label={t('run.nodeOutput')}>
          <JsonValueView label={t('run.nodeOutput')} value={outputs} />
        </EventDetail>
      )
    }
    case 'node.log': {
      const log = agentLog(event)
      if (log?.kind == 'model-tool' || log?.kind == 'model-step')
        return (
          <EventDetail label={t('run.eventDetails')}>
            <JsonValueView label={t('run.eventDetails')} value={log as JsonValue} />
          </EventDetail>
        )
      const source = log?.source
      if (source != null && typeof source == 'object' && 'kind' in source && source.kind == 'code') {
        const input = log?.input
        if (input != null && typeof input == 'object' && 'code' in input && typeof input.code == 'string') {
          return (
            <EventDetail label={t('agent.code')}>
              <pre className="run-event-message" translate="no">
                {input.code}
              </pre>
              {'inputs' in input && <JsonValueView label={t('agent.source')} value={input.inputs as JsonValue} />}
            </EventDetail>
          )
        }
        if (log?.status == 'completed' && log.output != null)
          return (
            <EventDetail label={t('run.nodeOutput')}>
              <JsonValueView label={t('run.nodeOutput')} value={log.output as JsonValue} />
            </EventDetail>
          )
        if (log?.status == 'failed' && typeof log.message == 'string')
          return (
            <EventDetail label={t('agent.code')}>
              <RunError code={String(log.code)} message={log.message} />
            </EventDetail>
          )
      }
      const message = event.payload.message
      return (
        <EventDetail label={t('run.nodeLog', { level: event.payload.level })}>
          <pre className="run-event-message">{message}</pre>
        </EventDetail>
      )
    }
    case 'node.artifact':
      return (
        <EventDetail label={t('run.artifactMetadata')}>
          <JsonValueView label={t('run.artifactMetadata')} value={event.payload.artifact} />
          <p className="run-detail-note">{t('run.artifactUnavailable')}</p>
        </EventDetail>
      )
    case 'node.failed': {
      const { code, message: rawMessage } = event.payload.error
      const message =
        code == 'connector.connection-required'
          ? t('run.connectionRequired')
          : code == controlErrorCode.connectorUnconfigured
            ? t('run.connectorUnconfigured')
            : code == 'connector.unavailable' && rawMessage == 'The Connector request could not be completed.'
              ? t('run.connectorUnavailable')
              : rawMessage
      return (
        <EventDetail label={t('run.nodeError')}>
          <RunError code={code} message={message}>
            {code == controlErrorCode.connectorUnconfigured && onConfigureConnector != null && (
              <Button onClick={onConfigureConnector} size="sm" type="button" variant="outline">
                {t('run.configureConnector')}
              </Button>
            )}
          </RunError>
        </EventDetail>
      )
    }
    default:
      return null
  }
}

export function RunResultView({ result }: { readonly result: RunResult }): ReactElement {
  const language = useLang()
  const t = useTranslate()
  return (
    <section className="run-output-view">
      <header>
        <strong>{t('run.terminalResult')}</strong>
        <time dateTime={result.finishedAt}>{new Date(result.finishedAt).toLocaleString(language)}</time>
      </header>
      {result.status == 'completed' ? (
        <JsonValueView label={t('run.terminalResult')} value={result.result} />
      ) : result.status == 'canceled' ? (
        <div className="run-empty">{t('run.canceledWithoutOutput')}</div>
      ) : (
        <RunError code={result.error.code} message={result.error.message} />
      )}
    </section>
  )
}

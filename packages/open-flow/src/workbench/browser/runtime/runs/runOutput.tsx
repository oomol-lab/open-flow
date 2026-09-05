import type { ReactElement, ReactNode } from 'react'
import type { JsonValue, RunEvent, RunResult } from '../api.ts'

import { useLang, useTranslate } from 'val-i18n-react'
import { controlErrorCode } from '../../../../control/common/errors.ts'
import { collapseAllNested, JSONViewer } from '../../../../designer/browser/jsonViewer/index.ts'
import { Alert, AlertDescription, AlertTitle } from '../../../../ui/browser/alert.tsx'
import { Button } from '../../../../ui/browser/button.tsx'

function record(value: JsonValue | undefined): Readonly<Record<string, JsonValue>> | undefined {
  if (value == null || typeof value != 'object' || Array.isArray(value)) return undefined
  return value as Readonly<Record<string, JsonValue>>
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
    (event.kind == 'node.completed' && Object.keys(record(event.payload.outputs) ?? {}).length > 0)
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
      const outputs = record(event.payload.outputs)
      if (outputs == null || Object.keys(outputs).length == 0) return null
      return (
        <EventDetail label={t('run.nodeOutput')}>
          <JsonValueView label={t('run.nodeOutput')} value={outputs} />
        </EventDetail>
      )
    }
    case 'node.log': {
      const message = typeof event.payload.message == 'string' ? event.payload.message : ''
      return (
        <EventDetail label={t('run.nodeLog', { level: typeof event.payload.level == 'string' ? event.payload.level : 'log' })}>
          <pre className="run-event-message">{message}</pre>
        </EventDetail>
      )
    }
    case 'node.artifact':
      return (
        <EventDetail label={t('run.artifactMetadata')}>
          <JsonValueView label={t('run.artifactMetadata')} value={event.payload.artifact ?? null} />
          <p className="run-detail-note">{t('run.artifactUnavailable')}</p>
        </EventDetail>
      )
    case 'node.failed': {
      const error = record(event.payload.error)
      const code = typeof error?.code == 'string' ? error.code : 'node.failed'
      const rawMessage = typeof error?.message == 'string' ? error.message : undefined
      const message =
        code == 'connector.connection-required'
          ? t('run.connectionRequired')
          : code == controlErrorCode.connectorUnconfigured
            ? t('run.connectorUnconfigured')
            : code == 'connector.unavailable' && rawMessage == 'The Connector request could not be completed.'
              ? t('run.connectorUnavailable')
              : rawMessage != null
                ? rawMessage
                : t('run.nodeFailed')
      return (
        <EventDetail label={t('run.nodeError')}>
          <Alert className="mt-2.5" variant="destructive">
            <AlertTitle>
              <code>{code}</code>
            </AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-2">
              <span>{message}</span>
              {code == controlErrorCode.connectorUnconfigured && onConfigureConnector != null && (
                <Button onClick={onConfigureConnector} size="sm" type="button" variant="outline">
                  {t('run.configureConnector')}
                </Button>
              )}
            </AlertDescription>
          </Alert>
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
        <Alert variant="destructive">
          <AlertTitle>
            <code>{result.error.code}</code>
          </AlertTitle>
          <AlertDescription>{result.error.message}</AlertDescription>
        </Alert>
      )}
    </section>
  )
}

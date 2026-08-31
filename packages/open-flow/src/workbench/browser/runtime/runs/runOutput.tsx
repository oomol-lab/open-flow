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
  return event.kind == 'node.artifact' || event.kind == 'node.failed' || event.kind == 'node.log' || event.kind == 'node.output'
}

export function RunEventDetail({
  event,
  onConfigureConnector,
}: {
  readonly event: RunEvent
  readonly onConfigureConnector?: (() => void) | undefined
}): ReactElement | null {
  const language = useLang()
  const t = useTranslate()
  switch (event.kind) {
    case 'node.output': {
      const handle = typeof event.payload.handle == 'string' ? event.payload.handle : undefined
      const label = t('run.nodeOutput')
      const output = record(event.payload.output)
      if (output?.kind == 'inline' && Object.hasOwn(output, 'value')) {
        return (
          <EventDetail label={label}>
            {handle != null && <code className="run-output-handle">{handle}</code>}
            <JsonValueView label={label} value={output.value!} />
          </EventDetail>
        )
      }
      if (output?.kind == 'stored') {
        return (
          <EventDetail label={label}>
            <dl className="run-output-reference">
              <div>
                <dt>{t('run.outputId')}</dt>
                <dd>{String(output.outputId)}</dd>
              </div>
              <div>
                <dt>{t('run.digest')}</dt>
                <dd>{String(output.digest)}</dd>
              </div>
              <div>
                <dt>{t('run.encodedBytes')}</dt>
                <dd>{typeof output.encodedBytes == 'number' ? output.encodedBytes.toLocaleString(language) : String(output.encodedBytes)}</dd>
              </div>
            </dl>
            <p className="run-detail-note">{t('run.storedOutputUnavailable')}</p>
          </EventDetail>
        )
      }
      return (
        <EventDetail label={label}>
          {handle != null && <code className="run-output-handle">{handle}</code>}
          <JsonValueView label={label} value={event.payload} />
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

export function RunEventDetails({
  events,
  onConfigureConnector,
}: {
  readonly events: readonly RunEvent[]
  readonly onConfigureConnector?: (() => void) | undefined
}): ReactElement | null {
  const t = useTranslate()
  if (events.length == 1) return <RunEventDetail event={events[0]!} onConfigureConnector={onConfigureConnector} />
  const outputs: Record<string, JsonValue> = {}
  for (const event of events) {
    const handle = event.payload.handle
    const output = record(event.payload.output)
    if (
      event.kind != 'node.output' ||
      typeof handle != 'string' ||
      output?.kind != 'inline' ||
      !Object.hasOwn(output, 'value') ||
      Object.hasOwn(outputs, handle)
    ) {
      return (
        <>
          {events.map((candidate) => (
            <RunEventDetail event={candidate} key={candidate.sequence} onConfigureConnector={onConfigureConnector} />
          ))}
        </>
      )
    }
    outputs[handle] = output.value!
  }
  return (
    <EventDetail label={t('run.nodeOutput')}>
      <JsonValueView label={t('run.nodeOutput')} value={outputs} />
    </EventDetail>
  )
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

import type { ReactElement, ReactNode } from 'react'
import type { JsonValue, RunEvent, RunResult } from '../api.ts'

import { useId, useState } from 'react'
import { useLang, useTranslate } from 'val-i18n-react'
import { controlErrorCode } from '../../../../control/common/errors.ts'
import { Alert, AlertDescription, AlertTitle } from '../../../../ui/browser/alert.tsx'
import { Button } from '../../../../ui/browser/button.tsx'
import { collapseAllNested, JSONViewer } from '../../../../ui/browser/json-viewer/index.ts'
import { Icon } from '../icons.tsx'
import { agentLog } from './runGroups.ts'

function jsonRecord(value: unknown): Readonly<Record<string, JsonValue>> | undefined {
  if (value == null || typeof value != 'object' || Array.isArray(value)) return undefined
  return value as Readonly<Record<string, JsonValue>>
}

export function flowOutputs(result: JsonValue): JsonValue {
  const value = jsonRecord(result)
  if (value?.kind == 'function-outputs') return jsonRecord(value.outputs) ?? result
  if (value?.kind != 'node-results' || !Array.isArray(value.nodes)) return result
  const outputs: JsonValue[] = []
  for (const nodeValue of value.nodes) {
    const node = jsonRecord(nodeValue)
    if (node?.status != 'completed') continue
    const output = jsonRecord(node.outputs)
    if (output != null) outputs.push(output)
  }
  return outputs.length == 1 ? outputs[0] : outputs
}

export function RunText({ text }: { readonly text: string }): ReactElement {
  const t = useTranslate()
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [expanded, setExpanded] = useState(false)
  const contentId = useId()
  const long = text.length > 160 || text.split('\n').length > 3
  const preview = text.split('\n').slice(0, 3).join('\n').slice(0, 160).trimEnd()
  return (
    <div className="run-text">
      <span className="run-text-preview" id={contentId}>
        {long && !expanded ? `${preview}…` : text}
      </span>{' '}
      <span className="run-text-actions">
        {long && (
          <Button size="xs" variant="ghost" aria-expanded={expanded} aria-controls={contentId} onClick={() => setExpanded(!expanded)}>
            <i aria-hidden="true" className={expanded ? 'i-lucide-light:chevron-up' : 'i-lucide-light:chevron-down'} />
            {t(expanded ? 'run.collapseText' : 'run.expandText')}
          </Button>
        )}
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={t('run.copyText')}
          title={t('run.copyText')}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text)
              setCopyState('copied')
            } catch {
              setCopyState('failed')
            }
          }}
        >
          <i aria-hidden="true" className="i-lucide-light:copy" />
        </Button>
      </span>
      {copyState != 'idle' && (
        <span role="status" className="run-source">
          {t(copyState == 'copied' ? 'run.textCopied' : 'run.textCopyFailed')}
        </span>
      )}
    </div>
  )
}

function RunError({ code, message, children }: { readonly code: string; readonly message: string; readonly children?: ReactNode }): ReactElement {
  return (
    <div className="run-error">
      <RunText text={message} />
      <code className="run-source" translate="no">
        {code}
      </code>
      {children}
    </div>
  )
}

export function JsonValueView({ label, value }: { readonly label: string; readonly value: JsonValue }): ReactElement {
  return (
    <div aria-label={label} className="run-json">
      <JSONViewer data={value} shouldExpandNode={collapseAllNested} />
    </div>
  )
}

function EventDetail({ children, label }: { readonly children: ReactNode; readonly label: string }): ReactElement {
  return (
    <div className="event-detail">
      <div>
        <strong>{label}</strong>
        {children}
      </div>
    </div>
  )
}

export function eventHasDetails(event: RunEvent): boolean {
  return (
    event.kind == 'run.completed' ||
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
    case 'run.completed':
      return (
        <EventDetail label={t('run.terminalResult')}>
          <JsonValueView label={t('run.terminalResult')} value={flowOutputs(event.payload.result)} />
        </EventDetail>
      )
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
          <details className="run-payload">
            <summary>{t('run.eventDetails')}</summary>
            <JsonValueView label={t('run.eventDetails')} value={log as JsonValue} />
          </details>
        )
      const source = log?.source
      if (source != null && typeof source == 'object' && 'kind' in source && source.kind == 'code') {
        const input = log?.input
        if (input != null && typeof input == 'object' && 'code' in input && typeof input.code == 'string') {
          return (
            <EventDetail label={t('agent.code')}>
              <RunText text={input.code} />
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
      if (log != null)
        return (
          <details className="run-payload">
            <summary>{t('run.eventDetails')}</summary>
            <JsonValueView label={t('run.eventDetails')} value={log as JsonValue} />
          </details>
        )
      return <RunText text={event.payload.message} />
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
      <RunResultContent result={result} />
    </section>
  )
}

export function RunResultContent({ result }: { readonly result: RunResult }): ReactElement {
  const t = useTranslate()
  return result.status == 'completed' ? (
    <JsonValueView label={t('run.terminalResult')} value={flowOutputs(result.result)} />
  ) : result.status == 'canceled' ? (
    <div className="run-empty">{t('run.canceledWithoutOutput')}</div>
  ) : (
    <Alert variant="error">
      <Icon name="alert" />
      <AlertTitle>
        <RunText text={result.error.message} />
      </AlertTitle>
      <AlertDescription>
        <code>{result.error.code}</code>
      </AlertDescription>
    </Alert>
  )
}

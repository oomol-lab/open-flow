import type { ControlClient, EventSource } from '../../../control/common/api.ts'
import type { SetNotice } from './stores/workbenchNotice.ts'

import { useEffect, useRef, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { Button } from '../../../ui/browser/button.tsx'
import { Input } from '../../../ui/browser/input.tsx'
import { eventSourceKind, eventSourcePresentations } from './eventSourcePresentation.ts'
import { errorNotice } from './stores/workbenchNotice.ts'

export function EventSourceSetup({
  source,
  client,
  onChange,
  notify,
}: {
  readonly notify: SetNotice
  readonly source: EventSource
  readonly client: Pick<ControlClient, 'listEventSources'>
  readonly onChange: (source: EventSource) => void
}) {
  const t = useTranslate()
  const presentation = eventSourcePresentations[eventSourceKind(source.provider)]
  const [copied, setCopied] = useState<string>()
  const [pending, setPending] = useState(false)
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => request.current?.abort(), [])

  async function refresh() {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setPending(true)
    try {
      const result = await client.listEventSources(undefined, controller.signal)
      if (controller.signal.aborted) return
      const current = result.sources.find((item) => item.sourceId == source.sourceId)
      if (current == null) notify({ kind: 'error', message: t('eventSources.notFound') })
      else onChange(current)
    } catch (cause) {
      if (!controller.signal.aborted) notify(errorNotice(cause, t))
    } finally {
      if (!controller.signal.aborted) setPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <ol className="m-0 flex list-none flex-col gap-5 p-0">
        <li className="flex flex-col gap-2">
          <h3 className="m-0 text-sm font-medium">{t(source.provider === 'jira' ? 'eventSources.setupJira' : 'eventSources.setupCopy')}</h3>
          {source.endpointUrl == null ? (
            <p className="m-0 text-sm text-destructive">{t(source.appId == null ? 'eventSources.identityUnknown' : 'eventSources.originMissing')}</p>
          ) : (
            <div className="flex items-center gap-2">
              <Input
                aria-label={t('eventSources.callback')}
                className="min-w-0 flex-1"
                value={source.endpointUrl}
                readOnly
                onFocus={(event) => event.target.select()}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(source.endpointUrl!)
                    setCopied(source.endpointUrl!)
                  } catch {
                    notify({ kind: 'error', message: t('eventSources.copyFailed') })
                  }
                }}
              >
                {t(copied != null && copied == source.endpointUrl ? 'eventSources.copied' : 'eventSources.copy')}
              </Button>
            </div>
          )}
          <p className="m-0 text-xs leading-5 text-muted-foreground">{t('eventSources.publicCallbackHint')}</p>
        </li>
        <li className="flex flex-col gap-2">
          <h3 className="m-0 text-sm font-medium">{t(presentation.setup)}</h3>
          <p className="m-0 text-sm leading-5 text-muted-foreground">{t(presentation.setupHint)}</p>
          <p className="m-0 text-xs text-muted-foreground">
            {t('eventSources.appId')}: <code>{source.appId ?? t('eventSources.identityUnknown')}</code>
          </p>
          <a className="self-start text-sm text-primary underline underline-offset-4" href={presentation.console} target="_blank" rel="noreferrer">
            {t('eventSources.openConsole')}
          </a>
          <div className="flex flex-wrap gap-2">
            {source.eventTypes.map((type) => (
              <code key={type} className="break-all rounded bg-muted px-2 py-1 text-xs">
                {type}
              </code>
            ))}
          </div>
          <p className="m-0 text-xs leading-5 text-muted-foreground">
            {t(source.provider === 'jira' ? 'eventSources.jiraEventsHint' : 'eventSources.manualSubscriptionHint')}
          </p>
        </li>
        <li className="flex flex-col gap-2 rounded-md bg-muted p-3">
          <h3 className="m-0 text-sm font-medium">{t('eventSources.setupVerify')}</h3>
          <p role="status" className="m-0 text-sm leading-5">
            {source.provider === 'jira'
              ? t(`eventSources.subscription.${source.subscriptionStatus ?? 'idle'}`)
              : t(
                  !source.enabled ? 'eventSources.disabled' : source.verifiedAt == null ? 'eventSources.awaitingVerification' : 'eventSources.callbackVerified',
                )}
          </p>
          <p className="m-0 text-xs leading-5 text-muted-foreground">
            {t(source.provider === 'jira' ? 'eventSources.jiraSetupHint' : 'eventSources.verifyBeforePublish')}
          </p>
          {source.lastError && (
            <p role="alert" className="m-0 text-sm text-destructive">
              {source.lastError}
            </p>
          )}
          <Button className="self-start" variant="outline" size="sm" disabled={pending} onClick={() => void refresh()}>
            {t(pending ? 'eventSources.checkingVerification' : 'eventSources.checkVerification')}
          </Button>
        </li>
      </ol>
    </div>
  )
}

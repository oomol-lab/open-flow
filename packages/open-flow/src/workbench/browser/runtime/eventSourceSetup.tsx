import type { ControlClient, EventSource } from '../../../control/common/api.ts'

import { useEffect, useRef, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { Button } from '../../../ui/browser/button.tsx'
import { Input } from '../../../ui/browser/input.tsx'
import { errorNotice } from './stores/workbenchNotice.ts'

export function EventSourceSetup({
  source,
  client,
  onChange,
}: {
  readonly source: EventSource
  readonly client: Pick<ControlClient, 'listEventSources'>
  readonly onChange: (source: EventSource) => void
}) {
  const t = useTranslate()
  const [copied, setCopied] = useState<string>()
  const [error, setError] = useState<string>()
  const [pending, setPending] = useState(false)
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => request.current?.abort(), [])

  async function refresh() {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setPending(true)
    setError(undefined)
    try {
      const result = await client.listEventSources(undefined, controller.signal)
      if (controller.signal.aborted) return
      const current = result.sources.find((item) => item.sourceId == source.sourceId)
      if (current == null) setError(t('eventSources.notFound'))
      else onChange(current)
    } catch (cause) {
      if (!controller.signal.aborted) setError(errorNotice(cause, t).message)
    } finally {
      if (!controller.signal.aborted) setPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <ol className="m-0 flex list-none flex-col gap-5 p-0">
        <li className="flex flex-col gap-2">
          <h3 className="m-0 text-sm font-medium">{t('eventSources.setupCopy')}</h3>
          {source.endpointUrl == null ? (
            <p className="m-0 text-sm text-destructive">{t('eventSources.originMissing')}</p>
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
                  setError(undefined)
                  try {
                    await navigator.clipboard.writeText(source.endpointUrl!)
                    setCopied(source.endpointUrl!)
                  } catch {
                    setError(t('eventSources.copyFailed'))
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
          <h3 className="m-0 text-sm font-medium">{t('eventSources.setupFeishu')}</h3>
          <p className="m-0 text-sm leading-5 text-muted-foreground">{t('eventSources.setupFeishuHint')}</p>
          <p className="m-0 text-xs text-muted-foreground">
            App ID: <code>{source.appId}</code>
          </p>
          <a className="self-start text-sm text-primary underline underline-offset-4" href="https://open.feishu.cn/app" target="_blank" rel="noreferrer">
            {t('eventSources.openFeishu')}
          </a>
          <div className="flex flex-wrap gap-2">
            {source.eventTypes.map((type) => (
              <code key={type} className="break-all rounded bg-muted px-2 py-1 text-xs">
                {type}
              </code>
            ))}
          </div>
          <p className="m-0 text-xs leading-5 text-muted-foreground">{t('eventSources.manualSubscriptionHint')}</p>
        </li>
        <li className="flex flex-col gap-2 rounded-md bg-muted p-3">
          <h3 className="m-0 text-sm font-medium">{t('eventSources.setupVerify')}</h3>
          <p role="status" className="m-0 text-sm leading-5">
            {t(!source.enabled ? 'eventSources.disabled' : source.verifiedAt == null ? 'eventSources.awaitingVerification' : 'eventSources.callbackVerified')}
          </p>
          <p className="m-0 text-xs leading-5 text-muted-foreground">{t('eventSources.verifyBeforePublish')}</p>
          <Button className="self-start" variant="outline" size="sm" disabled={pending} onClick={() => void refresh()}>
            {t(pending ? 'eventSources.checkingVerification' : 'eventSources.checkVerification')}
          </Button>
        </li>
      </ol>
      {error != null && (
        <p role="alert" className="m-0 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

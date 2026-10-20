import type { RetryConfiguration } from '../../../../flow/common/change.ts'

import { useEffect, useId, useRef, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { defaultNodeRetry, nodeRetryLimits, retryConfigurationSchema } from '../../../../flow/common/retry.ts'
import { FieldSelect } from '../../../../form/browser/fieldSelect.tsx'
import { Field, FieldError, FieldGroup, FieldLabel } from '../../../../ui/browser/field.tsx'
import { HelpButton } from '../../../../ui/browser/helpButton.tsx'
import { InputGroup, InputGroupAddon, InputGroupInput } from '../../../../ui/browser/input-group.tsx'

export function RetrySettings({
  nodeId,
  retry,
  disabled,
  onSave,
}: {
  readonly nodeId: string
  readonly retry?: RetryConfiguration
  readonly disabled: boolean
  readonly onSave: (retry: RetryConfiguration | undefined) => void
}) {
  const t = useTranslate()
  const id = useId()
  const [draft, setDraft] = useState({ count: retry?.maxRetries ?? 0, seconds: String((retry?.intervalMs ?? defaultNodeRetry.intervalMs) / 1000) })
  const current = useRef(draft)
  const request = useRef<AbortController>()
  const [invalid, setInvalid] = useState(false)
  const enabled = draft.count > 0
  useEffect(() => {
    request.current?.abort()
    current.current = { count: retry?.maxRetries ?? 0, seconds: String((retry?.intervalMs ?? defaultNodeRetry.intervalMs) / 1000) }
    setDraft(current.current)
    setInvalid(false)
  }, [nodeId, retry?.maxRetries, retry?.intervalMs, disabled])
  useEffect(() => () => request.current?.abort(), [])

  async function validate(candidate: typeof draft, save: boolean) {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    await Promise.resolve()
    if (controller.signal.aborted || request.current !== controller || current.current !== candidate) return
    const parsed = retryConfigurationSchema.safeParse({ maxRetries: candidate.count, intervalMs: Number(candidate.seconds) * 1000 })
    const valid = parsed.success && parsed.data.maxRetries > 0
    setInvalid(!valid)
    if (valid && save && !disabled && (parsed.data.maxRetries != retry?.maxRetries || parsed.data.intervalMs != retry?.intervalMs)) onSave(parsed.data)
  }

  return (
    <FieldGroup>
      <Field orientation="horizontal" className="grid grid-cols-2 gap-3">
        <div className="flex items-center gap-1">
          <FieldLabel htmlFor={`node-${id}-retry`}>{t('inspector.node.retry')}</FieldLabel>
          <HelpButton label={t('inspector.node.retryHelp')}>{t('inspector.node.retryHint')}</HelpButton>
        </div>
        <FieldSelect
          id={`node-${id}-retry`}
          aria-label={t('inspector.node.retry')}
          value={draft.count}
          disabled={disabled}
          onChange={(value) => {
            if (disabled) return
            request.current?.abort()
            const next = { ...current.current, count: Number(value) }
            current.current = next
            setDraft(next)
            if (next.count === 0) {
              setInvalid(false)
              onSave(undefined)
            } else void validate(next, true)
          }}
        >
          <option value={0}>{t('inspector.node.retryNone')}</option>
          {Array.from({ length: nodeRetryLimits.maxRetries }, (_, index) => index + 1).map((count) => (
            <option key={count} value={count}>
              {t(count === 1 ? 'inspector.node.retryOnce' : 'inspector.node.retryCount', { count })}
            </option>
          ))}
        </FieldSelect>
      </Field>
      {enabled && (
        <Field data-invalid={invalid}>
          <div className="grid grid-cols-2 items-center gap-3">
            <FieldLabel htmlFor={`node-${id}-retry-interval`}>{t('inspector.node.retryInterval')}</FieldLabel>
            <InputGroup>
              <InputGroupInput
                id={`node-${id}-retry-interval`}
                type="number"
                min={nodeRetryLimits.minIntervalMs / 1000}
                max={nodeRetryLimits.maxIntervalMs / 1000}
                step={nodeRetryLimits.intervalStepMs / 1000}
                readOnly={disabled}
                value={draft.seconds}
                aria-invalid={invalid}
                aria-describedby={invalid ? `node-${id}-retry-error` : undefined}
                onChange={(event) => {
                  const next = { ...current.current, seconds: event.currentTarget.value }
                  current.current = next
                  setDraft(next)
                  void validate(next, false)
                }}
                onBlur={() => void validate(current.current, true)}
                onKeyDown={(event) => {
                  if (event.key == 'Enter') void validate(current.current, true)
                }}
              />
              <InputGroupAddon align="inline-end">{t('inspector.node.retrySeconds')}</InputGroupAddon>
            </InputGroup>
          </div>
          {invalid && <FieldError id={`node-${id}-retry-error`}>{t('inspector.node.retryError')}</FieldError>}
        </Field>
      )}
    </FieldGroup>
  )
}

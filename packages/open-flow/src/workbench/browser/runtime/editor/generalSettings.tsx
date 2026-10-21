import type { ReactElement, ReactNode } from 'react'
import type { ResolvedNode } from '../revisionView.ts'
import type { WorkspaceStore } from '../stores/workspaceStore.ts'

import { useEffect, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { supportsNodeErrorHandling, supportsNodeRetry } from '../../../../flow/common/change.ts'
import { FieldSelect } from '../../../../form/browser/fieldSelect.tsx'
import { Field, FieldError, FieldGroup, FieldLabel } from '../../../../ui/browser/field.tsx'
import { HelpButton } from '../../../../ui/browser/helpButton.tsx'
import { Input } from '../../../../ui/browser/input.tsx'
import { Icon } from '../icons.tsx'
import { RetrySettings } from './retrySettings.tsx'

export function GeneralSettings({
  title,
  children,
  disabled = false,
  readOnly = false,
  node,
  nodeId,
  store,
}: {
  readonly title?: string
  readonly children?: ReactNode
  readonly disabled?: boolean
  readonly readOnly?: boolean
  readonly node: ResolvedNode['node']
  readonly nodeId: string
  readonly store?: WorkspaceStore
}): ReactElement {
  const t = useTranslate()
  const [timeout, setTimeoutValue] = useState(node.timeoutMs == null ? '' : String(node.timeoutMs))
  const [limit, setLimit] = useState(node.maxExecutions == null ? '' : String(node.maxExecutions))
  const [limitError, setLimitError] = useState<string>()
  const [error, setError] = useState<string>()
  const inputId = `node-${nodeId}-timeout`

  useEffect(() => {
    setTimeoutValue(node.timeoutMs == null ? '' : String(node.timeoutMs))
    setError(undefined)
  }, [node.timeoutMs, nodeId])

  useEffect(() => {
    setLimit(node.maxExecutions == null ? '' : String(node.maxExecutions))
    setLimitError(undefined)
  }, [node.maxExecutions, nodeId])

  function saveLimit(source: string): void {
    if (disabled || readOnly || store == null) return
    const value = source.trim() == '' ? undefined : Number(source)
    if (value != null && (!Number.isSafeInteger(value) || value < 1)) {
      setLimitError(t('inspector.node.maxExecutionsError'))
      return
    }
    setLimitError(undefined)
    if (value == node.maxExecutions) return
    void store.nodes.saveNodeSettings(nodeId, { name: node.name, timeoutMs: node.timeoutMs, maxExecutions: value })
  }

  function save(source: string): void {
    if (disabled || readOnly || store == null) return
    const value = source.trim() == '' ? undefined : Number(source)
    if (value != null && (!Number.isInteger(value) || value < 1)) {
      setError(t('inspector.node.timeoutError'))
      return
    }
    setError(undefined)
    if (value == node.timeoutMs) return
    void store.nodes.saveNodeSettings(nodeId, {
      name: node.name,
      ...(node.maxExecutions == null ? {} : { maxExecutions: node.maxExecutions }),
      ...(value == null ? {} : { timeoutMs: value }),
    })
  }

  return (
    <details key={nodeId} className="inspector-disclosure" data-inspector-section="node">
      <summary>
        <Icon name="chevron-down" size={14} />
        <span className="inspector-disclosure-summary">
          <strong className="inspector-section-title-text">{title ?? t('inspector.node.title')}</strong>
        </span>
      </summary>
      <div className="inspector-disclosure-content node-settings">
        <FieldGroup>
          {children}
          {supportsNodeRetry(node) && (
            <RetrySettings
              nodeId={nodeId}
              retry={node.retry}
              disabled={disabled || readOnly || store == null}
              onSave={(retry) => {
                void store?.nodes.saveNodeSettings(nodeId, { name: node.name, timeoutMs: node.timeoutMs, maxExecutions: node.maxExecutions, retry })
              }}
            />
          )}
          {supportsNodeErrorHandling(node) && (
            <Field orientation="horizontal" className="grid grid-cols-2 gap-3">
              <div className="flex items-center gap-1">
                <FieldLabel htmlFor={`node-${nodeId}-on-error`}>{t('inspector.node.onError')}</FieldLabel>
                <HelpButton label={t('inspector.node.onErrorHelp')}>{t('inspector.node.onErrorHint')}</HelpButton>
              </div>
              <FieldSelect
                id={`node-${nodeId}-on-error`}
                aria-label={t('inspector.node.onError')}
                value={node.onError ?? 'stop'}
                disabled={disabled || readOnly || store == null}
                onChange={(value) => {
                  if (!disabled && !readOnly)
                    void store?.nodes.saveNodeSettings(nodeId, {
                      name: node.name,
                      timeoutMs: node.timeoutMs,
                      maxExecutions: node.maxExecutions,
                      onError: value == 'error' ? 'error' : undefined,
                    })
                }}
              >
                <option value="stop">{t('inspector.node.onErrorStop')}</option>
                <option value="error">{t('inspector.node.onErrorOutput')}</option>
              </FieldSelect>
            </Field>
          )}
          <Field data-invalid={limitError != null}>
            <FieldLabel htmlFor={`node-${nodeId}-limit`}>{t('inspector.node.maxExecutions')}</FieldLabel>
            <Input
              aria-invalid={limitError != null}
              readOnly={disabled || readOnly}
              id={`node-${nodeId}-limit`}
              min="1"
              step="1"
              onChange={(event) => setLimit(event.target.value)}
              onBlur={(event) => saveLimit(event.currentTarget.value)}
              placeholder="1000"
              type="number"
              value={limit}
            />
            {limitError != null && <FieldError>{limitError}</FieldError>}
          </Field>
          {node.kind != 'approval' && node.kind != 'wait' && (
            <Field data-invalid={error != null}>
              <FieldLabel htmlFor={inputId}>{t('inspector.node.timeout')}</FieldLabel>
              <Input
                aria-invalid={error != null}
                readOnly={disabled || readOnly}
                id={inputId}
                min="1"
                onChange={(event) => setTimeoutValue(event.target.value)}
                onBlur={(event) => save(event.currentTarget.value)}
                placeholder={t('common.default')}
                type="number"
                value={timeout}
              />
              {error != null && <FieldError>{error}</FieldError>}
            </Field>
          )}
        </FieldGroup>
      </div>
    </details>
  )
}

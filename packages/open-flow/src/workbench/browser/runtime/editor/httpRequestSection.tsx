import type { ReactNode } from 'react'
import type { ManagedTaskDefinition } from '../../../../flow/common/change.ts'
import type { HttpRequestConfig } from '../../../../http/common/httpRequest.ts'

import { dequal } from 'dequal/lite'
import { useEffect, useId, useRef, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { ValueEditorFeedback } from '../../../../form/browser/fieldControl.tsx'
import { httpMultipartHandle, httpRequestIssues, httpRequestTask } from '../../../../http/common/httpRequest.ts'
import { Button } from '../../../../ui/browser/button.tsx'
import { Field, FieldLabel } from '../../../../ui/browser/field.tsx'
import { Input } from '../../../../ui/browser/input.tsx'
import { NativeSelect, NativeSelectOption } from '../../../../ui/browser/native-select.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../../ui/browser/tooltip.tsx'
import { InspectorSection } from './inspectorSection.tsx'
import { TaskExecutorChanges } from './taskExecutorChanges.ts'

export function HttpRequestSection({
  task,
  disabled,
  onSave,
  parameters,
  input,
}: {
  task: ManagedTaskDefinition
  parameters: ReactNode
  input: (handle: string, label: string) => ReactNode
  disabled: boolean
  onSave: (before: ManagedTaskDefinition, next: ManagedTaskDefinition) => Promise<boolean>
}) {
  const t = useTranslate()
  const id = useId()
  const saveRef = useRef(onSave)
  saveRef.current = onSave
  const taskRef = useRef(task)
  taskRef.current = task
  const [changes] = useState(
    () =>
      new TaskExecutorChanges(task.executor, (before, next) => {
        if (before.kind != 'http-request' || next.kind != 'http-request') return Promise.resolve(false)
        const current = taskRef.current
        if (current.executor.kind !== 'http-request') return Promise.resolve(false)
        const merged = { ...current.executor }
        for (const key of ['method', 'authentication', 'bodyFormat', 'bodyFields', 'responseFormat', 'statusPolicy'] as const) {
          if (!dequal(before[key], next[key])) Object.assign(merged, { [key]: next[key] })
        }
        return saveRef.current(current, httpRequestTask(merged, current.name, current))
      }),
  )
  const [config, setConfig] = useState(changes.value)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    changes.sync(task.executor)
    setConfig(changes.value)
  }, [changes, task.executor])
  if (config.kind != 'http-request') return null
  const issues = httpRequestIssues(config)
  const error = (field: string, index?: number) => {
    const messages = issues.filter((issue) => issue.field === field && issue.index === index).map((issue) => t(`httpRequest.${issue.code}`))
    return messages.length ? [...new Set(messages)].join(' ') : undefined
  }
  async function save() {
    try {
      setFailed(!(await changes.save()))
    } catch {
      setFailed(true)
    }
  }
  function update(patch: Partial<HttpRequestConfig>) {
    if (disabled || changes.value.kind != 'http-request') return
    changes.value = { ...changes.value, ...patch }
    setConfig(changes.value)
    void save()
  }
  const select = (
    key: string,
    value: string,
    options: readonly (readonly [string, string])[],
    change: (value: string) => void,
    fieldLabel = t(`httpRequest.${key}`),
  ) => (
    <Field key={key}>
      <FieldLabel htmlFor={`${id}-${key}`}>{fieldLabel}</FieldLabel>
      <ValueEditorFeedback error={key === 'authentication' && config.authentication.type === 'apiKey' ? undefined : error(key)}>
        {(errorId) => (
          <NativeSelect
            className="w-full"
            id={`${id}-${key}`}
            value={value}
            disabled={disabled}
            aria-invalid={!!errorId}
            aria-describedby={errorId}
            onChange={(event) => change(event.target.value)}
          >
            {options.map(([optionValue, label]) => (
              <NativeSelectOption key={optionValue} value={optionValue}>
                {label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </ValueEditorFeedback>
    </Field>
  )
  const auth = config.authentication
  return (
    <>
      <InspectorSection title={t('httpRequest.title')} data-inspector-section="task">
        <div className="node-settings flex flex-col gap-3" data-value-editor-scope>
          {input('url', 'URL')}
          {select(
            'method',
            config.method,
            ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].map((value) => [value, value]),
            (method) => update({ method: method as HttpRequestConfig['method'] }),
          )}
          {parameters}
          {select(
            'bodyFormat',
            config.bodyFormat,
            [
              ['none', t('httpRequest.none')],
              ['json', 'JSON'],
              ['text', t('httpRequest.text')],
              ['form', 'URL-encoded'],
              ['multipart', 'Multipart'],
              ['binary', t('httpRequest.binary')],
            ],
            (bodyFormat) =>
              update({
                bodyFormat: bodyFormat as HttpRequestConfig['bodyFormat'],
              }),
          )}
          {config.bodyFormat === 'multipart' ? (
            <MultipartFields
              fields={config.bodyFields ?? []}
              disabled={disabled}
              error={(index) => error('bodyFields', index)}
              input={input}
              onChange={(bodyFields) => update({ bodyFields })}
            />
          ) : (
            config.bodyFormat !== 'none' && input('body', config.bodyFormat === 'binary' ? t('httpRequest.file') : t('httpRequest.body'))
          )}
        </div>
      </InspectorSection>
      <InspectorSection title={t('httpRequest.authentication')}>
        <div className="node-settings flex flex-col gap-3" data-value-editor-scope>
          {select(
            'authentication',
            auth.type,
            [
              ['none', t('httpRequest.none')],
              ['bearer', 'Bearer'],
              ['basic', 'Basic'],
              ['apiKey', 'API Key'],
            ],
            (type) =>
              update({
                authentication: type == 'apiKey' ? { type, name: 'X-API-Key', in: 'header' } : { type: type as 'none' | 'bearer' | 'basic' },
              }),
            t('httpRequest.authenticationType'),
          )}
          {auth.type == 'apiKey' && (
            <>
              {select(
                'location',
                auth.in,
                [
                  ['header', 'Header'],
                  ['query', 'Query'],
                ],
                (location) =>
                  update({
                    authentication: {
                      ...auth,
                      in: location as 'header' | 'query',
                    },
                  }),
              )}
              <Field>
                <FieldLabel htmlFor={`${id}-keyName`}>{t('httpRequest.keyName')}</FieldLabel>
                <ValueEditorFeedback error={error('authentication')}>
                  {(errorId) => (
                    <Input
                      id={`${id}-keyName`}
                      value={auth.name}
                      aria-invalid={!!errorId}
                      aria-describedby={errorId}
                      readOnly={disabled}
                      onChange={(event) =>
                        update({
                          authentication: { ...auth, name: event.target.value },
                        })
                      }
                    />
                  )}
                </ValueEditorFeedback>
              </Field>
            </>
          )}
          {auth.type === 'basic' ? (
            <>
              {input('auth.username', t('httpRequest.username'))}
              {input('auth.password', t('httpRequest.password'))}
            </>
          ) : auth.type !== 'none' ? (
            input('auth.token', auth.type === 'apiKey' ? t('httpRequest.keyValue') : 'Token')
          ) : null}
        </div>
      </InspectorSection>
      <InspectorSection title={t('httpRequest.responseSettings')}>
        <div className="node-settings flex flex-col gap-3" data-value-editor-scope>
          {select(
            'responseFormat',
            config.responseFormat,
            [
              ['auto', t('httpRequest.auto')],
              ['json', 'JSON'],
              ['text', t('httpRequest.text')],
              ['artifact', t('httpRequest.file')],
            ],
            (responseFormat) =>
              update({
                responseFormat: responseFormat as HttpRequestConfig['responseFormat'],
              }),
          )}
          {select(
            'statusPolicy',
            config.statusPolicy,
            [
              ['success', t('httpRequest.success')],
              ['all', t('httpRequest.all')],
            ],
            (statusPolicy) =>
              update({
                statusPolicy: statusPolicy as HttpRequestConfig['statusPolicy'],
              }),
          )}
          {failed && (
            <ValueEditorFeedback error={t('httpRequest.saveFailed')}>
              {(errorId) => (
                <Button variant="outline" size="field" aria-invalid aria-describedby={errorId} disabled={disabled} onClick={() => void save()}>
                  {t('httpRequest.retry')}
                </Button>
              )}
            </ValueEditorFeedback>
          )}
        </div>
      </InspectorSection>
    </>
  )
}

/** Names of multipart fields; each name becomes one `body.<name>` input. Renames commit on blur to keep bindings stable. */
function MultipartFields({
  fields,
  disabled,
  error,
  input,
  onChange,
}: {
  fields: readonly string[]
  disabled: boolean
  error: (index: number) => string | undefined
  input: (handle: string, label: string) => ReactNode
  onChange: (fields: string[]) => void
}) {
  const t = useTranslate()
  const id = useId()
  const [drafts, setDrafts] = useState(fields)
  useEffect(() => setDrafts(fields), [fields])
  const commit = (next: readonly string[]) => {
    if (!dequal(next, fields)) onChange([...next])
  }
  return (
    <Field>
      <FieldLabel id={`${id}-label`}>{t('httpRequest.multipartFields')}</FieldLabel>
      <div className="flex flex-col gap-2" role="group" aria-labelledby={`${id}-label`}>
        {drafts.map((name, index) => (
          <div key={index} className="flex flex-col gap-2">
            <ValueEditorFeedback error={error(index)}>
              {(errorId) => (
                <div className="flex items-center gap-1">
                  <Input
                    className="min-w-0 flex-1"
                    value={name}
                    aria-label={t('httpRequest.multipartFieldName')}
                    aria-invalid={!!errorId}
                    aria-describedby={errorId}
                    readOnly={disabled}
                    onChange={(event) => setDrafts(drafts.map((draft, position) => (position === index ? event.target.value : draft)))}
                    onBlur={() => commit(drafts)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') commit(drafts)
                    }}
                  />
                  {!disabled && (
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label={t('httpRequest.removeMultipartField')}
                            onClick={() => commit(drafts.filter((_, position) => position !== index))}
                          />
                        }
                      >
                        <i aria-hidden="true" className="i-lucide-light:x text-sm" />
                      </TooltipTrigger>
                      <TooltipContent>{t('httpRequest.removeMultipartField')}</TooltipContent>
                    </Tooltip>
                  )}
                </div>
              )}
            </ValueEditorFeedback>
            {name.trim() !== '' && name === fields[index] && fields.indexOf(name) === index && input(httpMultipartHandle(name), name)}
          </div>
        ))}
        {!disabled && (
          <Button variant="outline" size="field" onClick={() => commit([...drafts, nextFieldName(drafts)])}>
            {t('httpRequest.addMultipartField')}
          </Button>
        )}
      </div>
    </Field>
  )
}

function nextFieldName(fields: readonly string[]) {
  if (!fields.includes('file')) return 'file'
  let index = 2
  while (fields.includes(`file${index}`)) index++
  return `file${index}`
}

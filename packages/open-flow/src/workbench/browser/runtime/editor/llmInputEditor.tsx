import type { JsonValue } from '../api.ts'

import { useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { isUnknownRecord } from '../../../../base/common/type.ts'
import { defaultLlmMaxTokens, defaultLlmTemperature, defaultLlmTopP, maximumLlmOutputTokens } from '../../../../llm/common/model.ts'
import { Button } from '../../../../ui/browser/button.tsx'
import { Input } from '../../../../ui/browser/input.tsx'
import { Label } from '../../../../ui/browser/label.tsx'
import { NativeSelect } from '../../../../ui/browser/native-select.tsx'
import { SimpleCodeEditor } from '../../../../ui/browser/simple-code-editor.ts'
import { highlightTemplateText } from './templateHighlight.ts'

export function supportsLlmInput(schema: unknown, value: JsonValue | undefined): boolean {
  if (!isUnknownRecord(schema)) return false
  if (schema['ui:widget'] === 'llm/model') return value == null || isUnknownRecord(value)
  return (
    schema['ui:widget'] === 'llm/messages' &&
    (value == null ||
      (Array.isArray(value) &&
        value.every((item) => isUnknownRecord(item) && ['system', 'user', 'assistant'].includes(String(item.role)) && typeof item.content === 'string')))
  )
}

export function LlmInputEditor({
  schema,
  value,
  disabled,
  handleNames,
  onChange,
}: {
  schema: unknown
  value: JsonValue | undefined
  disabled: boolean
  handleNames: readonly string[]
  onChange: (value: JsonValue | undefined) => void
}) {
  const t = useTranslate()
  const [expanded, setExpanded] = useState(false)
  if (!isUnknownRecord(schema)) return null
  if (schema['ui:widget'] === 'llm/messages') {
    const messages = (value ?? []) as { [key: string]: JsonValue; role: string; content: string }[]
    const minimum = typeof schema.minItems === 'number' ? Math.max(0, schema.minItems) : 0
    const update = (index: number, patch: { role?: string; content?: string }) =>
      onChange(messages.map((message, i) => (i === index ? { ...message, ...patch } : message)))
    const nextRole = messages.length === 0 ? (minimum > 0 ? 'user' : 'system') : messages.at(-1)?.role === 'user' ? 'assistant' : 'user'
    return (
      <div className="grid gap-3">
        {messages.map((message, index) => (
          <div key={index} className="grid gap-2 rounded-lg border border-border p-2">
            <div className="flex gap-2">
              <NativeSelect
                aria-label={`${t('llmEditor.messageRole')} / ${index + 1}`}
                value={message.role}
                disabled={disabled}
                onChange={(event) => update(index, { role: event.target.value })}
              >
                {['system', 'user', 'assistant'].map((role) => (
                  <option key={role} value={role}>
                    {t(`llmEditor.role.${role}`)}
                  </option>
                ))}
              </NativeSelect>
              <Button
                aria-label={t('llmEditor.deleteMessage')}
                disabled={disabled || messages.length <= minimum}
                size="icon-xs"
                variant="ghost"
                onClick={() => onChange(messages.filter((_, i) => i !== index))}
              >
                <i className="i-codicon:trash" />
              </Button>
            </div>
            <SimpleCodeEditor
              aria-label={`${t('llmEditor.messagePlaceholder')} / ${index + 1}`}
              className="rounded-md border border-input [&_mark]:bg-accent [&_mark]:text-accent-foreground"
              value={message.content}
              readOnly={disabled}
              placeholder={t('llmEditor.messagePlaceholder')}
              padding={8}
              style={{ minHeight: 100, resize: 'vertical' }}
              highlight={(text) => highlightTemplateText(text, handleNames)}
              onValueChange={(content) => update(index, { content })}
            />
          </div>
        ))}
        <Button disabled={disabled} variant="outline" onClick={() => onChange([...messages, { role: nextRole, content: '' }])}>
          {t('llmEditor.addMessage')}
        </Button>
      </div>
    )
  }
  const model = (value ?? {}) as Record<string, JsonValue>
  const update = (field: string, next: JsonValue | undefined) => {
    const result = { ...model }
    if (next === undefined) delete result[field]
    else result[field] = next
    onChange(result)
  }
  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-2">
        <Input
          aria-label={t('llmEditor.customModel')}
          value={typeof model.model === 'string' ? model.model : ''}
          placeholder={t('llmEditor.defaultModel')}
          disabled={disabled}
          onChange={(event) => update('model', event.target.value || undefined)}
        />
        <Button aria-label={t('llmEditor.modelOptions')} aria-expanded={expanded} size="icon-xs" variant="ghost" onClick={() => setExpanded(!expanded)}>
          <i className="i-carbon:settings-adjust" />
        </Button>
      </div>
      {expanded &&
        (
          [
            ['temperature', 'temperature', defaultLlmTemperature, 0, 2, 0.1],
            ['top_p', 'topP', defaultLlmTopP, 0, 1, 0.1],
            ['max_tokens', 'maxTokens', defaultLlmMaxTokens, 1, maximumLlmOutputTokens, 1],
          ] as const
        ).map(([key, label, fallback, min, max, step]) => (
          <Label key={key} className="grid gap-1 text-sm leading-normal font-normal select-text">
            {t(`llmEditor.${label}`)}
            <Input
              type="number"
              aria-label={t(`llmEditor.${label}`)}
              min={min}
              max={max}
              step={step}
              value={typeof model[key] === 'number' ? model[key] : fallback}
              disabled={disabled}
              onChange={(event) => {
                const next = event.target.valueAsNumber
                if (Number.isFinite(next) && next >= min && next <= max && (step !== 1 || Number.isInteger(next))) update(key, next)
              }}
            />
          </Label>
        ))}
    </div>
  )
}

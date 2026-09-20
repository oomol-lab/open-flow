import type { JsonValue } from '../../../../control/common/api.ts'

import { useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { isJsonObject } from '../../../../base/common/json.ts'
import { feishuResourceKind, supportsFeishuChatFilter } from '../../../../trigger/providers/feishu/config.ts'
import { Button } from '../../../../ui/browser/button.tsx'
import { Checkbox } from '../../../../ui/browser/checkbox.tsx'
import { Input } from '../../../../ui/browser/input.tsx'
import { Label } from '../../../../ui/browser/label.tsx'
import { Textarea } from '../../../../ui/browser/textarea.tsx'
import { SourceSelect } from '../eventSources.tsx'

export function FeishuEventFilters({
  field,
  config,
  events,
  managed,
  disabled,
  onChange,
}: {
  readonly field?: 'chatIds' | 'resource'
  readonly config: Readonly<Record<string, JsonValue>>
  readonly events: readonly string[]
  readonly managed: boolean
  readonly disabled: boolean
  readonly onChange: (name: string, value: JsonValue | undefined) => void
}) {
  const t = useTranslate()
  const resource = isJsonObject(config.resource) ? config.resource : undefined
  const kind = feishuResourceKind(events)
  const chats = Array.isArray(config.chatIds) ? config.chatIds.filter((item): item is string => typeof item == 'string') : []
  const chatSupported = supportsFeishuChatFilter(events)
  return (
    <>
      {field !== 'resource' && (chatSupported || chats.length > 0) && (
        <div className="flex flex-col gap-2">
          {chatSupported ? (
            <ChatFilter key={JSON.stringify(chats)} value={chats} disabled={disabled} onChange={(value) => onChange('chatIds', value)} />
          ) : (
            <>
              <p role="alert" className="m-0 text-sm text-destructive">
                {t('eventSources.incompatibleChats')}
              </p>
              <Button variant="outline" size="sm" className="self-start" disabled={disabled} onClick={() => onChange('chatIds', undefined)}>
                {t('eventSources.removeFilter')}
              </Button>
            </>
          )}
        </div>
      )}
      {field !== 'chatIds' && (kind != null || resource != null) && (
        <div className="flex flex-col gap-3">
          <Label className="flex items-center gap-2">
            <Checkbox
              checked={resource != null}
              disabled={disabled || (resource == null && (!managed || kind == null))}
              onCheckedChange={(checked) =>
                onChange('resource', checked ? { kind: kind!, id: '', ...(kind == 'document' ? { documentType: 'docx' } : {}) } : undefined)
              }
            />
            {t('eventSources.subscribeResource')}
          </Label>
          <p className="m-0 text-xs leading-5 text-muted-foreground">{t('eventSources.subscribeResourceHint')}</p>
          {!managed && <p className="m-0 text-xs leading-5 text-muted-foreground">{t('eventSources.managementRequired')}</p>}
          {resource != null && (kind == null || resource.kind != kind) && (
            <p role="alert" className="m-0 text-sm text-destructive">
              {t('eventSources.incompatibleResource')}
            </p>
          )}
          {resource != null && kind != null && resource.kind == kind && (
            <>
              {kind == 'document' && (
                <SourceSelect
                  label={t('eventSources.documentType')}
                  value={typeof resource.documentType == 'string' ? resource.documentType : ''}
                  options={['doc', 'docx', 'sheet', 'bitable', 'file', 'folder'].map((value) => ({ value, label: t(`eventSources.documentTypes.${value}`) }))}
                  disabled={disabled || !managed}
                  onChange={(value) => onChange('resource', { ...resource, documentType: value })}
                />
              )}
              <Label className="flex flex-col items-stretch gap-2">
                {t(`eventSources.resourceIds.${kind}`)}
                <Input
                  value={typeof resource.id == 'string' ? resource.id : ''}
                  disabled={disabled || !managed}
                  required
                  onChange={(event) => onChange('resource', { ...resource, id: event.target.value })}
                />
              </Label>
              <p className="m-0 text-xs leading-5 text-muted-foreground">{t(`eventSources.resourceHints.${kind}`)}</p>
            </>
          )}
        </div>
      )}
    </>
  )
}

function ChatFilter({
  value,
  disabled,
  onChange,
}: {
  readonly value: readonly string[]
  readonly disabled: boolean
  readonly onChange: (value: string[] | undefined) => void
}) {
  const t = useTranslate()
  const [text, setText] = useState(value.join('\n'))
  return (
    <>
      <Label className="flex flex-col items-stretch gap-2">
        {t('eventSources.specifiedChats')}
        <Textarea
          value={text}
          disabled={disabled}
          rows={3}
          onChange={(event) => setText(event.target.value)}
          onBlur={() => {
            const ids = [
              ...new Set(
                text
                  .split('\n')
                  .map((item) => item.trim())
                  .filter(Boolean),
              ),
            ]
            if (JSON.stringify(ids) != JSON.stringify(value)) onChange(ids.length == 0 ? undefined : ids)
          }}
        />
      </Label>
      <p className="m-0 text-xs leading-5 text-muted-foreground">{t('eventSources.specifiedChatsHint')}</p>
    </>
  )
}

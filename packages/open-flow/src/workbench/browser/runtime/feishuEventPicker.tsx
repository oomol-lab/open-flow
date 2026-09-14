import { useId, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { Button } from '../../../ui/browser/button.tsx'
import { Checkbox } from '../../../ui/browser/checkbox.tsx'
import { Input } from '../../../ui/browser/input.tsx'
import { Label } from '../../../ui/browser/label.tsx'

const catalog = [
  { id: 'im.message.receive_v1', group: 'messages' },
  { id: 'im.message.recalled_v1', group: 'messages' },
  { id: 'im.message.reaction.created_v1', group: 'messages' },
  { id: 'im.chat.member.bot.added_v1', group: 'messages' },
  { id: 'drive.file.edit_v1', group: 'documents' },
  { id: 'drive.file.title_updated_v1', group: 'documents' },
  { id: 'drive.file.created_in_folder_v1', group: 'documents' },
  { id: 'drive.file.deleted_v1', group: 'documents' },
  { id: 'drive.file.bitable_record_changed_v1', group: 'base' },
  { id: 'drive.file.bitable_field_changed_v1', group: 'base' },
  { id: 'calendar.calendar.event.changed_v4', group: 'calendar' },
  { id: 'calendar.calendar.changed_v4', group: 'calendar' },
  { id: 'approval.instance.status_changed_v4', group: 'approval' },
  { id: 'approval.task.status_changed_v4', group: 'approval' },
  { id: 'approval_instance', group: 'approval' },
  { id: 'contact.user.created_v3', group: 'contacts' },
  { id: 'contact.user.updated_v3', group: 'contacts' },
  { id: 'contact.user.deleted_v3', group: 'contacts' },
] as const

export function FeishuEventPicker({
  value,
  onChange,
  disabled = false,
  allowedEvents,
}: {
  readonly value: readonly string[]
  readonly onChange: (value: string[]) => void
  readonly disabled?: boolean
  readonly allowedEvents?: readonly string[]
}) {
  const t = useTranslate()
  const id = useId()
  const [search, setSearch] = useState('')
  const [custom, setCustom] = useState('')
  const [invalid, setInvalid] = useState(false)
  const entries = [
    ...catalog
      .filter((entry) => allowedEvents == null || allowedEvents.includes(entry.id))
      .map((entry) => ({ id: entry.id, group: entry.group, label: t(`eventSources.eventNames.${entry.id.replaceAll('.', '_')}`) })),
    ...[...new Set([...(allowedEvents ?? []), ...value])]
      .filter((event) => !catalog.some((entry) => entry.id == event))
      .map((event) => ({ id: event, label: event, group: 'custom' })),
  ]
  const query = search.trim().toLocaleLowerCase()
  const visible = entries.filter((entry) => `${entry.label} ${entry.id}`.toLocaleLowerCase().includes(query))
  const unavailable = allowedEvents == null ? [] : value.filter((event) => !allowedEvents.includes(event))
  function addCustom() {
    const event = custom.trim()
    if (!/^[a-z][a-z0-9_.]{0,127}$/.test(event) || event == 'card.action.trigger' || event == 'app_ticket') {
      setInvalid(true)
      return
    }
    if (!value.includes(event)) onChange([...value, event])
    setCustom('')
    setInvalid(false)
  }
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Label htmlFor={id}>{t('eventSources.events')}</Label>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((event) => (
            <Button
              key={event}
              type="button"
              variant="outline"
              size="sm"
              className="h-auto max-w-full gap-2 py-1"
              disabled={disabled}
              aria-label={`${t('eventSources.delete')}: ${event}`}
              onClick={() => onChange(value.filter((item) => item != event))}
            >
              <span className="truncate">{entries.find((entry) => entry.id == event)?.label ?? event}</span>
              <span aria-hidden="true">×</span>
            </Button>
          ))}
        </div>
      )}
      <Input
        id={id}
        type="search"
        value={search}
        disabled={disabled}
        placeholder={t('eventSources.searchEvents')}
        aria-label={t('eventSources.searchEvents')}
        onChange={(event) => setSearch(event.target.value)}
      />
      <div className="max-h-64 overflow-auto rounded-lg border border-border p-2" role="group" aria-label={t('eventSources.events')}>
        {[...new Set(visible.map((entry) => entry.group))].map((group) => (
          <section key={group} className="mb-3 last:mb-0">
            <h4 className="m-0 px-2 py-1 text-xs font-medium text-muted-foreground">{t(`eventSources.eventGroups.${group}`)}</h4>
            {visible
              .filter((entry) => entry.group == group)
              .map((entry) => (
                <Label key={entry.id} className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-2 font-normal hover:bg-muted">
                  <Checkbox
                    className="mt-0.5"
                    checked={value.includes(entry.id)}
                    disabled={disabled || (!value.includes(entry.id) && value.length >= 200)}
                    onCheckedChange={(checked) => onChange(checked === true ? [...value, entry.id] : value.filter((event) => event != entry.id))}
                  />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-sm leading-5">{entry.label}</span>
                    {entry.label != entry.id && <code className="break-all text-xs leading-4 font-normal text-muted-foreground">{entry.id}</code>}
                  </span>
                </Label>
              ))}
          </section>
        ))}
        {visible.length == 0 && <p className="m-0 p-2 text-sm text-muted-foreground">{t('eventSources.noEventMatches')}</p>}
      </div>
      {value.length == 0 && <p className="m-0 text-xs text-muted-foreground">{t('eventSources.chooseEvents')}</p>}
      {unavailable.length > 0 && (
        <p role="alert" className="m-0 text-xs text-destructive">
          {t('eventSources.eventUnavailable')} {unavailable.join(', ')}
        </p>
      )}
      {allowedEvents == null && (
        <details>
          <summary className="cursor-pointer text-xs text-muted-foreground">{t('eventSources.customEvent')}</summary>
          <div className="mt-2 flex gap-2">
            <Input
              className="min-w-0 font-mono text-xs"
              value={custom}
              disabled={disabled}
              aria-label={t('eventSources.customEvent')}
              aria-invalid={invalid || undefined}
              placeholder="example.event_v1"
              onChange={(event) => {
                setCustom(event.target.value)
                setInvalid(false)
              }}
              onKeyDown={(event) => {
                if (event.key == 'Enter') {
                  event.preventDefault()
                  if (!disabled && custom.trim() && value.length < 200) addCustom()
                }
              }}
            />
            <Button type="button" variant="outline" disabled={disabled || !custom.trim() || value.length >= 200} onClick={addCustom}>
              {t('eventSources.addCustom')}
            </Button>
          </div>
          {invalid && (
            <p role="alert" className="m-0 mt-2 text-xs text-destructive">
              {t('eventSources.customInvalid')}
            </p>
          )}
        </details>
      )}
    </div>
  )
}

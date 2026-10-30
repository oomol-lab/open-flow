import { dequal } from 'dequal'
import { useEffect, useId, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { ValueEditorFeedback } from '../../../../form/browser/fieldControl.tsx'
import { isHttpHost, maxHttpHosts } from '../../../../http/common/hosts.ts'
import { Field, FieldDescription, FieldLabel } from '../../../../ui/browser/field.tsx'
import { Textarea } from '../../../../ui/browser/textarea.tsx'

/** Edits the hosts of a Code `http` Capability, one per line; an empty list removes the Capability. */
export function CodeHttpHosts({
  disabled,
  hosts,
  onSave,
}: {
  readonly disabled: boolean
  readonly hosts: readonly string[]
  readonly onSave: (hosts: readonly string[]) => Promise<boolean>
}) {
  const t = useTranslate()
  const id = useId()
  const saved = hosts.join('\n')
  const [draft, setDraft] = useState(saved)
  const [error, setError] = useState<string>()
  useEffect(() => {
    setDraft(saved)
    setError(undefined)
  }, [saved])
  const commit = async () => {
    const next = [...new Set(draft.split(/[\s,]+/).flatMap((host) => (host == '' ? [] : [host.toLowerCase()])))]
    const invalid = next.find((host) => !isHttpHost(host))
    if (invalid != null) return setError(t('inspector.task.httpHostsInvalid', { host: invalid }))
    if (next.length > maxHttpHosts) return setError(t('inspector.task.httpHostsLimit', { count: maxHttpHosts }))
    setError(undefined)
    if (dequal(next, hosts)) setDraft(saved)
    else await onSave(next)
  }
  return (
    <Field data-inspector-section="code-http">
      <FieldLabel className="text-xs font-normal" htmlFor={`${id}-hosts`}>
        {t('inspector.task.httpHosts')}
      </FieldLabel>
      <ValueEditorFeedback error={error}>
        {(errorId) => (
          <Textarea
            aria-describedby={[`${id}-hint`, errorId].filter(Boolean).join(' ')}
            aria-invalid={error != null || undefined}
            className="min-h-14 font-mono text-xs"
            disabled={disabled}
            id={`${id}-hosts`}
            onBlur={() => void commit()}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="api.example.com"
            rows={2}
            spellCheck={false}
            value={draft}
          />
        )}
      </ValueEditorFeedback>
      <FieldDescription id={`${id}-hint`}>{t('inspector.task.httpHostsHint')}</FieldDescription>
    </Field>
  )
}

import type { ReactElement } from 'react'
import type { ResolvedNode } from '../revisionView.ts'
import type { WorkspaceStore } from '../stores/workspaceStore.ts'

import { useEffect, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { Field, FieldError, FieldGroup, FieldLabel } from '../../../../ui/browser/field.tsx'
import { Textarea } from '../../../../ui/browser/textarea.tsx'

export function ResolutionDefinition({
  disabled,
  selection,
  store,
}: {
  readonly disabled: boolean
  readonly selection: Extract<ResolvedNode, { readonly kind: 'approval' | 'wait' }>
  readonly store: WorkspaceStore
}): ReactElement {
  const t = useTranslate()
  const node = selection.node
  const [prompt, setPrompt] = useState(node.prompt)
  const [error, setError] = useState<string>()
  useEffect(() => {
    setPrompt(node.prompt)
    setError(undefined)
  }, [node])
  const save = async (text = prompt): Promise<void> => {
    const value = text.trim()
    if (value.length == 0 || [...value].length > 1000) {
      setError(t('inspector.wait.promptError'))
      return
    }
    setError(undefined)
    await store.saveResolution(selection.id, { name: node.name, prompt: value })
  }
  return (
    <form
      className="inspector-form wait-form"
      data-inspector-section="resolution"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <FieldGroup>
        <Field className="inspector-field-section">
          <FieldLabel className="inspector-section-title" htmlFor={`wait-${selection.id}-prompt`}>
            {t('inspector.wait.prompt')}
          </FieldLabel>
          <Textarea
            id={`wait-${selection.id}-prompt`}
            readOnly={disabled}
            rows={3}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onBlur={(event) => {
              if (event.currentTarget.value.trim() != node.prompt) void save(event.currentTarget.value)
            }}
          />
        </Field>
        {error != null && <FieldError>{error}</FieldError>}
      </FieldGroup>
    </form>
  )
}

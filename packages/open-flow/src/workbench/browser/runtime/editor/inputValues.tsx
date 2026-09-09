import type { ReactElement } from 'react'
import type { FlowRunInputDefinition } from '../../flowRunInputEditorStore.ts'
import type { JsonValue } from '../api.ts'
import type { WorkbenchTheme } from '../contract.ts'

import { useEffect, useRef, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { val } from 'value-enhancer'
import { FlowRunInputEditor } from '../../flowRunInputEditor.tsx'
import { FlowRunInputEditorStore } from '../../flowRunInputEditorStore.ts'

export function InputValues({
  definitions,
  labelledBy,
  language,
  onChange,
  onCommit,
  onValidChange,
  showErrors,
  theme,
  values,
}: {
  readonly labelledBy?: string
  readonly definitions: readonly FlowRunInputDefinition[]
  readonly language: string
  readonly onChange: (values: Readonly<Record<string, JsonValue>>) => void
  readonly onCommit: (values: Readonly<Record<string, JsonValue>>, valid: boolean) => void
  readonly onValidChange: (valid: boolean) => void
  readonly showErrors: boolean
  readonly theme: WorkbenchTheme
  readonly values: Readonly<Record<string, JsonValue>>
}): ReactElement | null {
  const initial = useRef({ definitions, language, values })
  const [resource, setResource] = useState<{ store: FlowRunInputEditorStore; language$: ReturnType<typeof val<string>> }>()
  useEffect(() => {
    const language$ = val(initial.current.language)
    const store = new FlowRunInputEditorStore(initial.current.definitions, language$)
    store.replaceValues(initial.current.values)
    setResource({ store, language$ })
    return () => {
      store.dispose()
      language$.dispose()
    }
  }, [])
  const store = resource?.store
  const inputValues = useVal(store?.values$)
  const valid = useVal(store?.valid$)
  useEffect(() => resource?.language$.set(language), [language, resource])
  useEffect(() => {
    if (store) onChange(store.values() as Readonly<Record<string, JsonValue>>)
  }, [inputValues, onChange, store])
  useEffect(() => {
    if (valid != null) onValidChange(valid)
  }, [onValidChange, valid])
  if (!store) return null

  return (
    <div onBlur={() => onCommit(store.values() as Readonly<Record<string, JsonValue>>, store.valid$.value)}>
      <FlowRunInputEditor labelledBy={labelledBy} showErrors={showErrors} store={store} theme={theme} />
    </div>
  )
}

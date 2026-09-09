import styles from './flowRunInputEditor.module.scss'
import type { ReactElement } from 'react'
import type { WorkbenchTheme } from './runtime/contract.ts'

import { useEffect, useMemo } from 'react'
import { useVal } from 'use-value-enhancer'
import { I18nProvider, useTranslate } from 'val-i18n-react'
import { ValueEditor } from '../../form/browser/valueEditor.tsx'
import { FlowRunInputEditorStore } from './flowRunInputEditorStore.ts'
import { createI18n } from './runtime/i18n.ts'

export { FlowRunInputEditorStore } from './flowRunInputEditorStore.ts'
export type { FlowRunInputDefinition } from './flowRunInputEditorStore.ts'

export function FlowRunInputEditor({
  labelledBy,
  showErrors = false,
  store,
  theme,
}: {
  readonly store: FlowRunInputEditorStore
  readonly theme: WorkbenchTheme
  readonly labelledBy?: string
  readonly showErrors?: boolean
}): ReactElement {
  const language = useVal(store.language)
  const i18n = useMemo(() => createI18n(language), [language])
  useEffect(() => () => i18n.dispose(), [i18n])
  return (
    <I18nProvider i18n={i18n}>
      <div className={`open-flow-theme ${styles.root}`} data-theme={theme}>
        <InputFields store={store} showErrors={showErrors} labelledBy={labelledBy} />
      </div>
    </I18nProvider>
  )
}

function InputFields({ store, showErrors, labelledBy }: { store: FlowRunInputEditorStore; showErrors: boolean; labelledBy?: string }) {
  const t = useTranslate()
  const values = useVal(store.values$)
  const issues = useVal(store.issues$)
  return (
    <>
      {store.definitions.map((definition) => (
        <fieldset className={styles.field} key={definition.handle} aria-labelledby={labelledBy}>
          {labelledBy == null && (
            <legend className={styles.legend}>
              {definition.handle}
              {definition.nullable && <span className={styles.optional}>null</span>}
            </legend>
          )}
          {labelledBy == null && definition.description && <p className={styles.description}>{definition.description}</p>}
          <ValueEditor
            label={definition.handle}
            path={`/${definition.handle.replaceAll('~', '~0').replaceAll('/', '~1')}`}
            schema={definition.jsonSchema}
            nullable={definition.nullable}
            value={Object.hasOwn(values, definition.handle) ? values[definition.handle] : undefined}
            onChange={(value) => store.setValue(definition.handle, value)}
            onDraftIssue={store.setDraftIssue}
          />
          {showErrors && issues[definition.handle] && (
            <p className={styles.error} role="alert">
              {issues[definition.handle]!.message ?? t(`valueEditor.${issues[definition.handle]!.kind}`)}
            </p>
          )}
        </fieldset>
      ))}
    </>
  )
}

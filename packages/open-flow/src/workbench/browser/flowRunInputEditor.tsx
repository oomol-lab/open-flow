import styles from './flowRunInputEditor.module.scss'
import type { ReactElement } from 'react'
import type { WorkbenchTheme } from './runtime/contract.ts'

import { useEffect, useMemo, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { I18nProvider } from 'val-i18n-react'
import { GetPopupContainerContext } from '../../designer/browser/graph/ReactFlowContainer/useGetPopupContainer.ts'
import { createI18n } from '../../designer/browser/i18n/i18n-loader.ts'
import { HandleEditor } from '../../designer/browser/jsonSchema/handleEditor.tsx'
import { HandleEditorProvider } from '../../designer/browser/jsonSchema/handleEditorContext.ts'
import { HandleRowStore } from '../../designer/browser/stores/nodeHandle/handleRow.store.ts'
import { ThemeProvider } from '../../designer/browser/theme/ThemeProvider.tsx'
import { flowRunInputEditorState, FlowRunInputEditorStore } from './flowRunInputEditorStore.ts'

export { FlowRunInputEditorStore } from './flowRunInputEditorStore.ts'
export type { FlowRunInputDefinition } from './flowRunInputEditorStore.ts'

export function FlowRunInputEditor({ store, theme }: { readonly store: FlowRunInputEditorStore; readonly theme: WorkbenchTheme }): ReactElement {
  const state = flowRunInputEditorState(store)
  const handles = useVal(state.inputs.section.$.handles)
  const language = useVal(state.language)
  const [root, setRoot] = useState<HTMLDivElement | null>(null)
  const i18n = useMemo(() => createI18n(language), [language])
  const popupContainers = useMemo(
    () => ({
      default: () => root ?? document.body,
      static: () => root ?? document.body,
    }),
    [root],
  )

  useEffect(() => () => i18n.dispose(), [i18n])

  return (
    <div className={`oo-designer-root ${styles.root}`} data-workbench-control-scope ref={setRoot}>
      <GetPopupContainerContext.Provider value={popupContainers}>
        <I18nProvider i18n={i18n}>
          <ThemeProvider dark={theme == 'dark'} getPopupContainer={popupContainers.static}>
            <HandleEditorProvider value={{}}>
              {handles.flatMap((handle) => {
                if (!HandleRowStore.is(handle)) return []
                const definition = state.definitions.find((candidate) => candidate.handle == handle.name)!
                return [
                  <fieldset className={styles.field} key={handle.name}>
                    <legend className={styles.legend}>
                      <span>{handle.name}</span>
                      {definition.nullable && <span className={styles.optional}>null</span>}
                    </legend>
                    {definition.description != null && <p className={styles.description}>{definition.description}</p>}
                    <div className={styles.value}>
                      <HandleEditor panelWidth$={state.panelWidth$} presentation="form" showSchemaSettings={false} store={handle} />
                    </div>
                  </fieldset>,
                ]
              })}
            </HandleEditorProvider>
          </ThemeProvider>
        </I18nProvider>
      </GetPopupContainerContext.Provider>
    </div>
  )
}

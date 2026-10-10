import type { ReactNode } from 'react'

import { useTranslate } from 'val-i18n-react'

/** Keeps the Workbench mounted while the host supplies its catalog page layout. */
export function WorkflowPage({ catalog, children }: { readonly catalog: boolean; readonly children: ReactNode }) {
  const t = useTranslate()
  return (
    <div className={catalog ? 'host-page' : 'host-workflow-editor'}>
      <div className={catalog ? 'host-page-content' : 'host-workflow-editor'}>
        {catalog && (
          <header className="host-page-header host-workflow-heading">
            <h1>{t('flows.title')}</h1>
            <p>{t('flows.description')}</p>
          </header>
        )}
        {children}
      </div>
    </div>
  )
}

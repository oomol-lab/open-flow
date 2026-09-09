import type { DesignerStore } from '../stores/designer/designer.store.ts'

import { createContext, useContext } from 'react'

const DesignerStoreContext: React.Context<DesignerStore | null> = createContext<DesignerStore | null>(null)

export const DesignerStoreProvider: React.FC<{
  readonly value: DesignerStore | null
  readonly children?: React.ReactNode
}> = (props) => {
  return <DesignerStoreContext.Provider value={props.value}>{props.children}</DesignerStoreContext.Provider>
}

export const useDesignerStore = (): DesignerStore => {
  const context = useContext(DesignerStoreContext)
  if (!context) {
    throw new Error('DesignerContext not found')
  }
  return context
}

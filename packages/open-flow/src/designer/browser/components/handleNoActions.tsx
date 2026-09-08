import { createContext, useContext } from 'react'

export const HandleNoActionsContext: React.Context<boolean> = /*#__PURE__*/ createContext<boolean>(false)

export function HandleNoActions({ children }: { children?: React.ReactNode }): React.ReactElement {
  return <HandleNoActionsContext.Provider value={true}>{children}</HandleNoActionsContext.Provider>
}

export function HandleWithActions({ children }: { children?: React.ReactNode }): React.ReactElement {
  return <HandleNoActionsContext.Provider value={false}>{children}</HandleNoActionsContext.Provider>
}

export function useHandleNoActions(): boolean {
  return useContext(HandleNoActionsContext)
}

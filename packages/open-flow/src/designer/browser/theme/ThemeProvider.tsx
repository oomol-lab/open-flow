import { createContext, useContext, useMemo } from 'react'

export interface ThemeData {
  isDark: boolean
}

export interface ThemeProviderProps {
  readonly children?: React.ReactNode
  readonly dark: boolean
  /** Retained for callers that provide local overlay roots. Shared primitives receive this directly. */
  readonly getPopupContainer?: (triggerNode?: HTMLElement) => HTMLElement
}

const ThemeContext = createContext<ThemeData | null>({ isDark: false })

export function ThemeProvider({ children, dark }: ThemeProviderProps): React.ReactElement {
  const theme = useMemo(() => ({ isDark: dark }), [dark])

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
}

export const useThemeData = (): ThemeData => {
  const data = useContext(ThemeContext)

  if (!data) {
    throw new Error('Must be used within a ThemeProvider')
  }

  return data
}

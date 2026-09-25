import { createContext } from 'react'

/** Resource selection only; visual styling remains owned by theme.css. */
export const IconThemeContext = createContext<'light' | 'dark'>('light')

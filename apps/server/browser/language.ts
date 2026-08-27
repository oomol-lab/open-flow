import type { WorkbenchLanguage } from '@oomol-lab/open-flow/workbench'

import { isWorkbenchLanguage, resolveWorkbenchLanguage } from '@oomol-lab/open-flow/workbench'

export const languagePreference = 'open-flow.workbench.language'

/** The stored operator preference when it is still supported, otherwise the closest browser language. */
export function initialLanguage(): WorkbenchLanguage {
  const preferred = localStorage.getItem(languagePreference)
  if (isWorkbenchLanguage(preferred)) return preferred
  return resolveWorkbenchLanguage(navigator.languages)
}

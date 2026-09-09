import type { ReadonlyVal } from 'value-enhancer'

import { flatten, from } from 'value-enhancer'

export type PreferredColorScheme = 'auto' | 'dark' | 'light'

export interface BrowserThemeProps {
  readonly preferredColorScheme$: ReadonlyVal<PreferredColorScheme>
}

export class BrowserTheme {
  public readonly darkMode$: ReadonlyVal<boolean>

  public constructor(props: BrowserThemeProps) {
    this.darkMode$ = flatten(props.preferredColorScheme$, (preferredColorScheme) => {
      if (preferredColorScheme == 'auto') {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)')
        return from(
          () => prefersDark.matches,
          (notify) => {
            prefersDark.addEventListener('change', notify)
            return () => prefersDark.removeEventListener('change', notify)
          },
        )
      } else {
        return preferredColorScheme == 'dark'
      }
    })
  }

  public dispose(): void {
    this.darkMode$.dispose()
  }
}

import type { ReactElement } from 'react'
import type { UiLanguage } from '../../localization/common/languages.ts'

import { useState } from 'react'
import { uiLanguages, uiLanguageNames } from '../../localization/common/languages.ts'
import { Button, buttonVariants } from './button.tsx'
import { HostTooltip } from './hostTooltip.tsx'
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from './popover.tsx'
import { cn } from './utils.ts'

export type HostThemeMode = 'light' | 'dark' | 'auto'

export interface HostNavigationActionsProps {
  readonly className?: string
  readonly language: UiLanguage
  readonly onLanguageChange: (language: UiLanguage) => void
  readonly theme: HostThemeMode
  readonly onThemeChange: (theme: HostThemeMode) => void
  readonly labels: Readonly<Record<HostThemeMode | 'theme' | 'language', string>>
}

const themeIcons = { light: 'i-lucide-light:sun', dark: 'i-lucide-light:moon', auto: 'i-lucide-light:sun-moon' }
const actionClassName = 'rounded-full bg-foreground/3 text-foreground hover:bg-foreground/7 dark:hover:bg-foreground/7'

/** Shared host navigation; each host owns preference storage and localized labels. */
export function HostNavigationActions({ className, language, onLanguageChange, theme, onThemeChange, labels }: HostNavigationActionsProps): ReactElement {
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  return (
    <div ref={setContainer} className={cn('flex items-center gap-2', className)}>
      <HostTooltip label="GitHub" side="bottom">
        <a
          href="https://github.com/oomol-lab/open-flow"
          target="_blank"
          rel="noopener noreferrer"
          className={buttonVariants({ variant: 'ghost', size: 'icon', className: actionClassName })}
          aria-label="GitHub"
        >
          <i aria-hidden="true" className="i-lucide-light:github size-4" />
        </a>
      </HostTooltip>
      <Popover>
        <HostTooltip label={labels.theme} side="bottom">
          <PopoverTrigger render={<Button className={actionClassName} variant="ghost" size="icon" type="button" aria-label={labels.theme} />}>
            <i aria-hidden="true" className={`${themeIcons[theme]} size-4`} />
          </PopoverTrigger>
        </HostTooltip>
        <PopoverContent container={container} align="end" positionMethod="fixed" className="open-flow-navigation-menu ring-0" aria-label={labels.theme}>
          {(['light', 'dark', 'auto'] as const).map((value) => (
            <PopoverClose
              key={value}
              render={<Button multiline className="justify-start gap-2" variant="ghost" size="sm" />}
              type="button"
              aria-pressed={theme == value}
              onClick={() => onThemeChange(value)}
            >
              <i aria-hidden="true" className={`${themeIcons[value]} size-4 shrink-0`} />
              {labels[value]}
            </PopoverClose>
          ))}
        </PopoverContent>
      </Popover>
      <Popover>
        <HostTooltip label={labels.language} side="bottom">
          <PopoverTrigger render={<Button className={actionClassName} variant="ghost" size="icon" type="button" aria-label={labels.language} />}>
            <i aria-hidden="true" className="i-lucide-light:languages size-4" />
          </PopoverTrigger>
        </HostTooltip>
        <PopoverContent container={container} align="end" positionMethod="fixed" className="open-flow-navigation-menu ring-0" aria-label={labels.language}>
          {uiLanguages.map((value) => (
            <PopoverClose
              key={value}
              render={<Button multiline variant="ghost" size="sm" />}
              type="button"
              aria-pressed={language == value}
              onClick={() => onLanguageChange(value)}
            >
              {uiLanguageNames[value]}
            </PopoverClose>
          ))}
        </PopoverContent>
      </Popover>
    </div>
  )
}

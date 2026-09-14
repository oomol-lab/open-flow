import type { ComponentProps } from 'react'

import { DayPicker } from 'react-day-picker'
import { enUS, fr, ja, ko, ru, zhCN, zhTW } from 'react-day-picker/locale'
import { useVal } from 'use-value-enhancer'
import { useI18n } from 'val-i18n-react'
import { buttonVariants } from './button.tsx'
import { cn } from './utils.ts'

const locales = { 'en': enUS, fr, ja, ko, ru, 'zh-CN': zhCN, 'zh-TW': zhTW }

export function Calendar(props: ComponentProps<typeof DayPicker>) {
  const language = useVal(useI18n(true)?.lang$ ?? 'en')
  return (
    <DayPicker
      locale={locales[language as keyof typeof locales] ?? enUS}
      showOutsideDays
      classNames={{
        root: 'relative w-fit text-xs',
        months: 'relative',
        month_caption: 'flex h-8 items-center justify-center mb-2',
        caption_label: 'font-medium',
        nav: 'absolute inset-x-0 top-0 flex justify-between pointer-events-none',
        button_previous: cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'pointer-events-auto'),
        button_next: cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'pointer-events-auto'),
        month_grid: 'border-collapse',
        weekday: 'h-8 w-8 text-muted-foreground font-normal',
        day: 'p-0 text-center group/day',
        day_button: cn(
          buttonVariants({ variant: 'ghost', size: 'icon' }),
          'text-xs font-normal group-aria-selected/day:bg-primary group-aria-selected/day:text-primary-foreground',
        ),
        outside: 'text-muted-foreground opacity-50',
        disabled: 'opacity-40',
        hidden: 'invisible',
        today: 'font-semibold underline underline-offset-4',
      }}
      components={{
        Chevron: ({ orientation }) => (
          <i aria-hidden="true" className={orientation === 'left' ? 'i-lucide-light:chevron-left' : 'i-lucide-light:chevron-right'} />
        ),
      }}
      {...props}
    />
  )
}

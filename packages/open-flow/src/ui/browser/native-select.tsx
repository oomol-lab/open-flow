import { ChevronDownIcon } from 'lucide-react'
import * as React from 'react'
import { cn } from './utils.ts'

type NativeSelectProps = Omit<React.ComponentProps<'select'>, 'size'> & {
  size?: 'sm' | 'default'
}

function NativeSelect({ className, size = 'default', ...props }: NativeSelectProps) {
  return (
    <div className={cn('group/native-select relative w-fit has-[select:disabled]:opacity-50', className)} data-slot="native-select-wrapper" data-size={size}>
      <select
        data-slot="native-select"
        data-size={size}
        className="h-8 w-full min-w-0 appearance-none rounded-[var(--ui-control-radius,calc(var(--ui-radius)_+_2px))] border border-input bg-[var(--ui-control-background,var(--ui-muted))] py-1 pr-8 pl-2.5 text-sm transition-colors outline-none select-none selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground data-[slot=native-select]:focus-visible:text-field-focus data-[slot=native-select]:focus-visible:aria-invalid:invalid-text-field-focus disabled:pointer-events-none disabled:cursor-not-allowed aria-invalid:border-destructive data-[size=sm]:h-7 data-[size=sm]:rounded-[var(--ui-control-radius,var(--ui-radius))] data-[size=sm]:py-0.5 dark:bg-[var(--ui-control-background,var(--ui-muted))] dark:hover:bg-input/50"
        {...props}
      />
      <ChevronDownIcon
        className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground select-none"
        aria-hidden="true"
        data-slot="native-select-icon"
      />
    </div>
  )
}

function NativeSelectOption({ className, ...props }: React.ComponentProps<'option'>) {
  return <option data-slot="native-select-option" className={cn('bg-[Canvas] text-[CanvasText]', className)} {...props} />
}

function NativeSelectOptGroup({ className, ...props }: React.ComponentProps<'optgroup'>) {
  return <optgroup data-slot="native-select-optgroup" className={cn('bg-[Canvas] text-[CanvasText]', className)} {...props} />
}

export { NativeSelect, NativeSelectOptGroup, NativeSelectOption }

import { Checkbox as CheckboxPrimitive } from '@base-ui/react/checkbox'
import { CheckIcon, MinusIcon } from 'lucide-react'
import { cn } from './utils.ts'

function Checkbox({ className, indeterminate, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      indeterminate={indeterminate}
      className={cn(
        'peer relative flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-input transition-colors outline-none group-has-disabled/field:opacity-[var(--ui-disabled-opacity,0.5)] group-has-[:focus-visible]/field-label:outline-none group-has-[:focus-visible]/field-label:not-data-checked:border-input after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:outline-2 focus-visible:outline-solid focus-visible:ring-0 focus-visible:aria-invalid:ring-0 focus-visible:outline-offset-1 focus-visible:outline-ring focus-visible:aria-invalid:outline-destructive disabled:cursor-[var(--ui-disabled-cursor,not-allowed)] disabled:opacity-[var(--ui-disabled-opacity,0.5)] aria-invalid:border-destructive aria-invalid:aria-checked:border-destructive dark:not-data-disabled:bg-input/30 data-disabled:data-indeterminate:bg-[color-mix(in_srgb,var(--ui-foreground)_3%,var(--ui-control-background,var(--ui-background)))] data-disabled:data-indeterminate:text-muted-foreground data-disabled:data-checked:bg-clip-padding data-disabled:data-checked:bg-primary/60 data-disabled:data-checked:border-primary/60 data-disabled:data-checked:text-primary-foreground not-data-disabled:data-checked:border-primary not-data-disabled:data-checked:bg-primary not-data-disabled:data-checked:text-primary-foreground group-has-[:focus-visible]/field-label:not-data-disabled:data-checked:border-primary dark:not-data-disabled:data-checked:bg-primary',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator data-slot="checkbox-indicator" className="grid place-content-center text-current transition-none [&>svg]:size-3.5">
        {indeterminate ? <MinusIcon strokeWidth={1.5} /> : <CheckIcon />}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }

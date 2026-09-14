import { Input as InputPrimitive } from '@base-ui/react/input'
import * as React from 'react'
import { cn } from './utils.ts'

const Input = React.forwardRef<HTMLInputElement, React.ComponentPropsWithoutRef<'input'>>(function Input({ className, type, ...props }, ref) {
  return (
    <InputPrimitive
      ref={ref}
      type={type}
      data-slot="input"
      className={cn(
        'h-8 w-full min-w-0 rounded-[var(--ui-control-radius,calc(var(--ui-radius)_+_2px))] border border-input bg-[var(--ui-control-background,var(--ui-muted))] px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground read-only:cursor-default placeholder:text-muted-foreground data-[slot=input]:focus-visible:text-field-focus data-[slot=input]:focus-visible:aria-invalid:invalid-text-field-focus disabled:pointer-events-none disabled:cursor-[var(--ui-disabled-cursor,not-allowed)] disabled:bg-[var(--ui-disabled-background,color-mix(in_srgb,var(--ui-input)_50%,transparent))] disabled:opacity-[var(--ui-disabled-opacity,0.5)] aria-invalid:border-destructive md:text-sm dark:bg-[var(--ui-control-background,var(--ui-muted))] dark:disabled:bg-[var(--ui-disabled-background,color-mix(in_srgb,var(--ui-input)_80%,transparent))]',
        className,
      )}
      {...props}
    />
  )
})

export { Input }

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
        'h-8 w-full min-w-0 rounded-[var(--ui-control-radius,calc(var(--ui-radius)_+_2px))] border border-input bg-[var(--ui-control-background,var(--ui-muted))] px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground data-[slot=input]:focus-visible:text-field-focus data-[slot=input]:focus-visible:aria-invalid:invalid-text-field-focus disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive md:text-sm dark:bg-[var(--ui-control-background,var(--ui-muted))] dark:disabled:bg-input/80',
        className,
      )}
      {...props}
    />
  )
})

export { Input }

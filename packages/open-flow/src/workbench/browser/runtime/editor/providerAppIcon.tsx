import { ContentIcon } from '../../../../ui/browser/icons/ContentIcon.tsx'

export function ProviderAppIcon({ src }: { src?: string }) {
  return (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-[9px] bg-popover border border-[color-mix(in_srgb,var(--ui-foreground)_9%,var(--ui-popover))] text-[16px] group-hover/app:border-[color-mix(in_srgb,var(--ui-foreground)_14%,var(--ui-popover))] group-focus-visible/app:border-[color-mix(in_srgb,var(--ui-foreground)_14%,var(--ui-popover))] [--content-icon-initials-background:transparent]">
      <ContentIcon src={src} loading="eager" decoding="sync" className="size-4 data-[icon-kind=initials]:text-[20px]" />
    </span>
  )
}

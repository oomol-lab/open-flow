import { useTranslate } from 'val-i18n-react'
import { Button } from '../../../../ui/browser/button.tsx'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../../../../ui/browser/empty.tsx'

export interface WorkspaceRecoveryProps {
  readonly kind: 'failed' | 'repair' | 'upgrade'
  readonly message?: string
  readonly repairing?: boolean
  readonly onRepair: () => void
  readonly onRetry: () => void
}

export function WorkspaceRecovery({ kind, message, repairing = false, onRepair, onRetry }: WorkspaceRecoveryProps) {
  const t = useTranslate()
  const recoverable = kind != 'failed'
  return (
    <Empty aria-busy={repairing} className="h-full" role="alert">
      <EmptyHeader>
        <EmptyMedia className="size-12 rounded-xl" variant="icon">
          <i aria-hidden="true" className={kind == 'upgrade' ? 'i-lucide-light:wand-sparkles text-2xl' : 'i-lucide-light:file-warning text-2xl'} />
        </EmptyMedia>
        <EmptyTitle className="text-lg font-semibold">{t(`workspace.recovery.${kind}.title`)}</EmptyTitle>
        <EmptyDescription>{t(`workspace.recovery.${kind}.description`)}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        {message == null ? null : <p className="text-destructive">{message}</p>}
        {recoverable ? (
          <Button className="px-5" disabled={repairing} onClick={onRepair} size="lg" variant={kind == 'repair' ? 'destructive' : 'default'}>
            {repairing ? <i aria-hidden="true" className="i-lucide-light:refresh-cw size-4 animate-spin motion-reduce:animate-none" /> : null}
            {t(repairing ? 'workspace.recovery.repairing' : `workspace.recovery.${kind}.action`)}
          </Button>
        ) : (
          <Button className="px-5" disabled={repairing} onClick={onRetry} size="lg" variant="outline">
            {t('empty.retry')}
          </Button>
        )}
      </EmptyContent>
    </Empty>
  )
}

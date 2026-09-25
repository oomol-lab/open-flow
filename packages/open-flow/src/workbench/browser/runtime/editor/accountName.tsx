import type { ReactElement } from 'react'
import type { ConnectorConnection } from '../../../../control/common/api.ts'

export function accountDisplayName(connection: ConnectorConnection | undefined, fallback: string, builtInName: string): string {
  return connection?.builtInAccount ? builtInName : fallback
}

export function AccountName({
  name,
  builtIn,
  truncate = false,
}: {
  readonly name: string
  readonly builtIn?: boolean
  readonly truncate?: boolean
}): ReactElement {
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <span className={truncate ? 'min-w-0 truncate' : 'min-w-0 wrap-anywhere'}>{name}</span>
      {builtIn && <i aria-hidden="true" className="i-lucide-light:badge-check size-3.5 shrink-0 text-primary" />}
    </span>
  )
}

import { z } from 'zod'
import { canonicalJsonBytes, digestBytes } from '../../flow/common/encoding.ts'

const sourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('admin-delegation') }),
  z.strictObject({ kind: z.literal('policy'), ruleId: z.string().min(1).nullable() }),
])

export type ProviderAccessSource = { readonly kind: 'admin-delegation' } | { readonly kind: 'policy'; readonly ruleId: string | null }

export interface ProviderAccessIdentity {
  readonly accessBindingId: string
  readonly connectionId: string
  readonly providerId: string
  readonly source: ProviderAccessSource
}

export type ProviderAccessReference =
  | ProviderAccessIdentity
  | { readonly accessBindingId: string; readonly providerId: string; readonly connectionId: null; readonly source: null }

export function parseProviderAccessSource(value: unknown): ProviderAccessSource {
  return sourceSchema.parse(value)
}

export async function providerAccessBindingId(teamId: string, identity: Omit<ProviderAccessIdentity, 'accessBindingId'>): Promise<string> {
  return await digestBytes(canonicalJsonBytes(['provider-access', 2, teamId, identity.connectionId, identity.providerId, identity.source]))
}

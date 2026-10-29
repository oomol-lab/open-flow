import { z } from 'zod'

const id = z.string().min(1).max(256)

/** Public projection of a source that Connector validates and Open Flow exposes unchanged. */
export const eventSourceViewSchema = z.object({
  appId: id.nullable(),
  workspaceId: id.optional(),
  installationId: id.optional(),
  organizationId: id.optional(),
  projectId: id.optional(),
  projectKey: id.optional(),
  subscriptionStatus: z.enum(['idle', 'pending', 'ready', 'error']).optional(),
  lastError: z.string().optional(),
  signingSecretConfigured: z.boolean().optional(),
  manageSubscriptions: z.boolean().nullable(),
  verificationTokenConfigured: z.boolean().nullable(),
  encryptKeyConfigured: z.boolean().nullable(),
  verifiedAt: z.string().nullable(),
})

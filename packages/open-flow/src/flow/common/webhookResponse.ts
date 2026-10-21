export const webhookResponseTimeout = {
  defaultMs: 30_000,
  minMs: 1000,
  maxMs: 60_000,
} as const

export const webhookStatusCodePort = { jsonSchema: { type: 'number' }, nullable: true } as const

export function webhookResponseAllowsBody(status: number): boolean {
  return status !== 204 && status !== 205 && status !== 304
}

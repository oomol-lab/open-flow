export const webhookMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

export type WebhookMethod = (typeof webhookMethods)[number]

export function webhookSupportsBody(method: WebhookMethod): boolean {
  return method !== 'GET'
}

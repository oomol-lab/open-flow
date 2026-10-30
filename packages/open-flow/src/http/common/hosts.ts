/** Hosts of a Code `http` Capability: lowercase DNS names or IPv4 addresses; `*.example.com` matches subdomains only. */
export const httpHostPattern = /^(?:\*\.)?(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
export const maxHttpHosts = 20

/** Wildcards must name a registrable suffix, so `*.com` is rejected. */
export function isHttpHost(value: string): boolean {
  return httpHostPattern.test(value) && (!value.startsWith('*.') || value.slice(2).includes('.'))
}

export function httpHostAllowed(hosts: readonly string[], hostname: string): boolean {
  const host = hostname.toLowerCase()
  return hosts.some((pattern) => (pattern.startsWith('*.') ? host.endsWith(pattern.slice(1)) : host == pattern))
}

import type { ArtifactRef, JsonValue } from '../../types/index.ts'

/** Port schema of a runtime-managed ArtifactRef. */
export const artifactSchema = { contentMediaType: 'oomol/artifact' } as const

/** Stored metadata and bytes of a Run Artifact, as the deployment resolves them from its own storage. */
export interface ArtifactContent {
  readonly bytes: Uint8Array
  readonly mediaType?: string
  readonly name: string
}

const maximumNameLength = 255

/** Shape check only: hosts must still resolve the identity in the current Run before trusting the value. */
export function isArtifactRef(value: JsonValue | undefined): value is JsonValue & ArtifactRef {
  if (value == null || typeof value != 'object' || Array.isArray(value)) return false
  const record = value as Readonly<Record<string, JsonValue>>
  return record.kind === 'artifact' && typeof record.id == 'string' && record.id.length > 0
}

/** A lowercase `type/subtype` media type, or undefined when the header is missing or malformed. */
export function artifactMediaType(contentType: string | null | undefined): string | undefined {
  const media = contentType?.split(';')[0]?.trim().toLowerCase()
  return media != null && media.length <= maximumNameLength && /^[!#$%&'*+.^_`|~0-9a-z-]+\/[!#$%&'*+.^_`|~0-9a-z-]+$/.test(media) ? media : undefined
}

/**
 * A downloaded file name: `Content-Disposition` first, then the last URL path segment, then `fallback`. The result is
 * 1–255 characters without path separators or control characters.
 */
export function artifactName(contentDisposition: string | null | undefined, url: string | undefined, fallback = 'response'): string {
  return cleanName(dispositionName(contentDisposition)) ?? cleanName(pathName(url)) ?? fallback
}

/** `Content-Disposition: attachment` with an ASCII fallback and the RFC 6266 UTF-8 `filename*` form. */
export function artifactContentDisposition(name: string): string {
  const cleaned = cleanName(name) ?? 'download'
  const ascii = cleaned.replace(/[^\x20-\x7e]|["\\]/g, '_')
  const encoded = encodeURIComponent(cleaned).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`
}

function dispositionName(value: string | null | undefined): string | undefined {
  if (value == null) return
  const extended = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(value)
  if (extended != null) {
    try {
      return decodeURIComponent(extended[2]!.trim())
    } catch {}
  }
  const quoted = /filename\s*=\s*"((?:[^"\\]|\\.)*)"/i.exec(value)
  if (quoted != null) return quoted[1]!.replace(/\\(.)/g, '$1')
  return /filename\s*=\s*([^;]+)/i.exec(value)?.[1]?.trim()
}

function pathName(url: string | undefined): string | undefined {
  if (url == null) return
  try {
    const segment = new URL(url).pathname.split('/').findLast((part) => part.length > 0)
    return segment == null ? undefined : decodeURIComponent(segment)
  } catch {
    return
  }
}

function cleanName(value: string | undefined): string | undefined {
  // oxlint-disable-next-line no-control-regex
  const cleaned = value?.replace(/[\u0000-\u001f\u007f/\\]/g, '_').trim()
  if (cleaned == null || cleaned.length == 0 || cleaned == '.' || cleaned == '..') return
  // Count code points so a long name never ends in half of a surrogate pair.
  return [...cleaned].slice(0, maximumNameLength).join('')
}

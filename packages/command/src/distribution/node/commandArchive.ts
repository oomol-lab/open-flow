import type { TarHeader } from 'modern-tar'
import type { CommandArtifactManifest } from '../common/commandArtifact.ts'

import { packTar, unpackTar } from 'modern-tar'
import { createHash } from 'node:crypto'
import { gunzipSync, gzipSync } from 'node:zlib'
import {
  commandArtifactEntryFile,
  commandArtifactManifestFile,
  compareCommandArtifactPaths,
  decodeCommandArtifactManifest,
  normalizedCommandArtifactPath,
} from '../common/commandArtifact.ts'

export interface CommandArchiveFile {
  readonly bytes: Uint8Array
  readonly path: string
}

export interface CommandArchiveEntry extends CommandArchiveFile {
  readonly mode: number
}

export interface DecodedCommandArchive {
  readonly files: readonly CommandArchiveEntry[]
  readonly manifest: CommandArtifactManifest
}

export const commandArchiveRoot = 'open-flow-command'
export const commandArchiveExtension = '.tar.gz'
export const commandArchiveMediaType = 'application/vnd.open-flow.command-artifact+tar+gzip'

const archivePrefix = `${commandArchiveRoot}/`
const blockSize = 512
const endMarkerSize = blockSize * 2
const gzipHeaderSize = 10
const gzipFooterSize = 8
const textDecoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false })
const textEncoder = new TextEncoder()

function invalid(message: string): never {
  throw new TypeError(message)
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength == right.byteLength && left.every((byte, index) => byte == right[index])
}

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function modeFor(path: string): number {
  return path == commandArtifactEntryFile ? 0o755 : 0o644
}

function ustarPath(path: string): boolean {
  if (textEncoder.encode(path).byteLength <= 100) return true
  for (let index = path.indexOf('/'); index >= 0; index = path.indexOf('/', index + 1)) {
    const prefix = path.slice(0, index)
    const name = path.slice(index + 1)
    if (name.length > 0 && textEncoder.encode(prefix).byteLength <= 155 && textEncoder.encode(name).byteLength <= 100) return true
  }
  return false
}

function sortedFiles(files: readonly CommandArchiveFile[]): readonly CommandArchiveFile[] {
  const sorted = files.toSorted((left, right) => compareCommandArtifactPaths(left.path, right.path))
  let previousPath: string | undefined
  for (const file of sorted) {
    if (typeof file.path != 'string' || !(file.bytes instanceof Uint8Array)) {
      invalid('Command archive files must contain a string path and Uint8Array bytes.')
    }
    if (!normalizedCommandArtifactPath(file.path)) invalid(`Command archive contains an invalid file path: ${file.path}`)
    if (!ustarPath(`${archivePrefix}${file.path}`)) {
      invalid(`Command archive path cannot be represented by USTAR without an extension: ${file.path}`)
    }
    if (previousPath == file.path) invalid(`Command archive contains duplicate file path: ${file.path}`)
    previousPath = file.path
  }
  return sorted
}

function canonicalGzip(tar: Uint8Array): Uint8Array {
  const compressed = new Uint8Array(gzipSync(tar, { level: 9 }))
  if (compressed.byteLength < gzipHeaderSize + gzipFooterSize || compressed[0] != 0x1f || compressed[1] != 0x8b || compressed[2] != 8) {
    invalid('Bun produced an unsupported gzip stream.')
  }
  compressed[3] = 0
  compressed[4] = 0
  compressed[5] = 0
  compressed[6] = 0
  compressed[7] = 0
  compressed[8] = 2
  compressed[9] = 255
  return compressed
}

function decodeCanonicalGzip(archive: Uint8Array): Uint8Array {
  if (
    archive.byteLength < gzipHeaderSize + gzipFooterSize ||
    archive[0] != 0x1f ||
    archive[1] != 0x8b ||
    archive[2] != 8 ||
    archive[3] != 0 ||
    archive[4] != 0 ||
    archive[5] != 0 ||
    archive[6] != 0 ||
    archive[7] != 0 ||
    archive[8] != 2 ||
    archive[9] != 255
  ) {
    invalid('Command archive does not have the canonical gzip header.')
  }

  let tar: Uint8Array
  try {
    tar = new Uint8Array(gunzipSync(archive))
  } catch (error) {
    throw new TypeError(`Command archive gzip stream cannot be decoded: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  }
  if (!sameBytes(canonicalGzip(tar), archive)) {
    invalid('Command archive gzip stream is truncated, has trailing data, or is not canonically encoded.')
  }
  return tar
}

function zeroBlock(bytes: Uint8Array, offset: number): boolean {
  for (let index = offset; index < offset + blockSize; index += 1) {
    if (bytes[index] != 0) return false
  }
  return true
}

function tarSize(bytes: Uint8Array, headerOffset: number): number {
  const field = bytes.subarray(headerOffset + 124, headerOffset + 136)
  let digits = ''
  let terminated = false
  for (const byte of field) {
    if (byte == 0 || byte == 0x20) {
      terminated = true
      continue
    }
    if (terminated || byte < 0x30 || byte > 0x37) invalid('Command archive contains a non-canonical tar size field.')
    digits += String.fromCharCode(byte)
  }
  if (digits.length == 0) invalid('Command archive contains an empty tar size field.')
  const size = Number.parseInt(digits, 8)
  if (!Number.isSafeInteger(size)) invalid('Command archive contains an unsupported tar entry size.')
  return size
}

function inspectRawTar(tar: Uint8Array): number {
  if (tar.byteLength < endMarkerSize || tar.byteLength % blockSize != 0) {
    invalid('Command archive is not a complete block-aligned tar stream.')
  }

  let entries = 0
  let offset = 0
  while (offset < tar.byteLength) {
    if (zeroBlock(tar, offset)) {
      if (offset + endMarkerSize != tar.byteLength || !zeroBlock(tar, offset + blockSize)) {
        invalid('Command archive has an invalid or non-canonical tar end marker.')
      }
      return entries
    }
    if (tar[offset + 156] != 0x30) {
      invalid('Command archive contains a link, directory, device, metadata, or other non-file tar entry.')
    }
    const size = tarSize(tar, offset)
    const bodyBlocks = Math.ceil(size / blockSize)
    offset += blockSize + bodyBlocks * blockSize
    if (offset > tar.byteLength - endMarkerSize) invalid('Command archive contains a truncated tar entry.')
    entries += 1
  }
  invalid('Command archive is missing its tar end marker.')
}

function validMetadata(header: TarHeader, path: string): boolean {
  return (
    header.type == 'file' &&
    header.mode == modeFor(path) &&
    header.uid == 0 &&
    header.gid == 0 &&
    header.uname == '' &&
    header.gname == '' &&
    header.mtime?.getTime() == 0 &&
    (header.linkname == null || header.linkname == '') &&
    header.pax == null
  )
}

function verifyFiles(files: readonly CommandArchiveEntry[]): CommandArtifactManifest {
  const manifestRecord = files.find((file) => file.path == commandArtifactManifestFile)
  if (manifestRecord == null) invalid(`Command archive is missing ${commandArtifactManifestFile}.`)

  let source: string
  try {
    source = textDecoder.decode(manifestRecord.bytes)
  } catch (error) {
    throw new TypeError(`${commandArtifactManifestFile} is not valid UTF-8.`, { cause: error })
  }
  const manifest = decodeCommandArtifactManifest(source)
  const payloadFiles = files.filter((file) => file.path != commandArtifactManifestFile)
  if (payloadFiles.length != manifest.files.length) invalid('Command archive file set does not match its manifest.')
  for (let index = 0; index < payloadFiles.length; index += 1) {
    const file = payloadFiles[index]!
    const expected = manifest.files[index]!
    if (file.path != expected.path) invalid('Command archive file set does not match its manifest.')
    if (file.bytes.byteLength != expected.length) invalid(`Command archive file length does not match its manifest: ${file.path}`)
    if (digest(file.bytes) != expected.digest) invalid(`Command archive file digest does not match its manifest: ${file.path}`)
  }
  return manifest
}

async function encodeTar(files: readonly CommandArchiveEntry[]): Promise<Uint8Array> {
  return await packTar(
    files.map((file) => ({
      body: file.bytes,
      header: {
        gid: 0,
        gname: '',
        mode: file.mode,
        mtime: new Date(0),
        name: `${archivePrefix}${file.path}`,
        size: file.bytes.byteLength,
        type: 'file',
        uid: 0,
        uname: '',
      },
    })),
  )
}

export async function encodeCommandArchive(files: readonly CommandArchiveFile[]): Promise<Uint8Array> {
  const sorted = sortedFiles(files).map<CommandArchiveEntry>((file) => ({
    bytes: new Uint8Array(file.bytes),
    mode: modeFor(file.path),
    path: file.path,
  }))
  verifyFiles(sorted)
  const tar = await encodeTar(sorted)
  return canonicalGzip(tar)
}

export async function decodeCommandArchive(archive: Uint8Array): Promise<DecodedCommandArchive> {
  if (!(archive instanceof Uint8Array)) invalid('Command archive must be a Uint8Array.')
  const tar = decodeCanonicalGzip(archive)
  const rawEntryCount = inspectRawTar(tar)

  let unpacked: Awaited<ReturnType<typeof unpackTar>>
  try {
    unpacked = await unpackTar(tar, { strict: true })
  } catch (error) {
    throw new TypeError(`Command archive tar stream cannot be decoded: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  }
  if (unpacked.length != rawEntryCount) invalid('Command archive contains hidden tar metadata entries.')

  const files: CommandArchiveEntry[] = []
  let previousPath: string | undefined
  for (const item of unpacked) {
    const archivePath = item.header.name
    if (!archivePath.startsWith(archivePrefix)) invalid(`Command archive entry is outside ${archivePrefix}.`)
    const path = archivePath.slice(archivePrefix.length)
    if (!normalizedCommandArtifactPath(path)) invalid(`Command archive contains an invalid file path: ${archivePath}`)
    if (!ustarPath(archivePath)) invalid(`Command archive contains a path that requires a tar extension: ${archivePath}`)
    if (previousPath != null && compareCommandArtifactPaths(previousPath, path) >= 0) {
      invalid('Command archive paths are not sorted uniquely.')
    }
    if (!validMetadata(item.header, path)) invalid(`Command archive entry has invalid type or metadata: ${archivePath}`)
    if (item.data == null || item.header.size != item.data.byteLength) invalid(`Command archive entry has an invalid body size: ${archivePath}`)
    files.push({ bytes: item.data, mode: modeFor(path), path })
    previousPath = path
  }
  const manifest = verifyFiles(files)
  if (!sameBytes(await encodeTar(files), tar)) invalid('Command archive tar stream is not canonically encoded.')
  return { files, manifest }
}

export async function extractCommandArchive(archive: Uint8Array, write: (entry: CommandArchiveEntry) => Promise<void>): Promise<CommandArtifactManifest> {
  const decoded = await decodeCommandArchive(archive)
  const written: CommandArchiveEntry[] = []
  try {
    for (const file of decoded.files) {
      await write(file)
      written.push(file)
    }
  } catch (error) {
    for (const file of written) await write({ bytes: new Uint8Array(0), mode: file.mode, path: file.path })
    throw error
  }
  return decoded.manifest
}

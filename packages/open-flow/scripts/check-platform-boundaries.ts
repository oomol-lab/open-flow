import type { Identifier, Node, SourceFile, StringLiteralLikeNode } from 'typescript/unstable/ast'
import type { Checker, Project } from 'typescript/unstable/async'

import { builtinModules } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isIdentifier, isStringLiteralLikeNode } from 'typescript/unstable/ast/is'
import { API } from 'typescript/unstable/async'

export type PlatformOwner = 'common' | 'browser' | 'node' | 'worker'

interface BoundaryViolation {
  readonly file: string
  readonly line: number
  readonly message: string
}

const platformOwners: Set<string> = new Set(['common', 'browser', 'node', 'worker'])
const platformDomains: Set<string> = new Set([
  'base',
  'build',
  'compiler',
  'designer',
  'execution',
  'file-picker',
  'localization',
  'manifest',
  'project',
  'runtime',
  'workbench',
])
const nodeModules: Set<string> = new Set(builtinModules.map((name) => name.replace(/^node:/, '')))
const browserPackagePrefixes: readonly string[] = ['antd', 'react', 'react-dom']
const nonPortablePackagePrefixes: readonly string[] = ['@cloudflare/', '@oomol/', 'cloudflare:']
const domGlobals: Set<string> = new Set([
  'document',
  'window',
  'navigator',
  'localStorage',
  'sessionStorage',
  'HTMLElement',
  'HTMLCanvasElement',
  'requestAnimationFrame',
  'requestIdleCallback',
])
const nodeGlobals: Set<string> = new Set(['Buffer', 'process', '__dirname', '__filename'])

function getPlatformOwner(filePath: string): PlatformOwner | undefined {
  const parts = filePath.replaceAll('\\', '/').split('/')
  const sourceIndex = parts.lastIndexOf('src')
  if (sourceIndex < 0) return

  const owner = parts[sourceIndex + 2]
  return isPlatformOwner(owner) ? owner : undefined
}

function getSourceDomain(filePath: string): string | undefined {
  const parts = filePath.replaceAll('\\', '/').split('/')
  const sourceIndex = parts.lastIndexOf('src')
  return sourceIndex < 0 ? undefined : parts[sourceIndex + 1]
}

function isPlatformOwner(value: string | undefined): value is PlatformOwner {
  return value != null && platformOwners.has(value)
}

export function isForbiddenPlatformImport(source: PlatformOwner | undefined, target: PlatformOwner | undefined): boolean {
  return source != null && target != null && target != 'common' && target != source
}

export function isNonPortablePackageImport(specifier: string): boolean {
  return nonPortablePackagePrefixes.some((prefix) => specifier.startsWith(prefix))
}

function isNodeModule(specifier: string): boolean {
  const name = specifier.replace(/^node:/, '').split('/')[0]
  return nodeModules.has(name)
}

function isBrowserPackage(specifier: string): boolean {
  return browserPackagePrefixes.some((prefix) => specifier == prefix || specifier.startsWith(prefix + '/'))
}

function moduleSpecifiers(sourceFile: SourceFile): readonly StringLiteralLikeNode[] {
  return sourceFile.imports.filter(isStringLiteralLikeNode)
}

async function isPlatformGlobal(node: Identifier, checker: Checker, project: Project, platform: PlatformOwner): Promise<string | undefined> {
  const name = node.text
  const expectedLibrary = domGlobals.has(name) ? 'dom' : nodeGlobals.has(name) ? 'node' : undefined
  if (!expectedLibrary) return
  if (platform == 'browser' && expectedLibrary == 'dom') return
  if (platform == 'node' && expectedLibrary == 'node') return

  const declarations = (await checker.getSymbolAtLocation(node))?.declarations
  if (!declarations) return
  const declarationPaths = await Promise.all(
    declarations.map(async (handle) => (await handle.resolve(project))?.getSourceFile().fileName.replaceAll('\\', '/')),
  )
  const isGlobal = declarationPaths.some((declarationPath) => {
    if (!declarationPath) return false
    return expectedLibrary == 'dom' ? declarationPath.endsWith('/lib.dom.d.ts') : declarationPath.includes('/@types/node/')
  })
  return isGlobal ? expectedLibrary : undefined
}

function location(root: string, sourceFile: SourceFile, node: Node): Pick<BoundaryViolation, 'file' | 'line'> {
  return {
    file: path.relative(root, sourceFile.fileName).replaceAll('\\', '/'),
    line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
  }
}

function cloudWorkbenchOwnershipViolations(root: string, sourceFile: SourceFile): readonly BoundaryViolation[] {
  const fileName = sourceFile.fileName.replaceAll('\\', '/')
  const marker = '/workbench/browser/runtime/'
  const index = fileName.indexOf(marker)
  if (index < 0 || /\.(?:spec|test)\.[cm]?[jt]sx?$/.test(fileName)) return []
  const relative = fileName.slice(index + marker.length)
  const allowedChangeOwner = relative == 'api.ts' || relative == 'designer/flowChanges.ts'
  const allowedDocumentReader = relative == 'revisionView.ts'
  const violations: BoundaryViolation[] = []
  const report = (pattern: RegExp, message: string): void => {
    const match = pattern.exec(sourceFile.text)
    if (match == null) return
    violations.push({
      file: path.relative(root, sourceFile.fileName).replaceAll('\\', '/'),
      line: sourceFile.getLineAndCharacterOfPosition(match.index).line + 1,
      message,
    })
  }
  if (!allowedChangeOwner) {
    report(/\bChangeOperation\b/, 'Only the Workbench Flow change builder may construct or name ChangeOperation.')
  }
  if (!allowedDocumentReader && !allowedChangeOwner) {
    report(/\.content\.document\b/, 'Only the Workbench Revision view may traverse Draft FlowDocument data.')
  }
  if (relative.endsWith('.tsx')) {
    report(
      /\b(?:ChangeOperation|InputMapping|FlowDocument|ProjectTrigger)\b/,
      'Workbench components must consume view models and submit user intents instead of persistent Flow Model types.',
    )
  }
  if (relative.startsWith('stores/')) {
    report(
      /\b(?:ChangeOperation|InputMapping|FlowDocument|ProjectTrigger)\b/,
      'Workbench stores must submit user intents instead of operating on persistent Flow Model types.',
    )
  }
  return violations
}

async function checkPlatformBoundaries(root: string = process.cwd()): Promise<readonly BoundaryViolation[]> {
  const configPath = path.join(root, 'tsconfig.json')
  const api = new API()
  const snapshot = await api.updateSnapshot({ openProjects: [configPath] })
  const project = snapshot.getProject(configPath) ?? snapshot.getProjects()[0]
  if (!project) {
    await snapshot.dispose()
    await api.close()
    throw new Error(`No TypeScript project found for ${configPath}.`)
  }

  const violations: BoundaryViolation[] = []
  const seen: Set<string> = new Set()
  const add = (violation: BoundaryViolation): void => {
    const key = `${violation.file}:${violation.line}:${violation.message}`
    if (!seen.has(key)) {
      seen.add(key)
      violations.push(violation)
    }
  }

  const checkSourceFile = async (sourceFile: SourceFile): Promise<void> => {
    for (const violation of cloudWorkbenchOwnershipViolations(root, sourceFile)) add(violation)
    const sourceOwner = getPlatformOwner(sourceFile.fileName)
    if (!sourceOwner) {
      const sourceDomain = getSourceDomain(sourceFile.fileName)
      if (sourceDomain && platformDomains.has(sourceDomain)) {
        add({
          file: path.relative(root, sourceFile.fileName).replaceAll('\\', '/'),
          line: 1,
          message: `Code in the ${sourceDomain} domain has no common, browser, node, or worker owner.`,
        })
      }
      return
    }

    await Promise.all(
      moduleSpecifiers(sourceFile).map(async (specifierNode) => {
        const specifier = specifierNode.text
        if (isNonPortablePackageImport(specifier)) {
          add({
            ...location(root, sourceFile, specifierNode),
            message: `Portable package code imports deployment-owned module '${specifier}'.`,
          })
          return
        }
        if (sourceOwner != 'node' && isNodeModule(specifier)) {
          add({
            ...location(root, sourceFile, specifierNode),
            message: `${sourceOwner} code imports Node module '${specifier}'.`,
          })
          return
        }
        if (sourceOwner != 'browser' && isBrowserPackage(specifier)) {
          add({
            ...location(root, sourceFile, specifierNode),
            message: `common code imports browser package '${specifier}'.`,
          })
          return
        }

        const declarations = (await project.checker.getSymbolAtLocation(specifierNode))?.declarations ?? []
        const declarationNodes = await Promise.all(declarations.map((handle) => handle.resolve(project)))
        const declaration = declarationNodes.find(Boolean)
        const declarationPath = declaration?.getSourceFile().fileName
        if (
          /^\..*\.[cm]?[jt]sx?$/.test(specifier) &&
          declarationPath != null &&
          declarationPath.startsWith(path.resolve(root, '../..') + path.sep) &&
          !declarationPath.startsWith(root + path.sep)
        ) {
          add({
            ...location(root, sourceFile, specifierNode),
            message: `Portable package code imports workspace source outside packages/open-flow through '${specifier}'.`,
          })
          return
        }
        const targetOwner = declaration ? getPlatformOwner(declaration.getSourceFile().fileName) : undefined
        if (isForbiddenPlatformImport(sourceOwner, targetOwner)) {
          add({
            ...location(root, sourceFile, specifierNode),
            message: `${sourceOwner} code imports ${targetOwner} module '${specifier}'.`,
          })
        }
      }),
    )

    const identifiers: Identifier[] = []
    const collectIdentifiers = (node: Node): void => {
      if (isIdentifier(node)) identifiers.push(node)
      node.forEachChild(collectIdentifiers)
    }
    collectIdentifiers(sourceFile)
    await Promise.all(
      identifiers.map(async (identifier) => {
        const library = await isPlatformGlobal(identifier, project.checker, project, sourceOwner)
        if (library) {
          add({
            ...location(root, sourceFile, identifier),
            message: `${sourceOwner} code uses ${library == 'dom' ? 'browser' : 'Node'} global '${identifier.text}'.`,
          })
        }
      }),
    )
  }

  try {
    const sourceRoot = path.join(root, 'src') + path.sep
    const sourceFileNames = (await project.program.getSourceFileNames()).filter((fileName) => fileName.startsWith(sourceRoot))
    const sourceFiles = (await Promise.all(sourceFileNames.map((fileName) => project.program.getSourceFile(fileName)))).filter(
      (sourceFile): sourceFile is SourceFile => sourceFile != null && !sourceFile.isDeclarationFile,
    )
    await Promise.all(sourceFiles.map(checkSourceFile))
  } finally {
    await snapshot.dispose()
    await api.close()
  }

  return violations.toSorted((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.message.localeCompare(b.message))
}

async function main(): Promise<void> {
  const violations = await checkPlatformBoundaries()
  if (violations.length == 0) return
  for (const violation of violations) {
    console.error(`${violation.file}:${violation.line}: ${violation.message}`)
  }
  process.exitCode = 1
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined
if (entryPath == fileURLToPath(import.meta.url)) await main()

import type { ServerServiceOptions } from '../node/application/service-options.ts'

import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Scope from 'effect/Scope'
import { onTestFinished } from 'vitest'
import { ServerService } from '../node/application/service.ts'
import { Database } from '../node/storage/database.ts'

const scopes = new WeakMap<ServerService, Scope.Closeable>()
const databases = new WeakMap<ServerService, Database>()
const openServices = new Set<ServerService>()

export async function openService(file: string, options: ServerServiceOptions = {}): Promise<ServerService> {
  const database = Database.open(file)
  const scope = await Effect.runPromise(Scope.make())
  try {
    const service = await Effect.runPromise(ServerService.open(database, options).pipe(Scope.provide(scope)))
    scopes.set(service, scope)
    databases.set(service, database)
    openServices.add(service)
    onTestFinished(() => closeService(service))
    return service
  } catch (error) {
    await Effect.runPromise(Scope.close(scope, Exit.void))
    database.close()
    throw error
  }
}

export async function closeService(service: ServerService): Promise<void> {
  const scope = scopes.get(service)
  if (scope == null) return
  scopes.delete(service)
  openServices.delete(service)
  await Effect.runPromise(Scope.close(scope, Exit.void))
  databases.get(service)?.close()
  databases.delete(service)
}

export async function closeOpenServices(): Promise<void> {
  await Promise.all([...openServices].map(closeService))
}

export async function startService(service: ServerService): Promise<void> {
  const scope = scopes.get(service)
  if (scope == null) throw new Error('Server Service test Scope is closed.')
  await Effect.runPromise(service.start().pipe(Scope.provide(scope)))
}

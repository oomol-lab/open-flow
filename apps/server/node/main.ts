import { serve } from '@hono/node-server'
import * as Cause from 'effect/Cause'
import * as Deferred from 'effect/Deferred'
import * as Effect from 'effect/Effect'
import { randomBytes } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServerApp } from './http.ts'
import { createLogger } from './logger.ts'
import { migrateDatabase } from './migrate.ts'
import { OperatorStore } from './operator-store.ts'
import { OperatorSession } from './operator.ts'
import { ServerService } from './service.ts'
import { SettingsStore } from './settings-store.ts'
import { Settings } from './settings.ts'

const logger = createLogger()
const shutdownTimeoutMs = 30_000

await Effect.runPromise(main())

function main(): Effect.Effect<void> {
  let stoppingSignal: NodeJS.Signals | undefined
  return Effect.scoped(
    Effect.gen(function* () {
      const host = process.env.OPEN_FLOW_HOST ?? '127.0.0.1'
      const port = Number(process.env.OPEN_FLOW_PORT ?? '3000')
      if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new Error('OPEN_FLOW_PORT must be an integer between 0 and 65535.')
      const dataDirectory = path.resolve(process.env.OPEN_FLOW_DATA_DIR ?? '.open-flow-dev/server')
      yield* Effect.promise(() => mkdir(dataDirectory, { recursive: true }))
      const databaseFile = path.join(dataDirectory, 'open-flow.sqlite')
      yield* Effect.sync(() => migrateDatabase(databaseFile))

      const retentionDays = Number(process.env.OPEN_FLOW_RUN_EVENT_RETENTION_DAYS ?? '30')
      const runEventRetentionMs = retentionDays * 24 * 60 * 60 * 1000
      if (!Number.isSafeInteger(retentionDays) || retentionDays <= 0 || !Number.isSafeInteger(runEventRetentionMs)) {
        throw new Error('OPEN_FLOW_RUN_EVENT_RETENTION_DAYS must be a positive safe integer number of days.')
      }
      const maxPendingRuns = Number(process.env.OPEN_FLOW_MAX_PENDING_RUNS ?? '1000')
      if (!Number.isSafeInteger(maxPendingRuns) || maxPendingRuns <= 0) {
        throw new Error('OPEN_FLOW_MAX_PENDING_RUNS must be a positive safe integer.')
      }
      const callbackRequestsPerMinute = Number(process.env.OPEN_FLOW_CALLBACK_REQUESTS_PER_MINUTE ?? '120')
      if (!Number.isSafeInteger(callbackRequestsPerMinute) || callbackRequestsPerMinute <= 0) {
        throw new Error('OPEN_FLOW_CALLBACK_REQUESTS_PER_MINUTE must be a positive safe integer.')
      }
      const maxConcurrentRuns = Number(process.env.OPEN_FLOW_MAX_CONCURRENT_RUNS ?? '4')
      if (!Number.isSafeInteger(maxConcurrentRuns) || maxConcurrentRuns <= 0) {
        throw new Error('OPEN_FLOW_MAX_CONCURRENT_RUNS must be a positive safe integer.')
      }
      const runTimeoutMs = Number(process.env.OPEN_FLOW_RUN_TIMEOUT_MS ?? '1800000')
      if (!Number.isSafeInteger(runTimeoutMs) || runTimeoutMs <= 0) {
        throw new Error('OPEN_FLOW_RUN_TIMEOUT_MS must be a positive safe integer.')
      }
      const operatorLoginAttemptsPerMinute = Number(process.env.OPEN_FLOW_OPERATOR_LOGIN_ATTEMPTS_PER_MINUTE ?? '10')
      if (!Number.isSafeInteger(operatorLoginAttemptsPerMinute) || operatorLoginAttemptsPerMinute <= 0) {
        throw new Error('OPEN_FLOW_OPERATOR_LOGIN_ATTEMPTS_PER_MINUTE must be a positive safe integer.')
      }

      const connectorOrigin = process.env.OPEN_FLOW_CONNECTOR_ORIGIN
      const connectorToken = process.env.OPEN_FLOW_CONNECTOR_TOKEN
      const connectorConsoleOrigin = process.env.OPEN_FLOW_CONNECTOR_CONSOLE_ORIGIN
      const waitPublicOrigin = process.env.OPEN_FLOW_PUBLIC_ORIGIN
      if (connectorOrigin == null && connectorToken != null) {
        throw new Error('OPEN_FLOW_CONNECTOR_TOKEN requires OPEN_FLOW_CONNECTOR_ORIGIN.')
      }
      const llmOrigin = process.env.OPEN_FLOW_LLM_ORIGIN
      const llmToken = process.env.OPEN_FLOW_LLM_TOKEN
      if ((llmOrigin == null) != (llmToken == null)) {
        throw new Error('OPEN_FLOW_LLM_ORIGIN and OPEN_FLOW_LLM_TOKEN must be configured together.')
      }
      const settingsStore = yield* Effect.acquireRelease(
        Effect.sync(() => new SettingsStore(databaseFile)),
        (opened) => Effect.sync(() => opened.close()),
      )
      const integrationPublicOrigin = process.env.OPEN_FLOW_INTEGRATION_PUBLIC_ORIGIN
      const integrationCallbackKey = process.env.OPEN_FLOW_INTEGRATION_CALLBACK_KEY
      if ((integrationPublicOrigin == null) != (integrationCallbackKey == null)) {
        throw new Error('OPEN_FLOW_INTEGRATION_PUBLIC_ORIGIN and OPEN_FLOW_INTEGRATION_CALLBACK_KEY must be configured together.')
      }
      let integration: { readonly callbackKey: string; readonly publicOrigin: string } | undefined
      if (integrationPublicOrigin != null && integrationCallbackKey != null) {
        const publicOrigin = new URL(integrationPublicOrigin)
        if (
          !publicProtocol(publicOrigin) ||
          publicOrigin.username != '' ||
          publicOrigin.password != '' ||
          publicOrigin.pathname != '/' ||
          publicOrigin.search != '' ||
          publicOrigin.hash != ''
        ) {
          throw new Error('OPEN_FLOW_INTEGRATION_PUBLIC_ORIGIN must be an HTTPS origin without credentials, a path, query, or fragment, except on loopback.')
        }
        if (Buffer.byteLength(integrationCallbackKey) < 32) {
          throw new Error('OPEN_FLOW_INTEGRATION_CALLBACK_KEY must contain at least 32 UTF-8 bytes.')
        }
        integration = { callbackKey: integrationCallbackKey, publicOrigin: publicOrigin.origin }
      }
      const settings = new Settings(settingsStore, {
        connectorConsoleOrigin,
        connectorOrigin,
        connectorToken,
        integrationCallbackKey: integration?.callbackKey,
        integrationPublicOrigin: integration?.publicOrigin,
        llmOrigin,
        llmToken,
        logger,
      })
      const operatorToken = process.env.OPEN_FLOW_TOKEN
      const secureCookie = process.env.OPEN_FLOW_SESSION_COOKIE_SECURE
      if (secureCookie != null && secureCookie != 'true' && secureCookie != 'false') {
        throw new Error('OPEN_FLOW_SESSION_COOKIE_SECURE must be true or false.')
      }
      const service = yield* ServerService.open(databaseFile, {
        capabilities: {
          connector: () => settings.connector(),
          connectorConsoleOrigin: () => settings.connectorConsoleOrigin(),
          integration: () => settings.integration(),
          llm: () => settings.llm(),
          waitPublicOrigin: () => (waitPublicOrigin == null ? undefined : new URL(waitPublicOrigin)),
        },
        logger,
        runtime: {
          maxConcurrentRuns,
          maxPendingRuns,
          runEventRetentionMs,
          runTimeoutMs,
        },
      })
      yield* service.start()
      const operatorStore = yield* Effect.acquireRelease(
        Effect.sync(() => new OperatorStore(databaseFile)),
        (opened) => Effect.sync(() => opened.close()),
      )
      const setupCode = operatorToken == null && !operatorStore.state().claimed ? randomBytes(32).toString('base64url') : undefined
      const operator = new OperatorSession(operatorStore, operatorToken, secureCookie == 'true', setupCode)
      if (setupCode != null) {
        logger.warn({ category: 'operator.setup.required', setupCode }, 'Open Flow Server requires operator setup. Use the setup code from this log entry.')
      }
      const workbenchHost = process.argv.includes('--api-only')
        ? {}
        : { publicDirectory: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public') }
      const shutdownController = new AbortController()
      yield* Effect.acquireRelease(
        Effect.sync(() =>
          serve(
            {
              fetch: createServerApp(service, {
                callbackRequestsPerMinute,
                logger,
                operator,
                operatorLoginAttemptsPerMinute,
                settings,
                shutdownSignal: shutdownController.signal,
                ...workbenchHost,
              }).fetch,
              hostname: host,
              overrideGlobalObjects: false,
              port,
            },
            (address) => {
              logger.info({ category: 'process.started', host, port: address.port, type: 'listening' }, 'Server is listening.')
            },
          ),
        ),
        (opened) => closeServer(opened).pipe(Effect.orDie),
      )

      stoppingSignal = yield* stopSignal()
      logger.info({ category: 'process.stopping', signal: stoppingSignal }, 'Server is stopping.')
      shutdownController.abort(new Error('Server is stopping.'))
      return stoppingSignal
    }),
  ).pipe(
    Effect.tap((signal) =>
      Effect.sync(() => {
        logger.info({ category: 'process.stopped', signal }, 'Server stopped.')
        logger.flush()
      }),
    ),
    Effect.catchCause((cause) =>
      Effect.sync(() => {
        const error = Cause.squash(cause)
        if (stoppingSignal == null) logger.fatal({ category: 'process.start.failed', err: error }, 'Server failed to start.')
        else logger.error({ category: 'process.stop.failed', err: error, signal: stoppingSignal }, 'Server failed to stop.')
        logger.flush()
        process.exitCode = 1
      }),
    ),
    Effect.asVoid,
  )
}

function stopSignal(): Effect.Effect<NodeJS.Signals> {
  return Effect.callback((resume) => {
    const interrupt = (): void => resume(Effect.succeed('SIGINT'))
    const terminate = (): void => resume(Effect.succeed('SIGTERM'))
    process.once('SIGINT', interrupt)
    process.once('SIGTERM', terminate)
    return Effect.sync(() => {
      process.removeListener('SIGINT', interrupt)
      process.removeListener('SIGTERM', terminate)
    })
  })
}

function closeServer(server: ReturnType<typeof serve>): Effect.Effect<void, Error> {
  return Effect.gen(function* () {
    const closed = yield* Deferred.make<void, Error>()
    yield* Effect.sync(() => {
      server.close((error) => Deferred.doneUnsafe(closed, error == null ? Effect.void : Effect.fail(error)))
    })
    yield* Effect.raceFirst(
      Deferred.await(closed),
      Effect.sleep(shutdownTimeoutMs).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            logger.warn({ category: 'process.stop.forced', timeoutMs: shutdownTimeoutMs }, 'Server connections exceeded the shutdown deadline.')
            if ('closeAllConnections' in server) server.closeAllConnections()
          }),
        ),
        Effect.andThen(Deferred.await(closed)),
      ),
    )
  })
}

function publicProtocol(url: URL): boolean {
  return url.protocol == 'https:' || (url.protocol == 'http:' && ['127.0.0.1', '::1', '[::1]', 'localhost'].includes(url.hostname))
}

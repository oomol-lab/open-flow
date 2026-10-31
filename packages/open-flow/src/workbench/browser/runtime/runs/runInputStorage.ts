import { isJsonValue, objectValue } from '../../../../form/common/value.ts'

export interface RunInputStorageScope {
  readonly environment?: string
  readonly sessionId: string
  readonly connectorOwnerId?: string
}

export interface SavedRunInputs {
  readonly signature: string
  readonly valid: boolean
  readonly values: Readonly<Record<string, unknown>>
}

const databaseName = 'open-flow:run-inputs'
const storeName = 'inputs'

function scopeKey(scope: RunInputStorageScope): string {
  return JSON.stringify([scope.environment ?? 'production', scope.sessionId, scope.connectorOwnerId ?? null])
}

/** Local authoring data has an independent lifetime from fetched catalog responses. */
async function transact<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1)
    request.addEventListener('upgradeneeded', () => request.result.createObjectStore(storeName))
    request.addEventListener('success', () => resolve(request.result))
    request.addEventListener('error', () => reject(request.error))
  })
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(storeName, mode)
      const request = work(transaction.objectStore(storeName))
      transaction.addEventListener('complete', () => resolve(request.result))
      transaction.addEventListener('abort', () => reject(transaction.error))
    })
  } finally {
    database.close()
  }
}

export async function readRunInputs(scope: RunInputStorageScope): Promise<ReadonlyMap<string, SavedRunInputs>> {
  const prefix = `${scopeKey(scope)}\u0000`
  const records: unknown[] = await transact('readonly', (store) => store.getAll(IDBKeyRange.bound(prefix, `${scopeKey(scope)}\u0001`, false, true)))
  return new Map(
    records.flatMap((raw): [string, SavedRunInputs][] => {
      const record = objectValue(raw)
      const values = objectValue(record?.values)
      return record != null &&
        typeof record.key === 'string' &&
        typeof record.signature === 'string' &&
        typeof record.valid === 'boolean' &&
        values != null &&
        isJsonValue(values)
        ? [[record.key, { signature: record.signature, valid: record.valid, values }]]
        : []
    }),
  )
}

export async function writeRunInputs(scope: RunInputStorageScope, key: string, inputs: SavedRunInputs): Promise<void> {
  await transact('readwrite', (store) => store.put({ key, ...inputs }, `${scopeKey(scope)}\u0000${key}`))
}

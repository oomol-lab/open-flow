import { z } from 'zod'

export const ConnectorExecutorNameSchema = /* @__PURE__ */ z.literal('connector').describe('Connector Executor Name')

export const ConnectorExecutorSchema = /* @__PURE__ */ z
  .strictObject({
    name: ConnectorExecutorNameSchema,
    options: /* @__PURE__ */ z.strictObject({
      action: /* @__PURE__ */ z.string().min(1).describe('Connector action id in service.action form'),
      connection: /* @__PURE__ */ z.string().min(1).optional().describe('Team-owned Connector connection id'),
    }),
  })
  .describe('Connector Executor calls a versioned remote action')

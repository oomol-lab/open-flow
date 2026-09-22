### Provider Access identity upgrade

Bindings now persist an explicit Connection and authorization source. Old opaque-only bindings must
be cleared and selected again; they are never inferred as administrator or default permissions.
Before switching an existing OOMOL deployment, disable Live, drain Runs and Publish operations,
and retire Integration resources and source subscriptions using the old Server. Stop the Server
and back up its SQLite database, then run from `apps/server`:

```sh
node scripts/reset-provider-access.ts /absolute/path/to/database.sqlite
node scripts/reset-provider-access.ts /absolute/path/to/database.sqlite --apply
```

The first command only checks; `--apply` clears Draft bindings and selectable authorization
snapshots in one transaction. It preserves Flows, code, history, configured services, and credentials.
It refuses unfinished work or retained subscriptions. It is an explicit one-time operation, not a
startup migration. Start the new Server, select access again, and republish before enabling Live.
Do not restore historical publications with cleared authorization snapshots.

# launchd — keep Tars running 24/7

`com.tars.server.plist` keeps the Node server alive (auto-restart on crash/login). The
agent runs `tars-server-run.sh`, which boots the whole stack **in order**: starts **Colima**
(the Docker VM) if down, brings up the **Postgres** container (`docker compose up -d`), waits
for `:5432`, then execs the server. So Colima + Postgres come back automatically on
login/reboot — no separate Colima autostart needed. Embeddings use **Ollama** (its own
always-on `brew services` agent). The tunnel runs under Tailscale's own launchd agent.

## Install

Use the Makefile — it fills the template's `/ABSOLUTE/PATH/TO/tars` and
`/ABSOLUTE/PATH/TO/node/bin` placeholders from the real repo path + `which node`,
installs the plist to `~/Library/LaunchAgents`, and bootstraps it:

```bash
make install-service    # generate plist + bootstrap (idempotent)
make doctor             # confirm it's loaded and healthy
make logs               # tail /tmp/tars-server.log
```

Lifecycle: `make start | stop | restart`, and `make uninstall-service` to remove it.
Config/secrets live in `<repo>/.env` (the server's `WorkingDirectory`), never in the
plist. `com.tars.server.plist` is a **template** — don't hand-install it.

## Notes

- The Mac must not sleep (System Settings → Energy, or `caffeinate`). Tailscale Funnel +
  this agent assume the machine is always on.
- Backups (scheduled `pg_dump` + the git mirror) are in `ops/backup/`.

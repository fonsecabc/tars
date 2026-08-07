# systemd: keep Tars running 24/7 on Linux

The Linux counterpart to `ops/launchd/`. `tars-server.service` is a **per-user** unit
(`systemctl --user`) that keeps the Node server alive (auto-restart on crash, restart on
boot). The unit runs `tars-server-run.sh`, which brings up the stack **in order**: waits for
the **Docker** daemon (native on Linux, no Colima), brings up the **Postgres** container
(`docker compose up -d`), waits for it to report healthy, then execs the server. So Postgres
comes back automatically with the service. The embedding provider follows
`EMBEDDING_PROVIDER` in `.env` (the unit sets none of its own): `ollama` for the Full
profile, `null` for Simple, which needs nothing extra.

A **per-user** unit (not a system unit) mirrors launchd's per-user agent: no root, and
config/secrets stay under `$HOME`. Boot and post-logout persistence come from **lingering**,
which the installer enables for you (one privileged call, best-effort).

## Prerequisites

On Linux `make setup` (Homebrew + Colima) does not apply. Install the stack natively, then
build once:

```bash
# Docker Engine + compose plugin, Node 20+, and pnpm (corepack), via your distro.
# Then, from the repo:
pnpm install && pnpm build && pnpm db:up
```

You must be able to reach Docker without sudo. If you just ran `usermod -aG docker $USER`,
note that the systemd **user manager** keeps its old group membership until you fully log out
and back in (or run `loginctl terminate-user $USER`). Until then the unit gets "permission
denied" on the Docker socket every 10s, even though your interactive shell reaches Docker
fine.

## Install

Use the Makefile, the same targets as macOS. It fills the template's `/ABSOLUTE/PATH/TO/tars`
and `/ABSOLUTE/PATH/TO/node/bin` placeholders from the real repo path and `which node`,
installs the unit to `~/.config/systemd/user`, enables lingering, and starts it:

```bash
make install-service    # render unit, enable, restart (idempotent)
make doctor             # confirm it's active and healthy
make logs               # journalctl --user -u tars-server -f
```

Lifecycle: `make start | stop | restart`, and `make uninstall-service` to remove it.
Config and secrets live in `<repo>/.env` (the unit's `WorkingDirectory`), never in the unit
file. `tars-server.service` is a **template**; don't hand-install it.

## Notes

- **Lingering** lets the service run without an open login session (survives logout, starts
  on boot). The installer runs `loginctl enable-linger` for you; if it lacks privileges it
  says so, and you run `sudo loginctl enable-linger $(id -un)` once by hand.
- `systemctl --user` needs a running user manager. On a normal login (desktop or SSH),
  `pam_systemd` starts `user@UID.service` for you, so `systemctl --user` works over SSH
  without lingering. The "Failed to connect to bus" case is a `su`/`sudo` shell with no
  logind session (no `XDG_RUNTIME_DIR`): log in directly, or enable lingering.
- Logs go to the **journal**, not `/tmp`: `journalctl --user -u tars-server -f`.
- Backups (scheduled `pg_dump` + the git mirror) are in `ops/backup/`.

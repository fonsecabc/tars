# systemd — keep Tars running 24/7 on Linux

The Linux counterpart to `ops/launchd/`. `tars-server.service` is a **per-user** unit
(`systemctl --user`) that keeps the Node server alive (auto-restart on crash, restart on
boot). The unit runs `tars-server-run.sh`, which brings up the stack **in order**: waits
for the **Docker** daemon (native on Linux — no Colima), brings up the **Postgres**
container (`docker compose up -d`), waits for `:5432`, then execs the server. So Postgres
comes back automatically with the service. Embeddings use **Ollama** (Full profile);
Simple profile leaves `EMBEDDING_PROVIDER=null` in `.env` and needs nothing extra.

A **per-user** unit (not a system unit) mirrors launchd's per-user agent: no root, and
config/secrets stay under `$HOME`. Boot/logout persistence comes from **lingering**, which
the installer enables for you (one `sudo`, best-effort).

## Prerequisites

On Linux `make setup` (Homebrew + Colima) does not apply — install the stack natively,
then build once:

```bash
# Docker Engine + compose plugin, Node 20+, and pnpm (corepack), via your distro.
# Then, from the repo:
pnpm install && pnpm build && pnpm db:up
```

You must be able to reach Docker without sudo (add yourself to the `docker` group) and
have a per-user systemd instance (`systemctl --user` must work — a normal desktop login
has one; a bare SSH session gets one once lingering is enabled).

## Install

Use the Makefile — same targets as macOS. It fills the template's
`/ABSOLUTE/PATH/TO/tars` and `/ABSOLUTE/PATH/TO/node/bin` placeholders from the real repo
path + `which node`, installs the unit to `~/.config/systemd/user`, enables lingering, and
starts it:

```bash
make install-service    # render unit + enable --now (idempotent)
make doctor             # confirm it's active and healthy
make logs               # journalctl --user -u tars-server -f
```

Lifecycle: `make start | stop | restart`, and `make uninstall-service` to remove it.
Config/secrets live in `<repo>/.env` (the unit's `WorkingDirectory`), never in the unit
file. `tars-server.service` is a **template** — don't hand-install it.

## Notes

- **Lingering** is what lets the service run without an open login session (survives
  logout, starts on boot). The installer runs `loginctl enable-linger $USER` for you; if it
  lacks privileges it says so — run `sudo loginctl enable-linger $USER` once by hand.
- `systemctl --user` needs a user D-Bus session. Over SSH without lingering you may see
  "Failed to connect to bus"; enabling lingering fixes it.
- Logs go to the **journal**, not `/tmp`: `journalctl --user -u tars-server -f`.
- Backups (scheduled `pg_dump` + the git mirror) are in `ops/backup/`.

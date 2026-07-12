# Tars in the cloud — always-on, private, backed up

Move the brain off the Mac to a small always-on server. Nothing is exposed to the public
internet: the box joins **your tailnet** and the server is reachable only over Tailscale
(the same way the Mac deploy works — because the OAuth flow auto-approves anyone who can
reach it, tailnet-only is the *only* safe exposure). Postgres and Ollama have no host
ports at all. Backups are encrypted on the box and pushed to Backblaze B2 hourly.

```
                    your phone / laptop / claude.ai
                                │  (Tailscale, tailnet-only HTTPS)
                                ▼
   Hetzner CX22 ── tailscale serve :443 ─▶ 127.0.0.1:8788  (tars OAuth listener)
   (Ubuntu 24.04)                              │  private docker network
                                    ┌──────────┼───────────┐
                                    ▼          ▼           ▼
                                 tars       postgres     ollama
                              (MCP server) (pgvector)  (embeddings)
                                    │
                                    └─ pg_dump | restic (AES-256) ─▶ Backblaze B2
```

Chosen setup: **Hetzner CX22** (2 vCPU / 4 GB / 40 GB, ~€3.8/mo), **Germany** (GDPR),
backups to **Backblaze B2** via **restic** (client-side encrypted, off-provider).

---

## Morning checklist (what you click)

### 1. Buy the server — Hetzner Cloud
1. https://console.hetzner.cloud → sign up / log in → **New project** ("tars").
2. **Add Server**:
   - Location: **Nuremberg** (or Falkenstein) — Germany.
   - Image: **Ubuntu 24.04**.
   - Type: **CX22** (shared vCPU, 4 GB). (CX32 if you later want more headroom.)
   - **SSH key**: paste your public key — `cat ~/.ssh/id_ed25519_personal.pub`.
   - **Cloud config**: paste the contents of [`cloud-init.yaml`](cloud-init.yaml) *after*
     replacing the `ssh_authorized_keys` line with the same public key.
   - Name: `tars`. Create. Note the IP.

That's the only thing you buy. ~5 min to boot + self-harden.

### 2. Bring the app up (one command on the box)
```bash
ssh tars@<server-ip>
git clone https://github.com/fonsecabc/tars.git ~/tars   # private repo? use a deploy token or scp
cd ~/tars && bash deploy/cloud/bootstrap.sh
```
`bootstrap.sh` joins your tailnet (opens a login URL — approve it), generates all secrets
**on the box**, builds and starts the stack, pulls the embedding model, fronts it with
Tailscale Serve, and installs the hourly backup timer. It prints your restic restore
password once — **save it offline; without it the backups can't be decrypted.**

### 3. Turn on backups (needs your B2 keys)
1. Backblaze → **B2 Cloud Storage** → create a **private bucket** `tars-brain-backups`,
   and enable **Object Lock** on it (so snapshots can't be erased inside the lock window,
   even by a stolen key).
2. Create an **Application Key** scoped to that bucket **without the `deleteFiles`
   capability** — the hourly job only appends, so a compromised box can't wipe your history.
   Put the two values into `/etc/tars/backup.env` (`sudo nano /etc/tars/backup.env`).
3. Initialise + first run:
   ```bash
   sudo bash deploy/cloud/backup/restic-backup.sh --init
   sudo systemctl start tars-backup.service   # first backup now (append-only)
   ```
4. Retention/prune is **destructive and deliberately not hourly**. Run it occasionally from
   a trusted context with a separate, delete-capable key:
   ```bash
   sudo bash deploy/cloud/backup/restic-backup.sh --prune
   ```

### 4. Migrate the brain from your Mac  → see "Migrating the brain" below.

### 5. Connect your devices
- **claude.ai** (web/desktop/mobile): Settings → Connectors → **Add custom connector** →
  URL `https://<host>.<tailnet>.ts.net/mcp` → leave client secret blank → connect.
- **Phone**: install Tailscale, sign into the **same** account. Done — it can now reach the
  connector from anywhere.

---

## Migrating the brain (Mac → cloud)

On the **Mac**, dump the current brain (schema + data + migration ledger):
```bash
cd ~/Projects/tars   # your local path
docker compose -f deploy/docker/docker-compose.yml exec -T postgres \
  pg_dump -U tars -d tars | gzip > /tmp/brain.sql.gz
scp /tmp/brain.sql.gz tars@<server-ip>:/tmp/
```
On the **server**, restore into Postgres *before* the app has written anything:
```bash
cd ~/tars
# bring up ONLY the database first
sudo docker compose -f deploy/cloud/docker-compose.prod.yml --env-file /etc/tars/tars.env up -d postgres
gunzip -c /tmp/brain.sql.gz | sudo docker exec -i tars-postgres psql -U tars -d tars
rm /tmp/brain.sql.gz
# now (re)start the whole stack; migrations no-op since the ledger came in the dump
sudo docker compose -f deploy/cloud/docker-compose.prod.yml --env-file /etc/tars/tars.env up -d
# embed anything missing a vector
sudo docker exec tars-server node -e "require('child_process')" 2>/dev/null || true
```
To (re)embed after import, set `TARS_BACKFILL_ON_BOOT=1` in `/etc/tars/tars.env`, restart
`tars-server` once, then set it back to `0`.

Point Claude Code on the Mac at the cloud instead of localhost (optional):
```bash
claude mcp remove tars
claude mcp add --transport http tars https://<host>.<tailnet>.ts.net/mcp
```

---

## Restoring from backup (drill this once)

```bash
set -a; . /etc/tars/backup.env; set +a
restic snapshots                       # list encrypted snapshots
restic dump latest tars-tars.sql \
  | sudo docker exec -i tars-postgres psql -U tars -d tars
```
The restic password (in `/etc/tars/backup.env`, and the offline copy you saved) is the
only thing that can decrypt these. B2 stores ciphertext only.

---

## Security model (why it's built this way)

- **No public ports.** ufw denies all inbound; Postgres and Ollama publish nothing; the
  OAuth listener is bound to the host's `127.0.0.1` and reached only through Tailscale Serve
  on the tailnet interface. The auto-approving OAuth flow never faces the open internet. A
  `DOCKER-USER` guard (installed by cloud-init) drops external inbound to any Docker-published
  port, so even a stray `0.0.0.0` publish can't bypass ufw.
- **SSH is tailnet-only.** Port 22 is public just long enough to run `bootstrap.sh`, which
  then closes it — afterwards SSH is reachable only over the tailnet (Tailscale SSH +
  `tailscale0`). Pass `TARS_KEEP_PUBLIC_SSH=1` to `bootstrap.sh` to opt out.
- **Segmented containers.** Postgres sits on an `internal` docker network (no route off the
  box) that Ollama can't reach; only `tars` bridges to it. A compromised Ollama can't touch
  the database, and Postgres can't exfiltrate outward.
- **Least privilege.** Containers run `no-new-privileges`; `tars` additionally drops all
  Linux capabilities and runs a read-only rootfs. The server runs as a non-root user; the
  host login user is non-root and key-only; root SSH is disabled.
- **Pinned images.** Base/service images are pinned to explicit tags (no `:latest`), so an
  upstream image change can't silently land on the box at the next restart.
- **Auto-patched.** `unattended-upgrades` applies security updates and reboots at 04:30.
- **Encrypted, off-box, off-provider, tamper-resistant backups.** restic encrypts
  client-side before upload; the hourly key is append-only and the bucket uses Object Lock,
  so a box compromise can't read *or* silently destroy your backup history. Losing the whole
  Hetzner account still can't read your brain, and can't lose it either.
- **Local embeddings.** `EMBEDDING_PROVIDER=ollama` — observation text never leaves the box.

Full operator notes live in [`../../SECURITY.md`](../../SECURITY.md) and
[`../tunnel/README.md`](../tunnel/README.md).

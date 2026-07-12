#!/usr/bin/env bash
# Tars cloud bootstrap — run ONCE on the freshly-hardened box, as the `tars` user.
#
#   ssh tars@<server-ip>
#   git clone https://github.com/fonsecabc/tars.git ~/tars   # (or scp the repo up)
#   cd ~/tars && bash deploy/cloud/bootstrap.sh
#
# Idempotent: safe to re-run. Secrets are generated ON THIS BOX and written to
# root-only files under /etc/tars — they never touch git or any transcript.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
COMPOSE="$REPO/deploy/cloud/docker-compose.prod.yml"
ENV_DIR=/etc/tars
ENV_FILE="$ENV_DIR/tars.env"
BACKUP_ENV="$ENV_DIR/backup.env"
PUBLIC_PORT=8788

say() { printf '\n\033[1;36m[tars]\033[0m %s\n' "$*"; }

# --- 0. sanity -------------------------------------------------------------
command -v docker >/dev/null || { echo "docker missing — did cloud-init finish?"; exit 1; }
command -v tailscale >/dev/null || { echo "tailscale missing — did cloud-init finish?"; exit 1; }
sudo mkdir -p "$ENV_DIR" && sudo chmod 700 "$ENV_DIR"

# --- 1. Tailscale: join the tailnet (interactive, one time) ----------------
if ! tailscale status >/dev/null 2>&1; then
  say "Joining your tailnet. Open the URL below in a browser signed into YOUR Tailscale account."
  sudo tailscale up --ssh --hostname=tars
fi
DNSNAME="$(tailscale status --json | jq -r '.Self.DNSName' | sed 's/\.$//')"
[ -n "$DNSNAME" ] && [ "$DNSNAME" != "null" ] || { echo "could not read tailnet DNS name; run 'tailscale up' first"; exit 1; }
PUBLIC_BASE_URL="https://$DNSNAME"
say "This node is https://$DNSNAME"

# --- 2. Secrets + env (generate once; never overwrite existing) ------------
gen() { openssl rand -base64 48 | tr -d '/+=' | cut -c1-40; }

if ! sudo test -f "$ENV_FILE"; then
  say "Generating Postgres secret + writing $ENV_FILE"
  PG_PW="$(gen)"
  sudo tee "$ENV_FILE" >/dev/null <<EOF
POSTGRES_USER=tars
POSTGRES_DB=tars
POSTGRES_PASSWORD=$PG_PW
EMBEDDING_PROVIDER=ollama
OLLAMA_EMBEDDING_MODEL=nomic-embed-text
TARS_BACKFILL_ON_BOOT=0
PUBLIC_PORT=$PUBLIC_PORT
PUBLIC_BASE_URL=$PUBLIC_BASE_URL
EOF
else
  say "$ENV_FILE exists — refreshing PUBLIC_BASE_URL only"
  sudo sed -i "s#^PUBLIC_BASE_URL=.*#PUBLIC_BASE_URL=$PUBLIC_BASE_URL#" "$ENV_FILE"
fi
sudo chmod 600 "$ENV_FILE"

# --- 3. Backup credentials (restic -> Backblaze B2) ------------------------
if ! sudo test -f "$BACKUP_ENV"; then
  RESTIC_PW="$(gen)"
  say "Writing $BACKUP_ENV. You MUST paste your Backblaze B2 keys into it, then re-run backups."
  sudo tee "$BACKUP_ENV" >/dev/null <<EOF
# Fill in the two B2 values from Backblaze (Application Keys). Then:
#   sudo restic init   (run once — see backup/restic-backup.sh)
B2_ACCOUNT_ID=__PASTE_B2_keyID__
B2_ACCOUNT_KEY=__PASTE_B2_applicationKey__
RESTIC_REPOSITORY=b2:tars-brain-backups:tars
# KEEP THIS PASSWORD SAFE OFFLINE — without it the encrypted backups CANNOT be restored.
RESTIC_PASSWORD=$RESTIC_PW
POSTGRES_USER=tars
POSTGRES_DB=tars
EOF
  sudo chmod 600 "$BACKUP_ENV"
  # Do NOT echo the password into this run's stdout — bootstrap output is easily piped to a
  # file / tee / scrollback. Reveal it deliberately, in its own command, and save it offline.
  say "IMPORTANT: a restic restore password was generated. Without it the backups CANNOT be"
  say "decrypted. Reveal it now (in its own command) and store it offline (password manager):"
  say "    sudo grep '^RESTIC_PASSWORD=' $BACKUP_ENV"
fi

# --- 4. Build + start the stack --------------------------------------------
say "Building and starting the stack (first build takes a few minutes)"
sudo docker compose -f "$COMPOSE" --env-file "$ENV_FILE" up -d --build

# --- 5. Pull the local embedding model -------------------------------------
say "Pulling the embedding model into Ollama (one time)"
until sudo docker exec tars-ollama ollama list >/dev/null 2>&1; do sleep 2; done
sudo docker exec tars-ollama ollama pull "$(sudo grep OLLAMA_EMBEDDING_MODEL "$ENV_FILE" | cut -d= -f2)"

# --- 6. Front the OAuth listener with Tailscale Serve (tailnet-only) -------
say "Exposing the server on the tailnet via Tailscale Serve (HTTPS 443, tailnet-only)"
sudo tailscale serve --bg --https=443 "http://127.0.0.1:$PUBLIC_PORT"
sudo tailscale serve status || true

# --- 6b. Restrict SSH to the tailnet --------------------------------------
# Now that the box is on the tailnet (Tailscale SSH via `tailscale up --ssh`, plus
# `ufw allow in on tailscale0`), close public SSH so port 22 is no longer exposed to the
# whole internet. Override with TARS_KEEP_PUBLIC_SSH=1 if you have no other way in.
if [ "${TARS_KEEP_PUBLIC_SSH:-0}" = "1" ]; then
  say "TARS_KEEP_PUBLIC_SSH=1 — leaving public SSH (22/tcp) open."
elif tailscale status >/dev/null 2>&1; then
  say "Closing public SSH (22/tcp) — SSH stays reachable over the tailnet only."
  sudo ufw --force delete allow 22/tcp 2>/dev/null || true
  sudo ufw delete allow '22/tcp' 2>/dev/null || true
else
  say "Tailscale not confirmed up — LEAVING public SSH open so you don't lock yourself out."
fi

# --- 7. Install the backup timer -------------------------------------------
say "Installing hourly encrypted backups (restic -> B2)"
sudo cp "$REPO/deploy/cloud/backup/tars-backup.service" /etc/systemd/system/
sudo cp "$REPO/deploy/cloud/backup/tars-backup.timer"   /etc/systemd/system/
sudo sed -i "s#__REPO__#$REPO#g" /etc/systemd/system/tars-backup.service
sudo systemctl daemon-reload
sudo systemctl enable --now tars-backup.timer

cat <<DONE

=========================================================================
 Tars is live on the tailnet:  $PUBLIC_BASE_URL/mcp
 Health check from any tailnet device:
   curl $PUBLIC_BASE_URL/.well-known/oauth-protected-resource

 STILL TO DO (one time):
  1. Put your Backblaze B2 keys in $BACKUP_ENV, then init the repo:
       sudo bash deploy/cloud/backup/restic-backup.sh --init
  2. Import your brain (see deploy/cloud/README.md "Migrating the brain").
  3. Add the connector on claude.ai:  Settings -> Connectors -> Add custom
     connector -> URL: $PUBLIC_BASE_URL/mcp  (leave client secret blank).
  4. Install Tailscale on your phone, sign into the SAME account.
=========================================================================
DONE

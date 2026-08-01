#!/usr/bin/env bash
# Fetch the LOCOMO benchmark data (10 multi-session conversations + QA) into ./data/.
# Source: snap-research/locomo (Maharana et al., 2024). The data is NOT committed to this repo.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${DIR}/data/locomo10.json"
URL="https://raw.githubusercontent.com/snap-research/locomo/main/data/locomo10.json"

mkdir -p "${DIR}/data"
echo "Downloading LOCOMO → ${DEST}"
curl -fSL "${URL}" -o "${DEST}"
echo "Done. Set LOCOMO_PATH=${DEST} when running the harness."

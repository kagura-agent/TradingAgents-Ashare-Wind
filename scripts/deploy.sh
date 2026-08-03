#!/usr/bin/env bash
# deploy.sh — build locally, rsync to VM1, restart service
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VM1="azureuser@74.226.216.75"
SSH_KEY="$HOME/.ssh/vm1.pem"
REMOTE_DIR="/home/azureuser/trading-agents"

cd "$REPO_DIR"

echo "▶ Pulling latest main..."
git fetch origin main
git reset --hard origin/main

echo "▶ Building frontend..."
cd web/frontend
npm ci --silent 2>&1 | tail -3
npm run build 2>&1 | tail -5
cd "$REPO_DIR"

echo "▶ Syncing to VM1..."
rsync -az --delete \
    --exclude='.venv' \
    --exclude='.env' \
    --exclude='__pycache__' \
    --exclude='.pytest_cache' \
    --exclude='.ruff_cache' \
    --exclude='.cache' \
    --exclude='node_modules' \
    --exclude='results' \
    --exclude='*.db' \
    -e "ssh -i $SSH_KEY" \
    "$REPO_DIR/" "$VM1:$REMOTE_DIR/"

echo "▶ Installing deps + restarting on VM1..."
ssh -i "$SSH_KEY" "$VM1" "cd $REMOTE_DIR && .venv/bin/pip install -e '.[web]' --quiet 2>&1 | tail -3 && sudo systemctl restart trading-agents"

echo "✓ Deployed $(git rev-parse --short HEAD) — $(git log -1 --format='%s')"

#!/bin/bash
# JD Resume Tailor — double-click (or run ./start.command) to start the app on http://localhost:3020
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.npm-global/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Install it from https://nodejs.org (LTS) and run this again."
  read -n 1 -s -r -p "Press any key to close."; exit 1
fi
if [ ! -d node_modules ]; then
  echo "First run: installing components (about 30 seconds)..."
  npm install --no-audit --no-fund || { echo "Install failed. Check your internet connection."; read -n 1 -s -r; exit 1; }
fi
PORT=$(grep -E '^PORT=' .env 2>/dev/null | cut -d= -f2); PORT=${PORT:-3020}
(sleep 2 && open "http://localhost:$PORT") &
node server.js

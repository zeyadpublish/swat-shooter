#!/usr/bin/env sh
# SWAT: Urban Siege - local launcher (the game must be served over http, not opened as a file)
cd "$(dirname "$0")" || exit 1
PORT=${PORT:-8080}
URL="http://localhost:$PORT/index.html"
open_url() { (sleep 1; if command -v open >/dev/null 2>&1; then open "$URL"; elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL"; else echo "Open $URL in your browser"; fi) & }
echo "Serving on $URL  (Ctrl+C to stop)"
if command -v python3 >/dev/null 2>&1; then open_url; exec python3 -m http.server "$PORT"
elif command -v python >/dev/null 2>&1; then open_url; exec python -m http.server "$PORT"
elif command -v npx >/dev/null 2>&1; then open_url; exec npx --yes serve -l "$PORT" .
else echo "Please install Python 3 (https://www.python.org) or Node.js and run again."; exit 1; fi

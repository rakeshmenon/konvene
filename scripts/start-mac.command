#!/bin/bash
# Double-click on a Mac to build Konvene and open it at http://localhost:8790. Close the window to stop.
cd "$(dirname "$0")/.." || exit 1
[ -d node_modules ] || npm install
( sleep 2; open "http://localhost:8790" ) &
npm run dev

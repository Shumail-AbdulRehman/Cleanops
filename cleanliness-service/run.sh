#!/usr/bin/env bash
set -euo pipefail

exec /home/shumail/cleandirty-env/bin/python -B "$(dirname -- "$0")/server.py"

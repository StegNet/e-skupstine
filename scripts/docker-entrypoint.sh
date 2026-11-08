#!/bin/sh
# Container start: migrations, then the app.
set -e

node scripts/migrate.mts
exec node node_modules/next/dist/bin/next start

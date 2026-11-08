#!/bin/sh
# Container start: Docker/Swarm secrets, migrations, then the app.
set -e

# Swarm mounts secrets as files. For every NAME_FILE variable, read that file into NAME
# (e.g. BETTER_AUTH_SECRET_FILE=/run/secrets/better_auth_secret sets BETTER_AUTH_SECRET).
for name in $(env | sed -n 's/^\([A-Z][A-Z0-9_]*\)_FILE=.*/\1/p'); do
  file=$(printenv "${name}_FILE")
  if [ ! -r "$file" ]; then
    echo "entrypoint: ${name}_FILE points to $file, which is not readable" >&2
    exit 1
  fi
  export "$name=$(cat "$file")"
  unset "${name}_FILE"
done

node scripts/migrate.mts
exec node node_modules/next/dist/bin/next start

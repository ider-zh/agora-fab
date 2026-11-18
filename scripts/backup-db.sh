#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ $# != 1 ]]; then
  printf 'Usage: %s BACKUP_PATH\n' "$0" >&2
  exit 2
fi

archive=$1
if [[ -e $archive || -L $archive ]]; then
  printf 'Backup destination already exists. Choose a new path.\n' >&2
  exit 1
fi

repo_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
docker=(docker)
if [[ ${AGORAFAB_DOCKER_SUDO:-0} == 1 ]]; then
  docker=(sudo -n docker)
fi
compose=("${docker[@]}" compose --project-directory "$repo_dir" --file "$repo_dir/compose.yaml"
  --project-name "${AGORAFAB_COMPOSE_PROJECT:-agorafab}")

# Keep the incomplete dump beside the destination so publishing is atomic and
# will fail if another process creates the destination while the dump is running.
directory=$(dirname -- "$archive")
pending=$(mktemp -- "$directory/.agorafab-backup.XXXXXXXX")
trap 'rm -f -- "$pending"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if ! "${compose[@]}" exec -T db sh -eu -c '
  exec pg_dump --no-password --format=custom --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"
' >"$pending" 2>/dev/null; then
  printf 'Database dump failed. Check Compose database health and Docker access.\n' >&2
  exit 1
fi

if [[ ! -s $pending ]] || ! "${compose[@]}" exec -T db \
  pg_restore --exit-on-error --file=/dev/null <"$pending" 2>/dev/null; then
  printf 'Could not verify the database archive. Backup was not published.\n' >&2
  exit 1
fi

if ! ln -T -- "$pending" "$archive"; then
  printf 'Could not publish the backup at the requested path.\n' >&2
  exit 1
fi
printf 'Verified PostgreSQL backup saved to %s\n' "$archive"

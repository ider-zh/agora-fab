#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ $# != 1 ]]; then
  printf 'Usage: %s BACKUP_PATH\n' "$0" >&2
  exit 2
fi

archive=$1
if [[ ! -f $archive || ! -r $archive || ! -s $archive ]]; then
  printf 'Supply a readable, nonempty backup archive.\n' >&2
  exit 1
fi

docker=(docker)
if [[ ${AGORAFAB_DOCKER_SUDO:-0} == 1 ]]; then
  docker=(sudo -n docker)
fi
image=${AGORAFAB_RESTORE_IMAGE:-postgres:17.7-bookworm}
db=agorafab_rehearsal
scratch=$(mktemp -d -- "${TMPDIR:-/tmp}/agorafab-restore.XXXXXXXX")
container=''
cleanup() {
  if [[ -n $container ]]; then
    if ! "${docker[@]}" rm --force --volumes "$container" >/dev/null 2>&1; then
      printf 'Could not remove rehearsal container %s. Remove it before retrying.\n' "$container" >&2
      rm -rf -- "$scratch"
      exit 1
    fi
  fi
  rm -rf -- "$scratch"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if ! container=$("${docker[@]}" run --detach --pull=never \
  --name "agorafab-restore-${scratch##*.}" \
  --network none --log-driver none \
  --tmpfs /var/lib/postgresql/data:rw,noexec,nosuid,nodev \
  --env "POSTGRES_DB=$db" --env POSTGRES_HOST_AUTH_METHOD=trust \
  "$image" postgres -c listen_addresses= 2>/dev/null); then
  printf 'Could not start isolated PostgreSQL. Check Docker access and the local restore image.\n' >&2
  exit 1
fi

ready=false
for (( attempt=0; attempt<45; attempt++ )); do
  # The official image initializes with a temporary postmaster before the
  # final server takes PID 1. Wait for the final server to accept connections.
  if "${docker[@]}" exec "$container" sh -eu -c '
    test "$(head -n 1 "$PGDATA/postmaster.pid")" = 1 &&
      pg_isready --quiet --username=postgres --dbname="$POSTGRES_DB"
  ' >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
if [[ $ready != true ]]; then
  printf 'Isolated PostgreSQL did not become ready.\n' >&2
  exit 1
fi

# pg_dump uses PostgreSQL text COPY, where embedded newlines are escaped.
# Count archived rows without persisting or printing any of their contents.
tables=(drizzle.__drizzle_migrations public.principals public.topics public.posts
  public.mentions public.notifications public.tasks public.artifacts)
expected=$(
  "${docker[@]}" exec -i "$container" pg_restore --data-only --file=- \
    <"$archive" 2>/dev/null |
    awk -v tables="${tables[*]}" '
      BEGIN {
        total = split(tables, names, " ");
        for (i = 1; i <= total; i++) wanted[names[i]] = 1;
      }
      copying {
        if ($0 == "\\.") copying = 0;
        else if (table in wanted) rows[table]++;
        next;
      }
      /^COPY / && / FROM stdin;$/ {
        table = $2;
        if (table in wanted) seen[table]++;
        copying = 1;
      }
      END {
        if (copying) exit 1;
        for (i = 1; i <= total; i++) {
          if (seen[names[i]] != 1) exit 1;
          printf "%s=%d\n", names[i], rows[names[i]];
        }
      }
    '
) || {
  printf 'Could not read data totals from the expected AgoraFab archive tables.\n' >&2
  exit 1
}

if ! "${docker[@]}" exec -i "$container" pg_restore --no-password \
  --exit-on-error --no-owner --no-privileges --single-transaction \
  --username=postgres --dbname="$db" <"$archive" >/dev/null 2>&1; then
  printf 'Restore failed in the isolated PostgreSQL container.\n' >&2
  exit 1
fi

actual=$(
  for table in "${tables[@]}"; do
    printf "select '%s=' || count(*) from %s;\n" "$table" "$table"
  done |
    "${docker[@]}" exec -i "$container" psql --no-password --no-psqlrc \
      --tuples-only --no-align --quiet --set=ON_ERROR_STOP=1 \
      --username=postgres --dbname="$db" 2>/dev/null
) || {
  printf 'Could not verify migration and data totals in the restored database.\n' >&2
  exit 1
}

if [[ $expected != "$actual" ]]; then
  printf 'Restore totals do not match the archive.\n' >&2
  exit 1
fi
printf 'Isolated restore verified. Archive and restored row counts match.\n%s\n' "$actual"

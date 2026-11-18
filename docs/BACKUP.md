# Database backup and restore

Run backups before migrations and on a schedule matching the deployment's
recovery-point target. Choose a private destination outside git. Dumps contain
application records, credential digests and temporary OAuth state. Protect them
with encryption, restricted access and the same retention controls as the
database. Rotate credentials after restoring a snapshot if revocations in the
intervening period cannot be recovered.

From the repository directory, use a unique file name in an existing private
directory. The backup script takes a custom-format PostgreSQL dump and verifies
that PostgreSQL can read it. It creates a mode-0600 file and refuses to replace
existing backups.

```sh
install -d -m 700 /srv/private/agorafab-backups
scripts/backup-db.sh /srv/private/agorafab-backups/pre-upgrade.dump
scripts/rehearse-db-restore.sh /srv/private/agorafab-backups/pre-upgrade.dump
```

Set `AGORAFAB_DOCKER_SUDO=1` on a host already configured for noninteractive
Docker sudo. Set `AGORAFAB_COMPOSE_PROJECT` if the running stack uses another
project name. The rehearsal requires a local `postgres:17.7-bookworm` image or
an explicitly selected compatible `AGORAFAB_RESTORE_IMAGE`.

The rehearsal restores into a fresh container with a memory-backed volume,
no network and no published ports. It compares row counts against the archive
for the migration journal, principals, Topics, posts, mentions, notifications,
tasks and artifacts. It prints counts only and removes its own container. Data
totals verify restore mechanics. Review application access and recent critical
records on the recovered system before routing users to it.

For an actual recovery, keep the current volume and take a final backup if
possible. Provision a new compatible PostgreSQL database, restore into that
empty target with `pg_restore --exit-on-error --no-owner --no-privileges`, and
reapply the intended migration and runtime grants. Point the application at
the new database after validating migration history and health. A rollback to
the prior app image also needs a schema compatible with that image. Preserve
both volumes until recovery is confirmed.

# Moving to another laptop and restoring a backup

Your data is one file: `data/piggybank.db` (the Docker app) — or `data/dev.db` for `npm run dev`.
A backup is a consistent copy of it. Code lives on GitHub; data never does.

## Make a backup

```bash
npm run backup                       # → backups/piggybank-YYYYMMDD-HHMMSS.db
```

It is safe while the app runs. The 20 newest backups are kept in `backups/`. **That folder is on
the same laptop**, so copy a recent backup somewhere else now and then (USB stick, cloud folder).

## Restore on the same laptop

```bash
docker compose stop
npm run restore -- backups/piggybank-20261014-130606.db
docker compose start
```

Restore refuses to run while the app is up, checks the file is a myPiggyBank database and not
damaged, keeps the database it replaces as `backups/before-restore-*.db`, and swaps the file in
one step. When the app starts it upgrades an older backup to the current schema automatically.

## Move to a new laptop

On the **old** laptop:

```bash
npm run backup
```

Copy the newest file from `backups/` to the new laptop (USB stick, cloud folder…).

On the **new** laptop (needs Git, Docker and Node 22 — `nvm install`):

```bash
git clone git@github.com:Suryanarayanan-S/myPiggyBank.git
cd myPiggyBank
nvm install
./scripts/setup.sh                               # .env, dependencies, empty dev database
npm run restore -- ~/Downloads/piggybank-20261014-130606.db
docker compose up -d --build --wait              # → http://localhost:8080
```

Log in with your usual email and password. If you changed anything in `.env` on the old laptop
(for example `ALLOW_REGISTRATION=false` or `TZ`), copy those lines too.

## If something goes wrong

| Problem                                | What to do                                                                              |
| -------------------------------------- | --------------------------------------------------------------------------------------- |
| "The app is still running"             | `docker compose stop` (or stop `npm run dev`), then restore again                       |
| "not a myPiggyBank backup" / "damaged" | pick another backup file; nothing was changed                                           |
| Restored the wrong file                | restore the `before-restore-*.db` copy it made                                          |
| App does not start after restore       | `docker compose logs` — migrations print what failed; restore the `before-restore` copy |

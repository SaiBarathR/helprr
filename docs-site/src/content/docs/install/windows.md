---
title: Windows
description: Install Helprr on a Windows PC with Docker Desktop, then update it and back it up from PowerShell.
---

Helprr runs on Windows 11 in Docker Desktop, from its Compose file alone. You type
a few commands in PowerShell; there is nothing else to set up.

*Tested 2026-11-06 with Windows 11 Pro 25H2, Docker Desktop 4.98 on WSL 2: install,
first run, a phone-style visit from another machine, restarts of Windows, an update, and a
backup restored after every Helprr volume was deleted. The Twitch and YouTube worker was
not tested on Windows.*

Helprr runs only while Docker Desktop does, and Docker Desktop starts only once someone
signs in to Windows: after every restart of the PC, sign in to Windows. Use a PC that
stays on, and set **Sleep** to **Never** for when it is plugged in (**Settings → System → Power**, or **Power & battery** on a
laptop).

## 1. Install Docker Desktop

1. Download **Docker Desktop for Windows** from
   [docker.com](https://www.docker.com/products/docker-desktop/) and run it. Keep
   **Use WSL 2** ticked. Restart Windows if it asks.
2. Open Docker Desktop and accept its terms. It then asks you to sign in: choose
   **Skip**. Helprr needs no Docker account.
3. In Docker Desktop, open **Settings** (the gear at the top) → **General**, turn on
   **Start Docker Desktop when you sign in to your computer**, and choose **Apply**.
   Without it, Helprr does not come back after Windows restarts.

## 2. Start Helprr

Open **PowerShell** (from the Start menu) and run:

```powershell
cd $HOME; mkdir helprr; cd helprr
Invoke-WebRequest https://github.com/SaiBarathR/helprr/releases/latest/download/docker-compose.yml -OutFile docker-compose.yml
docker compose up -d
```

This makes a `helprr` folder in your user folder, downloads the Compose file, and starts
Helprr. The first start downloads Helprr's images and takes a minute or two. Helprr is ready
when `docker compose ps` shows `helprr` as `(healthy)`; run it again until it does.

The first time, Windows Firewall asks whether **Docker Desktop Backend** may use the
network. Choose **Allow**, or your phone cannot reach Helprr.

## 3. Open Helprr

On the PC, open `http://localhost:3050` and [create your admin](/helprr/first-run/). Do
it right away: until an admin exists, whoever opens Helprr first can create one.

On your phone, use the PC's address: run `ipconfig` in PowerShell and use its
**IPv4 Address**, as `http://192.168.1.10:3050`. For push notifications Helprr needs an
`https://` address; see [Phone and push](/helprr/phone-and-push/) and
[HTTPS](/helprr/https/).

Then [connect your apps](/helprr/connect/).

## Change a setting

Settings go in a file named `.env` in the `helprr` folder, one per line, as the
[environment reference](/helprr/reference/environment/) lists. For example, the
timezone (Helprr uses UTC until you set it):

```powershell
cd $HOME\helprr
Set-Content .env "TZ=Europe/London"
docker compose up -d
```

`Set-Content` replaces the whole file: to add a second line later, use
`Add-Content .env "HELPRR_PORT=3060"`. Leave the passwords and keys out of `.env`:
Helprr made them on the first start, and the database already uses its own.

## Update

[Back up](#back-up) first, then download the new Compose file and restart with the new
image:

```powershell
cd $HOME\helprr
Invoke-WebRequest https://github.com/SaiBarathR/helprr/releases/latest/download/docker-compose.yml -OutFile docker-compose.yml
docker compose pull
docker compose up -d
```

Database changes apply on the first start of the new version. Read the
[release notes](https://github.com/SaiBarathR/helprr/releases) before you update.

## Back up

Back up before every update, and now and then. The backup script the other guides use
needs Linux, so on Windows the same backup is one PowerShell block. It saves the
database and Helprr's own passwords and keys to the `backups` folder, as two files with
the same name: a `.dump` and a `.secrets.tar`. Helprr keeps running.

```powershell
cd $HOME\helprr
& {
  $name = "helprr-" + (Get-Date -Format yyyyMMdd-HHmmss)
  New-Item -ItemType Directory backups -Force | Out-Null
  docker compose exec -T helprr-db sh -c 'rm -f /tmp/backup.dump && pg_dump -U postgres -d helprr -Fc --no-owner --no-privileges --lock-wait-timeout=10s -f /tmp/backup.dump && pg_restore --list /tmp/backup.dump > /dev/null'
  if ($LASTEXITCODE) { throw "The backup failed. Nothing was saved." }
  docker compose cp helprr-db:/tmp/backup.dump "backups\$name.dump"
  if ($LASTEXITCODE) { throw "Copying the backup failed. Nothing was saved." }
  docker compose exec -T helprr-db rm /tmp/backup.dump
  docker compose run --rm --no-deps -v "${PWD}\backups:/backups" --entrypoint tar helprr-init -C /secrets -cf "/backups/$name.secrets.tar" .
  if ($LASTEXITCODE) { Remove-Item "backups\$name.dump"; throw "Saving the passwords and keys failed. Nothing was saved." }
  "Saved backups\$name.dump and backups\$name.secrets.tar"
}
```

It ends with **Saved** and the two file names. On an error it stops, saves nothing, and
says what failed. The files hold your apps' API keys and your users' password hashes:
keep them private, and keep a copy off this PC. The commands copy files instead of piping
them, because Windows PowerShell 5.1 changes binary data sent through `>` and `<`.

## Restore, or move to another PC

This brings Helprr back from a backup after its data was lost, or onto a new PC.

**1. The files.** You need a `helprr` folder with the Compose file and, if you made one,
your `.env`, and the two backup files in `helprr\backups`. On a new PC, make the folder
and download the Compose file (copy your old `.env` and the backups there yourself):

```powershell
cd $HOME; mkdir helprr; cd helprr
Invoke-WebRequest https://github.com/SaiBarathR/helprr/releases/latest/download/docker-compose.yml -OutFile docker-compose.yml
```

Restore with the same or a newer Helprr version than the one that made the backup. To go
back to an older version, set it in `.env` first, as `HELPRR_VERSION=1.13.0`.

**2. Check the backup.** Set its name (without `.dump`), and check that both files read
in full. Nothing changes yet:

```powershell
cd $HOME\helprr
$name = "helprr-20261106-120000"
& {
  if (!(Test-Path "backups\$name.dump") -or !(Test-Path "backups\$name.secrets.tar")) { throw "backups\$name.dump or backups\$name.secrets.tar is missing." }
  docker run --rm -v "${PWD}\backups:/backups" postgres:16-alpine sh -c "pg_restore --list '/backups/$name.dump' > /dev/null && tar -tf '/backups/$name.secrets.tar' > /dev/null"
  if ($LASTEXITCODE) { throw "The backup cannot be read. Do not go on with it." }
  "The backup reads in full."
}
```

**3. Clear this PC's Helprr.** If Helprr was ever started in this folder, delete its data
first. This **deletes everything Helprr has on this PC**, so if it still holds anything you
want, [back it up](#back-up) and keep that backup until the restore works:

```powershell
docker compose down -v
```

**4. Restore.** In the same PowerShell window (it uses `$name` from step 2):

```powershell
& {
  docker compose run --rm --no-deps -v "${PWD}\backups:/backups" --entrypoint tar helprr-init -C /secrets -xf "/backups/$name.secrets.tar"
  if ($LASTEXITCODE) { throw "Restoring the passwords and keys failed." }
  docker compose run --rm --no-deps helprr-init
  if ($LASTEXITCODE) { throw "Preparing the passwords and keys failed." }
  docker compose up -d --wait helprr-db
  if ($LASTEXITCODE) { throw "The database did not start." }
  docker compose cp "backups\$name.dump" helprr-db:/tmp/backup.dump
  if ($LASTEXITCODE) { throw "Copying the backup in failed." }
  docker compose exec -T helprr-db pg_restore -U postgres --exit-on-error -d helprr /tmp/backup.dump
  if ($LASTEXITCODE) { throw "Restoring the database failed." }
  docker compose exec -T helprr-db rm /tmp/backup.dump
  docker compose up -d
}
```

If it stops with an error, fix the cause, then run `docker compose down -v` and step 4
again: a restore that stopped partway leaves data that a second try cannot reuse. Users,
their passwords and sign-ins, and your settings come back as they were.

## Remove

```powershell
cd $HOME\helprr
docker compose down -v
```

This stops Helprr and **deletes all its data**. Your backups in `helprr\backups` stay;
delete the folder too if you no longer need them.

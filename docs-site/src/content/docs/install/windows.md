---
title: Windows
description: Install Helprr on a Windows PC with Docker Desktop, then update it and back it up from PowerShell.
---

Helprr runs on Windows 10 or 11 in Docker Desktop, from its Compose file alone. You type
a few commands in PowerShell; there is nothing else to set up.

*Tested 2026-11-06 with Windows 11 Pro 25H2, Docker Desktop 4.98 and WSL 3.0.3: install,
first run, a phone-style visit from another machine, restarts of Windows, an update, and a
backup restored after every Helprr volume was deleted. The Twitch and YouTube worker was
not tested on Windows.*

Helprr runs only while Docker Desktop does, and Docker Desktop starts only once someone
signs in to Windows. Use a PC that stays on and signs in by itself, and set **Sleep** to
**Never** for when it is plugged in (**Settings → System → Power**, or **Power & battery** on a
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
mkdir helprr; cd helprr
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

The backup script the other guides use needs Linux, so on Windows the same backup takes
a few PowerShell commands. They save the database and Helprr's own passwords and keys to
the `backups` folder, as two files with the same name: a `.dump` and a `.secrets.tar`.
Helprr keeps running.

```powershell
cd $HOME\helprr
$name = "helprr-" + (Get-Date -Format yyyyMMdd-HHmmss)
New-Item -ItemType Directory backups -Force | Out-Null
docker compose exec -T helprr-db sh -c 'pg_dump -U postgres -d helprr -Fc -f /tmp/backup.dump && pg_restore --list /tmp/backup.dump > /dev/null'
docker compose cp helprr-db:/tmp/backup.dump "backups\$name.dump"
docker compose exec -T helprr-db rm /tmp/backup.dump
docker compose run --rm --no-deps -v "${PWD}\backups:/backups" --entrypoint tar helprr-init -C /secrets -cf "/backups/$name.secrets.tar" .
```

The two files hold your apps' API keys and your users' password hashes: keep them
private, and keep a copy off this PC. The commands copy files instead of piping them,
because Windows PowerShell 5.1 changes binary data sent through `>` and `<`.

## Restore, or move to another PC

This brings Helprr back from a backup after its data was lost, or onto a new PC. It
expects a `helprr` folder with the Compose file (step 2, without `docker compose up`),
and the two backup files in `helprr\backups`. If Helprr is running there, run
`docker compose down -v` first: it **deletes Helprr's data** on this PC.

```powershell
cd $HOME\helprr
$name = "helprr-20261106-120000"   # the backup's name, without .dump
docker compose run --rm --no-deps -v "${PWD}\backups:/backups" --entrypoint tar helprr-init -C /secrets -xf "/backups/$name.secrets.tar"
docker compose run --rm --no-deps helprr-init
docker compose up -d --wait helprr-db
docker compose cp "backups\$name.dump" helprr-db:/tmp/backup.dump
docker compose exec -T helprr-db pg_restore -U postgres --clean --if-exists -d helprr /tmp/backup.dump
docker compose exec -T helprr-db rm /tmp/backup.dump
docker compose up -d
```

Users, their passwords and sign-ins, and your settings come back as they were. Restore with the same
or a newer Helprr version than the one that made the backup.

## Remove

```powershell
cd $HOME\helprr
docker compose down -v
```

This stops Helprr and **deletes all its data**. Your backups in `helprr\backups` stay;
delete the folder too if you no longer need them.

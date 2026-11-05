---
title: Runtipi
description: Install Helprr from its Runtipi app store, and update it from Runtipi.
---

Helprr has its own Runtipi app store. Add it once, then install, update and back up
Helprr from Runtipi's pages, with nothing to type in a terminal and no secrets to make:
Helprr makes its passwords and keys the first time it starts.

*Tested 2026-11-05 with Runtipi 4.12.0 on Ubuntu 24.04: install, first run, stop and
start, a restart of the machine, an update, a backup and restore, and removing it.*

## 1. Add Helprr's app store

In Runtipi, open **Settings → App Stores → Add appstore**:

- **Appstore name**: `helprr`
- **Appstore URL**: `https://github.com/SaiBarathR/helprr-runtipi`

Select **Create new appstore**.

![Runtipi's Add appstore window: the name helprr and the URL https://github.com/SaiBarathR/helprr-runtipi](../../../assets/screens/runtipi-add-store.png)

## 2. Install

Open **App Store**, search for `helprr`, open **Helprr**, and select **Install**. Keep
**Open port** on with port `3050` (or choose another), then select **Install**.

![Runtipi's Install Helprr window: Open port on, port 3050](../../../assets/screens/runtipi-install-dialog.png)

Runtipi pulls the images and starts Helprr; give it a minute or two. When it shows
**Running**, select **Open**, or open `http://YOUR_SERVER:3050`, and
[create your admin](/helprr/first-run/).

![Helprr's page in Runtipi: Running, with Stop, Open and the ⋯ menu](../../../assets/screens/runtipi-running.png)

Helprr keeps its data in Runtipi's folder for it (`runtipi/app-data/helprr/helprr`) and
takes Runtipi's timezone. The optional Twitch and YouTube worker is not part of the
Runtipi app; use a [terminal install](/helprr/install/one-command/) for that.

## Update

Each Helprr release updates the app store. To see it, open **Settings → Actions → Update
App Stores**, and select **Update**. Helprr's **⋯** menu then shows **Update**: follow its
steps, and leave **Backup** on in the last one, so Runtipi backs Helprr up first. The
update takes a minute or two, most of it Helprr finishing its work before it stops.

![The last step of Runtipi's update: Backup, then Update](../../../assets/screens/runtipi-update-last.png)

## Back up

On Helprr's page, the **Backups** tab has **Backup now**: Runtipi stops Helprr, copies its
folder, and starts it again. Each backup there also has **Download** and **Restore**;
restoring replaces all of Helprr's data with the backup's. The backups have your database
and the passwords and keys Helprr made: download them to keep a copy off the machine, and
keep them private.

## Remove

Helprr's **⋯** menu → **Remove**, then **Uninstall**, removes Helprr and all its data.
**Download** a backup first if you might want it again.

![Runtipi's Uninstall Helprr question](../../../assets/screens/runtipi-remove.png)

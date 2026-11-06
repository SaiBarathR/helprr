---
title: First run
description: Create your admin, then the few things worth doing first.
---

## Create your admin

Open Helprr. With no `APP_PASSWORD` set (in `.env`, or in your dashboard's settings for
Helprr), the sign-in page sends you to
**Welcome to Helprr**, where you choose the admin's username (it suggests `admin`) and
password.

- Whoever opens Helprr first can take this step, so do it before Helprr is reachable
  from the internet.
- The screen works only at Helprr's address on your network, such as
  `http://192.168.1.10:3050`, or on the server itself. To create the admin through a
  reverse proxy or a public address, set `APP_ORIGIN` to that address first.
- Once any user exists, the screen is gone for good.
- Passwords need at least 15 characters. Jellyfin sign-in uses Jellyfin's own rules.

### With `APP_PASSWORD`

`APP_PASSWORD` creates the admin at the first start instead. Its username is `admin`,
or `HELPRR_ADMIN_USERNAME`. Changing `APP_PASSWORD` later does **not** change the
password. To reset it, set `APP_PASSWORD` to the new password (at least 15 characters)
and `HELPRR_ADMIN_PASSWORD_RESET=true`, restart Helprr, then remove the reset line. The
reset signs the admin out on every device and ends any reset link made for them; it does
that again at every start until the line is removed.

If `HELPRR_ADMIN_USERNAME` is set, Helprr renames the admin to it at every start, so
leave it unset or set it to the name you chose.

## Then

The dashboard's **Set up Helprr** list has these, and ticks them off as you go (its
count leaves out the optional one):

1. [Connect your apps](/helprr/connect/) in **Settings → Instances**. Test each one.
2. [Add people](/helprr/people/) in **Settings → Users**, with only the access they need
   (optional).
3. [Turn on push notifications](/helprr/phone-and-push/).
4. [Install Helprr on your phone](/helprr/phone-and-push/#3-install-it).
5. Back up the database, as in [Back up and restore](/helprr/maintain/backup/), or your
   dashboard's guide ([Portainer](/helprr/install/portainer/#back-up),
   [CasaOS](/helprr/install/casaos/#back-up), [Runtipi](/helprr/install/runtipi/#back-up),
   [TrueNAS](/helprr/install/truenas/#back-up)). A backup made with `backup.sh` ticks
   this step, and **Settings → Backup & Restore** shows when the last one was; after a
   backup made another way, tick it with **Done**. The settings export on that page is a
   copy of your settings only, not a backup.

Preferences, the dashboard layout, notifications, and cleanup and bandwidth rules are
all in **Settings** when you want them.

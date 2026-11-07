---
title: People and permissions
description: Give family and friends their own sign-in, with only the access they need.
---

Each person gets their own account in **Settings → Users**. Helprr has two templates:

- **Admin**: everything, including settings, connections, deleting and cleanup.
- **Member**: browsing the library, Discover, the calendar, their own watchlist,
  reminders and dashboard, asking for titles through Seerr, and watching through
  Jellyfin. Only their own settings (account, sessions, notifications, appearance and
  preferences). No torrents, no deleting, no connections.

For each person you can switch single permissions on or off on top of their template.
Anything not given is refused, including permissions added in later versions.

## Signing in

- **With a Helprr password**. It needs at least 15 characters. By default **Add** makes
  an invite link: send it to the person, and they open it and choose their own password.
  Until then the account is pending and cannot sign in. Turn **Invite link** off to set
  the password yourself, or for a Jellyfin-only account (picking a Jellyfin account
  turns it off for you). Each person can change their
  password in **Settings → Account → Change password**.
- **Invite and reset links** work once. An invite lasts 7 days and a password-reset link
  24 hours. Helprr shows a link only when it is made, so if one gets lost, open the person
  in **Settings → Users** and make a new one; that ends the old link. **Revoke** ends it
  without a new one, and so does changing their status or setting their password there.
  A reset link is for someone who forgot their password: using it signs them out
  everywhere. A link looks like `https://helprr.example/invite#…`: the part after `#`
  is the key, and browsers never send that part to a server, so it does not end up in
  proxy or server logs. The page removes it from the address bar as soon as it opens.
  With `APP_ORIGIN` set, links use that address even when you make them over the LAN;
  without it they use the address you have Settings open on.
- **With Jellyfin**: **Sign in with Jellyfin** on the sign-in page uses the person's
  Jellyfin account, with Jellyfin's own password rules.

## Watching

Watching in Helprr plays through each person's own Jellyfin account, so their progress,
resume points and history are saved there. Signing in with Jellyfin connects it; anyone
with a Helprr password connects it in **Settings → Account**. Until they do, Helprr asks
them to sign in to Jellyfin when they press play. **Settings → Users** shows who is not
connected yet.

## Two-step sign-in

Anyone with a Helprr password can make sign-in also ask for a code from an
authenticator app (1Password, Google Authenticator, Authy, or any app that reads a
TOTP QR code). In **Settings → Account → Two-step sign-in**, confirm your password,
scan the QR code (or type the key into the app), and enter the 6-digit code it shows.
Helprr then shows ten **recovery codes** once: save them somewhere safe. Each one
signs you in once instead of a code, if you lose your phone. **Sign out your other
devices** (on by default) makes everywhere else you are signed in sign in again, with a code.

From then on, every sign-in asks for a code after the password, including **Sign in
with Jellyfin**. A code works once, and wrong codes count
toward the same sign-in limits as wrong passwords; after 10 wrong codes in an hour the
account waits for the rest of that hour (a recovery code still works then). To turn it off, enter your password and a code (or a
recovery code). An account that signs in only with Jellyfin has no Helprr password and
cannot turn it on.

If whoever runs Helprr changes its `JWT_SECRET`, authenticator codes stop working:
sign in with a recovery code, then turn two-step sign-in off and on again.

With [sign-in at the proxy](/helprr/https/#sign-in-once-at-the-proxy) on, signing in
through the proxy skips the code: the proxy's own sign-in stands in for it.

Lost the phone and the recovery codes? Ask an admin: in **Settings → Users**, they can
open your account and **Turn off** two-step sign-in, which also signs you out everywhere,
or send you a new password-reset link, which turns it off when you use it. Either way you then
sign in with your password alone and can turn it on again. The admin created from
`APP_PASSWORD` can also be recovered with `HELPRR_ADMIN_PASSWORD_RESET`, which turns its
two-step sign-in off too.

## Your data

In **Settings → Account**, anyone can **Download my data**: one JSON file with their
profile, settings, watchlist, alerts, layouts, notification history, pending requests,
push devices, sessions, recommendation ratings and taste profile, and the YouTube and
Twitch videos they marked seen or hidden. It never holds a password, token or another person's data.
**Delete my account** removes the account and everything it owns, and signs it out
everywhere. It asks for the current password; an account that signs in only with
Jellyfin enters its Jellyfin password instead. The last active admin cannot delete itself:
make someone else an admin first. The admin created from `APP_PASSWORD` cannot delete
itself either, because Helprr re-creates it on every start while `APP_PASSWORD` is set.

## Sessions

**Settings → Sessions** lists where each person is signed in, and signs any of them out.
Admins see one group per person, newest sign-in first, with this device at the top of
their own list. A sign-in lasts at most 30 days, and ends sooner if the device does not
use Helprr for 14 days; push notifications keep arriving either way.
Changing someone's password in **Settings → Users** signs them out everywhere, including
an admin changing their own. Changing your own password in **Settings → Account** signs
out your other devices and keeps this one signed in. The
`HELPRR_ADMIN_PASSWORD_RESET` startup reset signs the admin out everywhere too, and ends
any reset link made for them.

The same page holds your **API tokens**, for reading Helprr from Shortcuts and
dashboards: see [Status API and tokens](/helprr/status-api/). A password change, a
reset or a disabled account ends them too.

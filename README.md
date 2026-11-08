# Cinejoy for Samsung TV (TizenBrew module)

Opens https://cinejoy.pk on a Samsung (Tizen) TV and makes it work with the TV remote.

## Remote controls

| Where | Button | What it does |
|---|---|---|
| Browsing | ◀ ▲ ▼ ▶ | Move the green focus box |
| Browsing | OK | Open / press the highlighted item |
| Browsing | Back | Go back a page |
| Home page | Back | Jump to the bottom menu (Home, Movies, Series, Saved, Search, Settings). Press Back again to exit |
| Search box | OK | Open the TV keyboard. ◀ ▶ move the text cursor, ▲ ▼ leave the box |
| Watching | OK / ⏯ | Play / pause |
| Watching | ◀ ▶ (or ⏪ ⏩) | Skip back / forward 10 seconds |
| Watching | ▲ ▼ | Show the time |
| Watching | Back | Leave the player |

## 1. Install TizenBrew on the TV (one time)

Needs a Samsung TV from 2017 or later (Tizen 3.0+), and a PC on the same Wi-Fi.

1. On the TV, open **Apps**, then press **1 2 3 4 5** on the remote. In the
   Developer Mode popup, turn **Developer mode On**, enter your **PC's IP address**
   under "Host PC IP", press OK, and restart the TV.
2. On the PC, download **TizenBrew Installer** for Windows from
   https://github.com/reisxd/TizenBrewInstaller/releases/latest and run it.
3. Click **Install TizenBrew**. (On newer TVs, Tizen 7+, it asks you to sign in
   to a Samsung account to make a certificate.)

TizenBrew now appears in the TV's apps.

## 2. Put this module online (one time)

TizenBrew downloads modules from npm or GitHub, so this folder must be published
to one of them:

- **npm:** in this folder run `npm login` and then `npm publish`.
  The module name is `cinejoy-tv-tizenbrew`. Change `"name"` in package.json if
  that name is taken.
- **GitHub:** create a public repository and upload `package.json` and `nav.js`
  to its root.

After changing `nav.js`, raise `"version"` in package.json and publish again.

## 3. Add the module in TizenBrew

Open TizenBrew on the TV, go to its module manager, and add the module by its
npm name (`cinejoy-tv-tizenbrew`) or its GitHub repository (`your-user/your-repo`).
Then pick **Cinejoy** from TizenBrew's list to launch it.

## Notes

- This was tested in a desktop browser on cinejoy.pk, not yet on a real TV.
- The video player's own buttons (subtitles, quality, servers) only appear when a
  mouse moves, so they can't be reached with the remote. Play/pause and skipping
  work through the remote instead.
- If cinejoy.pk changes its page layout, the navigation may need adjusting.

# 🎃 Spookboard: a Halloween soundboard for your phone

Pair your phone with a Bluetooth speaker, start a creepy background drone, and hit
scare buttons as trick-or-treaters walk up.

- **Drones:** your own looping background tracks. Tap to start/stop, and layer several at once.
- **Scares:** your own one-shot sounds. They fire the instant your finger touches the button.
- Add MP3/WAV/M4A files straight from your phone with the **＋ Add** tiles. They're saved on
  the phone and work offline.
- **Auto-spook:** fires a random scare every 20–60 seconds (adjustable) while you hide
- Drones **dip automatically** while a scare plays so the scare cuts through
- **Works offline.** After the first visit, it runs entirely on the phone.
- Keeps the screen awake, and has a big red **Stop all** button

Free Halloween sound effects are on sites like pixabay.com/sound-effects or freesound.org
(look for "CC0" or "no attribution required").

## How to get it onto your phone (one-time setup, about 5 minutes)

The app is a set of web files. The easiest way to put them on a phone is free
hosting with **GitHub Pages**. After the phone opens the page once, it keeps a copy
and works with no internet.

1. On GitHub, open this repository → **Settings** → **Pages** (left sidebar).
2. Under **Build and deployment → Source**, choose **Deploy from a branch**.
3. Under **Branch**, pick the branch these files are on (`main` once merged), folder
   **`/ (root)`**, and click **Save**.
4. Wait about a minute. The page will show your link, which will be
   **https://yaazer.github.io/Halloween_soundboard/**
5. Open that link on your phone, then add it to your home screen:
   - **iPhone (Safari):** Share button → **Add to Home Screen**
   - **Android (Chrome):** ⋮ menu → **Add to Home screen** / **Install app**
6. Open it from the home screen icon once while you still have internet. From then
   on it works offline.

## On Halloween night

1. Pair the Bluetooth speaker with your phone.
2. Open **Spookboard** and tap the pumpkin.
3. The first time, tap **＋ Add drones** and **＋ Add scares** to load your MP3s.
   To remove one later: tap **✎ Edit** (top right), tap the sound, then **✓ Done**.
   Tap one or more **drones** to start the atmosphere (tap again to stop each one).
4. Fire **scares** as kids walk up. Sounds start the instant your finger touches the tile.
5. Or turn on **🤖 Auto** and let it scare people for you.
6. **⏹ Stop all** silences everything immediately.

### Tips

- **iPhone silent switch:** newer iPhones (iOS 17+) play even in silent mode. On older
  ones, flip the ring/silent switch to ring.
- **Turn the phone volume all the way up** and use the in-app sliders to balance levels.
- **Bluetooth delay:** most speakers add a small delay (around 0.1–0.3 s). Tap a moment early.
- **Don't lock the phone.** The app keeps the screen awake, but switching apps or locking
  the screen can pause the audio. If that happens, tap anywhere in the app to resume.
- Plug the phone in. A screen kept on all evening uses a lot of battery.

## Updating the app later

The app always fetches the newest version when it has internet, so updates appear the next
time you open it. (Phones that still have the very first version need to reopen it twice.)

## Files

| File | What it does |
|---|---|
| `index.html` | The page layout |
| `style.css` | Colours and look |
| `app.js` | Buttons, volume, auto-spook, saving and playing your sounds |
| `sw.js` | "Service worker": saves the app on the phone for offline use |
| `manifest.webmanifest`, `icons/` | Home-screen name and icon |

## Trying it on a computer

From this folder, run `npx http-server` and open the address it prints. (Opening
`index.html` directly by double-clicking won't work, because browsers block some features
for local files.)

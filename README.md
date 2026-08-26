# Duty Roster — installable app (no Play Store needed)

This is a mobile web app (PWA). Once it's hosted on a real URL (GitHub Pages, in this
guide) and Firebase is connected, anyone with the link can open it on Android, tap
"Add to Home Screen / Install app", and it behaves like a normal installed app —
its own icon, full screen, no browser bar.

Files in this folder:

```
index.html            the app shell + all styling
app.js                 all the app logic (talks to Firestore)
firebase-config.js     <-- you paste your Firebase project's keys here
manifest.json          tells Android this is an installable app (name, icon, colors)
sw.js                  service worker — lets the app open even with a flaky connection
icons/                 app icons (192px, 512px, and a maskable 512px for Android)
```

---

## Part 1 — Create the Firebase project (the database)

1. Go to **https://console.firebase.google.com**
2. Click **Add project** → give it any name (e.g. `duty-roster`) → you can turn off
   Google Analytics for this, it's not needed → **Create project**.
3. Once created, on the project home page click the **`</>`  (Web)** icon to
   register a web app. Give it a nickname (e.g. `duty-roster-web`). You do **not**
   need Firebase Hosting for this — skip that checkbox.
4. Firebase will show you a code block that looks like:
   ```js
   const firebaseConfig = {
     apiKey: "AIza...",
     authDomain: "duty-roster-xxxx.firebaseapp.com",
     projectId: "duty-roster-xxxx",
     storageBucket: "duty-roster-xxxx.appspot.com",
     messagingSenderId: "...",
     appId: "..."
   };
   ```
   Copy those six values into **`firebase-config.js`** in this folder, replacing the
   `PASTE_YOUR_...` placeholders. Save the file.

5. In the left sidebar of the Firebase console, go to **Build → Firestore Database**
   → **Create database** → choose a location close to Pakistan (e.g.
   `asia-south1` or `asia-southeast1`) → start in **production mode** → Enable.

6. Go to the **Rules** tab of Firestore and replace the rules with this, then
   click **Publish**:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /{document=**} {
         allow read, write: if true;
       }
     }
   }
   ```

   **Important — please read:** these rules mean *anyone who has your app's web
   address* can read and write the data, because there is no login system built
   into this app (access is only controlled by the 4-digit PINs inside the app
   itself, not by Firebase). This is fine for an internal tool that isn't
   advertised publicly, but:
   - Don't post the live link publicly or index it in search engines.
   - Only share the link with your three station admins and yourself.
   - If you ever want real per-person accounts and stricter security, that's a
     bigger upgrade (Firebase Authentication) — happy to help with that separately
     if you need it later.

That's it for Firebase — no billing setup is required; the free "Spark" plan
comfortably covers this app's usage.

---

## Part 2 — Put the files on GitHub and turn on GitHub Pages

1. Go to **https://github.com** → sign in (or create a free account) →
   **New repository** → name it e.g. `duty-roster` → keep it **Public** (GitHub
   Pages on a free account needs a public repo) → **Create repository**.
2. On the new repo's page, click **uploading an existing file** (or drag-and-drop)
   and upload every file/folder from this package: `index.html`, `app.js`,
   `firebase-config.js` (with your real keys already pasted in), `manifest.json`,
   `sw.js`, and the whole `icons` folder. Keep the same folder structure — `icons`
   must stay a subfolder, not flattened.
3. Commit the files (the green **Commit changes** button).
4. Go to the repo's **Settings** tab → **Pages** (left sidebar) → under
   **Build and deployment**, set **Source** to **Deploy from a branch**, branch
   `main`, folder `/ (root)` → **Save**.
5. Wait about a minute, then refresh that Pages settings page — it will show a
   green banner with your live URL, something like:
   `https://yourusername.github.io/duty-roster/`

Open that link on your phone — that's your live app.

---

## Part 3 — Install it like an app on Android

1. Open the GitHub Pages link above in **Chrome** on the Android phone.
2. Tap the **⋮** menu (top right) → **Add to Home screen** (sometimes shown as
   **Install app**) → **Install**.
3. An icon named "Duty Roster" now sits on the home screen. Opening it launches
   full-screen, no browser address bar — it behaves like any other installed app.

Do this on each station admin's phone and on your own (Owner) phone, using the
same link.

---

## Everyday use after setup

- **Admins**: open the app → pick their station → enter their PIN
  (Multan `7867`, Bahawalpur `7861`, Okara `7862` by default — changeable inside
  the app) → add operators once, then log daily duty going forward.
- **Owner (you)**: open the app → Owner Console → PIN `1234` by default
  (change it in Settings) → Monthly Report, By Counter ranking, Live Log with
  delete access, and a place to view/reset every admin's PIN.
- All three stations' data lives in the same Firestore database, so whatever an
  admin enters shows up for you (and for the other stations, if they ever need
  to see it) within a few seconds automatically.

## Updating the app later

If you ever want a wording tweak, a new counter, a color change, etc. — send me
the request, I'll hand you an updated `index.html` / `app.js`, you upload it to
the same GitHub repo (overwriting the old file), and everyone's already-installed
app icon updates itself automatically the next time their phone has a connection
(no reinstall needed).

# KVD Windpark snagging

A web app for flat-by-flat snagging and handover at KVD Windpark. It covers 5 towers of RCC-framed 2BHK and 3BHK flats.

QC works through a room-by-room checklist on a phone and marks each item OK, N/A or Snag. Every snag is assigned to a team. The team marks it fixed with a photo and QC verifies and closes it. A flat can only be handed over once its inspection is complete and no critical or major snag is open. The handover screen records meter readings, keys, documents, the customer walkthrough and both signatures.

The site is static files on GitHub Pages. Login, the database and (optionally) photo storage are provided by Firebase.

```
index.html               the page
js/app.js                the app
js/checklist.js          checklist data (generated from tools/checklist.py)
js/firebase-adapter.js   sign-in screen and the Firebase connection
js/config.js             your Firebase keys and admin emails  <- edit this
firestore.rules          database access rules                <- edit and publish
storage.rules            photo storage rules (only if you turn Storage on)
docs/                    checklist workbook (Excel)
tools/                   scripts that regenerate the checklist and workbook
```

## 1. Firebase project (about 15 minutes)

1. Go to https://console.firebase.google.com and click **Create a project**, for example `kvd-snagging`. You can switch Google Analytics off. The free Spark plan is enough to start.
2. **Add a web app.** Project overview › `</>` Web, then give it a nickname. Firebase shows a `firebaseConfig` block. Copy those six values into `js/config.js`. They are not secret, because access is controlled by the rules in step 4.
3. **Authentication** › Get started › Sign-in method:
   - Enable **Google**.
   - Enable **Email/Password**, for contractors without a Google account.
   - Under Settings › **Authorised domains**, add `YOUR-GITHUB-USERNAME.github.io`, plus your own domain if you use one. `localhost` is already there.
4. **Firestore Database** › Create database:
   - Choose production mode.
   - Location: `asia-south2 (Delhi)` or `asia-south1 (Mumbai)`. This can't be changed later.
   - Open the **Rules** tab, paste in `firestore.rules`, and click **Publish**. First change the admin email list in the rules (`['ab@bbarch.net']`) if needed, and keep it identical to `adminEmails` in `js/config.js`.

### Photos

By default (`useStorage: false`), photos are compressed on the phone to about 900 px and stored in Firestore. This works on the free plan.

For full-size photos, move the project to the **Blaze** plan. Firebase needs Blaze for Cloud Storage buckets on projects created after 30 Oct 2024. Blaze still has a no-cost allowance, but it needs a billing account. Then:

1. Go to Storage › Get started, and pick the same region as Firestore.
2. Paste `storage.rules` into the Rules tab and publish it.
3. Set `useStorage: true` in `js/config.js`.

## 2. GitHub Pages

```bash
cd kvd-snagging-github
git remote add origin https://github.com/YOUR-GITHUB-USERNAME/kvd-snagging.git
git push -u origin main
```

On GitHub, go to the repo **Settings › Pages** and set Source to **Deploy from a branch**, with branch `main` and folder `/ (root)`. The site goes live at `https://YOUR-GITHUB-USERNAME.github.io/kvd-snagging/` within a minute or two.

Pages on a private repo needs a paid GitHub plan. On a public repo the code is visible, but the data is not. Nobody gets in without an account that the admin has approved.

To test locally first, run `python3 -m http.server 8000` in this folder and open http://localhost:8000.

## 3. First run

1. Open the site and sign in with Google as the admin (`ab@bbarch.net`).
2. Open **Setup**. Paste the apartment list from the **Apartment list** sheet of `docs/KVD_Windpark_Snag_Checklist.xlsx`, check the tower names and click **Save setup**.
3. Send the link to the team. Each person signs in and sees a waiting screen.
4. In **Setup › People and roles**, give each person a role:
   - **QC inspector:** runs inspections, raises snags, verifies fixes.
   - **Contractor team:** set their team too. They see their team's snags first and can mark them fixed.
   - **CRM / handover:** records handovers and customer snags.
   - **Admin:** everything, including setup.

   Their screen opens the app as soon as the role is saved.

## Changing the checklist

Edit `tools/checklist.py` (items, criteria, default team, severity, rooms per flat type, handover items), then run:

```bash
python3 tools/checklist.py      # rewrites js/checklist.js
python3 tools/make_xlsx.py      # rewrites docs/KVD_Windpark_Snag_Checklist.xlsx (needs openpyxl)
```

Commit and push. Item IDs such as `WAL-03` are stored against each flat, so add new IDs rather than renumbering old ones. Room layouts and team names can also be changed from the Setup screen without touching code.

## Good to know

- **Offline:** the app keeps a local copy on each phone. Ticks and snags made without signal are saved on the device and sync when the connection is back. With `useStorage: true`, photos taken offline fall back to the compressed Firestore copy.
- **What the rules enforce:** only approved people can read or write project data, only admins can change setup or roles, and people can only edit their own profile. The finer role limits (for example, a contractor can mark fixed but not close) are enforced by the app screens, not by the database rules. That's fine for a site team, but it isn't a hard security boundary.
- **Free-plan limits** (Spark): 1 GiB stored, 50,000 reads and 20,000 writes a day. A team of 20 to 30 inspecting a few floors a day stays well inside this. The main cost is photos. At about 120 KB each, 1 GiB holds roughly 8,000 photos. Move to Blaze with Storage turned on if you expect more.
- **Data layout:** `config/project` (towers, flat list, teams, room templates), `config/members` (roles), `people/{uid}`, `units/{tower-flat}` (checks, snags, handover for one flat), `sum/{tower}` (per-flat status for the dashboards), `photos/{id}`.
- **Backups:** Firestore › Import/Export, or schedule exports on Blaze.

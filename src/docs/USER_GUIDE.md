# Outreach Microplan & Coverage — User Guide

This guide is for people **using** the Outreach Microplan & Coverage DHIS2 app —
program officers, M&E staff, and supervisors who upload team microplans,
browse the coverage map, and review out-of-bounds visits. It does not cover
installation or development; see `README.md` for that.

---

## 1. What this app does

The app helps outreach programmes (e.g. routine immunisation) answer three
questions:

1. **Where is each team supposed to work?** — teams are assigned settlements,
   grouped by ward, for specific weeks of an outreach round.
2. **Where did the team actually record data?** — the app pulls the
   corresponding tracker/event data straight from DHIS2 for the same period.
3. **Did anyone visit somewhere they weren't assigned?** — every recorded
   point is checked against the team's assigned settlements, and anything
   outside is flagged for follow-up.

You work with three screens, reached from the top navigation bar: **Map**,
**Files**, and **Upload**.

---

## 2. Signing in and permissions

The app runs inside your DHIS2 instance and uses your existing DHIS2 login —
there is no separate username/password. What you can do depends on your
DHIS2 user role's authorities:

| Authority | Grants |
|---|---|
| `F_VIEW_MICROPLAN` | Required to open the app at all — Map, Files, and User Guide |
| `F_ADD_MICROPLAN` | Shows the **Upload** tab and allows uploading new microplans |
| `F_DELETE_MICROPLAN` | Shows the **Delete** button on the **Files** page |
| `ALL` (superuser) | All of the above |

Without `F_VIEW_MICROPLAN` (or `ALL`) you'll see a permission message instead
of the app. The **Upload** tab is hidden unless you hold `F_ADD_MICROPLAN`
(or `ALL`), and the **Delete** button on the Files page is hidden unless you
hold `F_DELETE_MICROPLAN` (or `ALL`). If something you expect to see is
missing, ask your DHIS2 administrator to add the relevant authority to your
user role.

Your display name appears in the top-right of the app bar once you're
signed in, confirming which DHIS2 account you're using.

---

## 3. Uploading a microplan

Go to **Upload** in the navigation bar.

### 3.1 Prepare your file

Accepted formats: **CSV, TSV, XLSX, XLS**. The parser tolerates messy
real-world headers — it recognises common spelling variants automatically,
for example:

| Field | Recognised header variants |
|---|---|
| Settlement | `settlement`, `settlement name`, `community`, `Nigeria Settlements` |
| Team code | `team code`, `teamcode`, `team`, `team id` |
| Ward | `ward`, `ward name` |
| State | `state`, `state name` |
| LGA | `lga`, `lga name` |
| Health facility | `facility name`, `facility`, `health facility`, `hf` |
| Week 1–5 | `week 1` … `week 5`, `wk1` … `wk5`, `w1` … `w5`, `outreach week 1` … |

Each **week column** should list the settlement(s) that team visits that
week — one settlement, or several separated by a comma, semicolon, or
newline. A cell containing `0`, `no`, `n`, `-`, `na`, or left blank is
treated as "not visited that week." One team can visit many settlements
across many weeks, and a settlement can belong to multiple teams.

### 3.2 Upload steps

1. Click **Choose or drop a file**, or drag a file onto the upload box.
2. Wait for parsing to finish — a status line shows how many rows were read,
   and a preview table shows the first 8 rows so you can sanity-check that
   columns were recognised correctly (team, state, LGA, ward, facility, and
   a visit count per week).
3. Fill in the three required fields that appear once a file is parsed:
   - **Activity / program** — the DHIS2 tracker program this microplan
     belongs to. Every upload must be linked to a program.
   - **Reporting period** — the outreach round/month this plan covers.
   - **Organisation unit** — the org unit (e.g. State or LGA) the plan sits
     under. Use the expandable tree to drill down; click a name to select it.
4. Click **Save to dataStore**. The app resolves settlement boundaries for
   every ward in the file (using the configured settlement-geometry source —
   GRID3/ArcGIS, PMTiles, or DHIS2 org-unit geometry) before saving.
5. A confirmation message shows the number of teams and settlements saved.
   The **Save to dataStore** button stays disabled until a program is
   selected — if you see "Select a program to enable saving," go back and
   pick one.

Uploaded microplans are stored in the DHIS2 **dataStore**, so they're
available to every user of the app on this instance, not just you.

---

## 4. Managing uploaded microplans (Files page)

Go to **Files** to see every microplan anyone has uploaded: file name,
program, period, org unit, level, team/settlement counts, who uploaded it,
and when.

- **Show on map** — activates that microplan as a layer on the Map page and
  takes you there. A row already shown reads **On map ✓**.
- **Delete** — removes the microplan permanently (you'll be asked to
  confirm). Only visible if you hold `F_DELETE_MICROPLAN` (or `ALL`).
- **+ Upload new** — shortcut to the Upload page.

If nothing has been uploaded yet, the page tells you so and points you to
**Upload new**.

---

## 5. The Map page

This is the main working view: an interactive map plus a filter bar, layer
controls, and status/legend readouts.

### 5.1 Filtering what you're looking at

The **filter bar** across the top of the map narrows things down step by
step — later fields appear only once the ones before them are set:

1. **Program (activity)** — which DHIS2 tracker program to show data for.
2. **Organisation unit** — pick a State. from the lazy tree
   picker (it loads children on demand, so it stays fast even with tens of
   thousands of org units). Selecting a higher-level unit (e.g. a State)
   includes every microplan uploaded under it.
3. **Team** — once a program and org unit are chosen, search and pick a
   specific team/user to focus the map on just their assigned settlements
   and visits.
4. **Dimensions** — attributes or data elements (grouped by program stage)
   you want plotted as coordinate layers, if the program collects more than
   one kind of geo-tagged data.
5. **Period** — the DHIS2 relative period (e.g. "This month," "Last 3
   months") the analytics/tracker data should be pulled for.

Click **Clear** (shown once any filter is active) to reset all of them.

### 5.2 Searching settlements and wards

The search box in the top app bar (visible on the Map page) does a
type-ahead search across every settlement and ward available to the app —
hundreds of thousands of records, searched instantly because the index runs
in a background worker and is cached on your device. Start typing a name;
matching settlements and wards appear with their ward/state for context.

### 5.3 Reading the map

- **Settlement polygons** — the boundaries of settlements assigned to the
  visible teams.
- **Visit points** — clustered markers for the tracker/event data pulled
  from DHIS2 for the selected program, org unit, and period.
- **Flagged (red) points** — visits recorded **outside** the team's
  assigned settlements. These are the out-of-bounds cases you should
  follow up on.
- **Outreach week chips** — when a team is selected, colour-coded chips
  (W1–W5) show how many settlements that team is assigned per week.
- The **legend bar** at the bottom of the map summarises what's currently
  shown: number of microplans, number of flagged points, settlement count,
  and (when a team is selected) how many settlements that team visited.

### 5.4 Layers panel

Click the **Layers** handle (top of the map controls) to open it:

- **Basemap** — switch the background tile style by clicking a swatch.
- **Overlays** — toggle individual layers on/off:
  - *Settlement Boundaries*
  - *Visits*
  - *Flagged Visits*
  - *OrgUnit boundaries*
  - *Settlements (Outreach visits)*

If the selected program has more than one geo-tagged attribute or data
element, a **Coordinate layers** panel also appears, letting you toggle each
one independently and see how many points each contributed.

### 5.5 Viewing the underlying data

Click **View data** (bottom of the map) to open a plain data table of the
analytics rows behind the current selection — useful for double-checking a
number or exporting context without leaving the app. It stays disabled
until a program, org unit, period, and team are all selected, and it only
fetches once you open it.

---

## 6. Typical workflow

1. **Upload** this round's microplan (CSV/Excel), tag it with the right
   program, period, and org unit.
2. Go to **Files** and confirm it appears with the expected team/settlement
   counts, then click **Show on map**.
3. On the **Map**, pick the same program, org unit, and period, then select
   a team to see exactly which settlements they were assigned and which
   weeks they cover.
4. Look for **red flagged points** — these are visits recorded outside the
   team's assigned area. Use **View data** or click a flagged point for
   details, then follow up with the team.
5. Repeat per team, or clear the team filter to see flags across the whole
   org unit at once.

---

## 7. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| "Select a program to enable saving" on Upload | Pick an Activity/program before saving — it's required on every upload. |
| A column wasn't picked up in the preview table | Its header doesn't match a recognised alias (see §3.1). Rename the column to one of the listed variants and re-upload. |
| Settlement count is 0 after saving | The configured settlement-geometry source (GRID3/ArcGIS, PMTiles, or org-unit geometry) had no match for the ward names in your file — geometry is optional and upload still succeeds, but polygons won't draw on the map. Check ward name spelling against the source. |
| No **Delete** button on the Files page | Your DHIS2 user role doesn't hold `F_DELETE_MICROPLAN` (or `ALL`). Ask your administrator. |
| Map shows "Loading map layers…" for a long time | Large org units (e.g. a whole State) pull a lot of tracker/event data; it will finish, but consider narrowing to an LGA or ward, or a shorter period. |
| **View data** button stays disabled | It needs a program, org unit, period, *and* a selected team all set at once. |

---

## 8. Glossary

- **Microplan** — the uploaded file describing which team visits which
  settlements, and in which weeks, for a given activity/program and period.
- **Team code** — the identifier (usually matching a DHIS2 username) used to
  group settlement assignments into a team plan.
- **Settlement** — the smallest geographic unit teams are assigned to;
  sourced from GRID3/ArcGIS, PMTiles, or DHIS2 org-unit geometry depending
  on how the instance is configured.
- **Flagged point** — a tracker/event data point whose coordinates fall
  outside every settlement assigned to the relevant team for that period.
- **dataStore** — the DHIS2 storage area (not a regular dataset) this app
  uses to save uploaded microplans, shared across all users of the app.

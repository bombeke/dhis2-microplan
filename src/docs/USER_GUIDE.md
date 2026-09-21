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

You work from a tab bar under the app title. The tabs are the places you
*work in*, listed in the order the job usually flows, with administration
separated at the far right — so the four work tabs never shift position
between an administrator's screen and a field user's.

| Tab | What it's for |
|---|---|
| **Map** | The coverage map — filters, layers, flagged visits |
| **Microplans** | The catalogue of uploaded microplans (previously "Files") |
| **Upload** | Add a new microplan from CSV/Excel (needs upload rights) |
| **Export** | Download the data behind a saved DHIS2 visualization as CSV or JSON |
| **Settings** | Who can do what in this app (administrators only) |

Two things live in the app bar rather than the tab bar, because you reach for
them mid-task and leave again rather than working in them:

- **?** — the **User guide** (this document, rendered in the app). It sits
  just left of your name and highlights while you're reading it.
- **Your name** — opens a menu showing the DHIS2 account you're signed in as,
  your user roles, and shortcuts to the User guide and — if you're an
  administrator — Settings.

![Microplanning App](images/screenshot_main.png)

---

## 2. Signing in and permissions

The app runs inside your DHIS2 instance and uses your existing DHIS2 login —
there is no separate username/password. What you can do depends on which
**microplan authorities** you hold:

| Authority | Grants |
|---|---|
| `F_VIEW_MICROPLAN` | Required to open the app at all — Map, Microplans, Export, and User guide |
| `F_ADD_MICROPLAN` | Shows the **Upload** tab and allows uploading new microplans |
| `F_DELETE_MICROPLAN` | Shows the **Delete** button on the **Microplans** page |
| `F_DOWNLOAD_MICROPLAN` | Exporting analytics data as CSV or JSON from the **Export** page |
| `F_READ_GPS_MICROPLAN` | Seeing raw event coordinates and out-of-bounds flags on the map |
| `F_ADMIN_MICROPLAN` | Shows the **Settings** tab and allows changing who can do what |
| `ALL` (superuser) | All of the above |

### 2.1 Where an authority can come from

There are two places an authority can be granted, and the app checks them in
this order:

1. **Your DHIS2 user role.** This is the normal route: an administrator adds
   the authority to a user role in the DHIS2 **Users** app, and everyone with
   that role has it everywhere.
2. **This app's Settings page.** If editing DHIS2 user roles isn't practical
   in your instance, an app administrator can map microplan authorities onto
   existing user roles and user groups from inside the app (see §7). The app
   consults this list whenever DHIS2 itself hasn't already granted the
   authority.

The second route only ever **adds** access. It can never take away an
authority your DHIS2 user role genuinely gives you, so the DHIS2 permission
model stays in charge and the in-app list is a convenience on top of it.

To see how your own access resolves, open **Settings → Your access** (if you
have administrator rights). It lists each authority with the source that
granted it: your DHIS2 user role, the app's settings, or superuser.

Without `F_VIEW_MICROPLAN` (or `ALL`) you'll see a permission message instead
of the app. Tabs and buttons you don't hold the authority for are hidden
rather than disabled. If something you expect to see is missing, ask your
DHIS2 administrator to add the relevant authority to your user role, or to add
one of your roles or groups on the app's Settings page.

Your display name appears in the top-right of the app bar once you're signed
in, confirming which DHIS2 account you're using.

---

## 3. Uploading a microplan

Go to **Upload** in the navigation bar.

![Microplanning Uploading](images/screenshot_uploadfile.png)

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

   ![Microplanning Uploading File](images/screenshot_uploadfile.png)

2. Wait for parsing to finish — a status line shows how many rows were read,
   and a preview table shows the first 8 rows so you can sanity-check that
   columns were recognised correctly (team, state, LGA, ward, facility, and
   a visit count per week).

   ![Microplanning Upload Preview](images/screenshot_uploadpreview.png)

3. Fill in the three required fields that appear once a file is parsed:
   - **Activity / program** — the DHIS2 tracker program this microplan
     belongs to. Every upload must be linked to a program.
   - **Reporting period** — the outreach round/month this plan covers.
   - **Organisation unit** — the org unit (e.g. State or LGA) the plan sits
     under. Use the expandable tree to drill down; click a name to select it.

    ![Microplanning Upload Save](images/screenshot_uploadsave.png)

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

## 4. Managing uploaded microplans (Microplans page)

Go to **Microplans** to see every microplan anyone has uploaded: file name,
program, period, org unit, level, team/settlement counts, who uploaded it,
and when.

- **Show on map** — activates that microplan as a layer on the Map page and
  takes you there. A row already shown reads **On map ✓**.
- **Delete** — removes the microplan permanently (you'll be asked to
  confirm). Only visible if you hold `F_DELETE_MICROPLAN` (or `ALL`).
- **+ Upload new** — shortcut to the Upload page.

![Microplanning Files](images/screenshot_fileview.png)

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
   months") the analytics/tracker data should be pulled for. Open the
   dropdown and either pick a relative period from the grouped list
   (Daily → Yearly, searchable), or set an exact **custom date range**:
   fill in **Start Date** and **End Date** using the calendar pickers at
   the top of the panel, then click **Apply** (it stays disabled until
   both dates are set). Once applied, the field shows the chosen range,
   e.g. `2026-08-02 - 2026-08-09`, in place of a relative period name.

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

  ![Microplanning Uploading](images/screenshot_points.png)

- **Outreach weeks panel** — when a team is selected, a floating panel in
  the top-left of the map lists one colour-coded chip per week that team
  has assignments for (W1–W5), each showing how many settlements are due
  that week. Every chip has its own checkbox, checked by default: untick
  a week to hide its settlement shading from the map, tick it again to
  bring it back — handy for isolating one week's outreach area at a time
  without losing the others.
- The **legend bar** at the bottom of the map summarises what's currently
  shown: number of microplans, number of flagged points, settlement count,
  children visited, and (when a team is selected) how many settlements
  that team visited.

  ![Microplanning Map](images/screenshot_display.png)

### 5.4 Layers panel

Click the **Layers** handle (top of the map controls) to open it:

- **Basemap** — switch the background tile style by clicking a swatch:
  *OSM Light*, *OSM Standard*, *OSM Dark*, *Satellite imagery*, or
  *No basemap*.
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

## 6. Exporting data (Export page)

The **Export** page takes a visualization already saved in your DHIS2
instance and downloads the data behind it as a **CSV** or **JSON** file —
including results far too large to open in the browser, which are fetched in
chunks in the background.

DHIS2 keeps saved visualizations in two different places, and the Export page
shows them as the two groups you switch between with the tabs above the list:

| Group | Where they are made | What a row means |
|---|---|---|
| **Aggregated** | **Data Visualizer** — pivot tables and charts | One row per combination of dimensions (e.g. district × month), holding a number |
| **Events / Line list** | **Event Visualizer** / **Line Listing** | One row per record — an event, an enrollment, or a tracked entity |

Each tab shows how many of its visualizations match your search, so if
something isn't where you expect, the count on the other tab tells you at a
glance that it's over there.

You only see visualizations that are shared with your DHIS2 user, and the data
you get back is the data your user is allowed to see. Exporting never widens
your access.

### 6.1 Which endpoint your data actually comes from

This matters more than it sounds. The place a visualization is *saved* is not
the place its *data* is downloaded from, and a line list is not fetched the
way a pivot table is. The app works this out for you:

| What you picked | Downloaded from |
|---|---|
| Any pivot table or chart | `/api/analytics` |
| Line list of **events** | `/api/analytics/events/query/{program}` |
| Line list of **enrollments** | `/api/analytics/enrollments/query/{program}` |
| Line list of **tracked entities** | `/api/analytics/trackedEntities/query/{type}` |
| Event visualization saved as aggregated values | `/api/analytics/events/aggregate/{program}` |

The endpoint is named under **Read from** in the summary panel, and the exact
request — every dimension, filter, and parameter — is under **Request
details** just below it. Both are there so that when a result looks wrong you
can hand an administrator the query that produced it instead of a
description of it.

Practical consequences worth knowing:

- **Line lists carry their stage with them.** In an enrollment or
  tracked-entity line list a data element has to be named together with the
  program stage it belongs to (and the program too, for tracked entities).
  The app rebuilds those qualified names from the saved visualization. If the
  visualization uses a **repeatable stage**, each chosen repetition (first
  event, latest event, and so on) comes through as its own column.
- **Aggregated exports round the way the visualization does**; line lists
  return the values as recorded.

### 6.2 Step 1 — choose a visualization

Pick the group tab, then type any part of a name into **Search by name**. The
search runs against the server (case-insensitive, matches anywhere in the
name), so it works on instances holding thousands of favourites. Results are
paged eight at a time; use the pager underneath the list to move between
pages.

Each row is labelled with what it is — its type (Pivot table, Line list,
Column…), and for event visualizations what it returns (Events, Enrollments,
Tracked entities) and whether it holds aggregated values. The program it
belongs to and the date it was last updated sit underneath.

Click a row to select it. The panel on the right then confirms the choice and
shows the dimensions it's built from — its columns, rows, and filters — plus
its program and stage where it has them. The list stays pinned beside that
panel while you work, so what you're exporting never scrolls out of sight.

### 6.3 Step 2 — choose a date range

Three options:

| Option | Meaning |
|---|---|
| **Pivot table period** | Leave the visualization exactly as it was saved — use whatever period it already carries (e.g. "Last 12 months"). |
| **Since a date** | Everything from a start date you pick, up to today. |
| **Last N …** | The last N **days**, **weeks**, **months**, or **years** counted back from today. N is any whole number greater than 0 — 7 months and 18 weeks are both fine. |

When you set a range it **replaces** the visualization's own period; the rest
of it (indicators, org units, filters) is untouched. A line under the control
always spells out the exact dates that will be requested, e.g.
`Last 7 months (2026-02-21 → 2026-09-21)`.

How the range reaches DHIS2 depends on what you picked:

- Pivot tables, charts and event line lists get it as an explicit
  **start and end date**.
- Tracked-entity line lists have no start/end pair in the API, so the range is
  applied to the **enrollment date** instead — the entities whose enrollment
  falls inside the window.

Leaving the range on **Pivot table period** for a line list falls back to the
dates saved on the visualization itself, if it has any.

### 6.4 Step 3 — download the data

Click **Download data**. The app requests the data **500 rows at a time** and
keeps going until it has everything — a 5 000-row result arrives as 10 chunks.
A progress bar reports the chunk it's on and the row count so far, e.g.
`Chunk 4 of 10 · 2,000 of 5,000 rows`.

- **Cancel** stops the download; nothing is exported and no partial file is
  written.
- Changing the visualization or the date range discards a finished download,
  so you can never export a file that doesn't match what's on screen. Just
  press **Download data** again.
- A finished download reports how many rows arrived in how many chunks.

### 6.5 Step 4 — export the file

The **Export** button stays disabled until all chunks have finished. Then:

- **Export type** — **CSV** (one header row plus one row per record, opens in
  Excel or any spreadsheet) or **JSON** (an object carrying the
  visualization's name and type, the endpoint it came from, the generation
  timestamp, the date range, the column list, and a `rows` array of records —
  convenient for scripts and pipelines).
- **Include dimension item IDs** — on by default. Each dimension column comes
  through with its readable name (e.g. `Bo`) plus a companion `… ID` column
  carrying the DHIS2 UID (e.g. `O6uvpzGd5pu`), which is what you need to join
  the export against other DHIS2 extracts. Turn it off for a cleaner,
  narrower file meant for reading.

A preview of the first eight rows is shown so you can check the shape of the
file before saving it.

Files are named after the visualization, the range, and today's date, for
example `anc-1st-visit-by-district_last-7-months_2026-09-21.csv`.

### 6.6 When a visualization can't be exported

Two cases are refused with an explanation instead of a broken download, and
both are fixed in the app the visualization was made in:

- **A line list saved across several programs.** Multi-program event
  visualizations don't have one program to query, so there is no single
  endpoint to call. Open it in the Line Listing app and save it against one
  program.
- **A tracked-entity line list with no tracked entity type saved.** The
  tracked-entity endpoint is addressed by entity type, so without one there
  is nothing to request. Re-save it in the Line Listing app.

---

## 7. Settings (administrators)

The **Settings** tab appears only for users holding `F_ADMIN_MICROPLAN` (or
`ALL`). It is where you decide who can use the app, without needing rights to
edit DHIS2 user roles themselves.

Everything on the page edits one draft. Nothing takes effect until you press
**Save settings**, and while you have unsaved edits a yellow strip says so;
**Discard changes** puts the draft back to what is stored.

### 7.1 What is stored, and where

Your choices are saved to the DHIS2 dataStore under the key
`microplan/settings`. That key holds three things:

- which microplan authorities each **user role** confers,
- which microplan authorities each **user group** confers,
- which **users** the app should treat as members of a user group.

Because it lives in the dataStore rather than in DHIS2 metadata, saving here
never edits a user role, a user group, or a user account. It only tells *this
app* to grant extra access — see §2.1.

The foot of the page shows when the settings were last saved and by whom.

### 7.2 Role authorities

A grid of your DHIS2 user roles down the side and the microplan authorities
across the top. Tick a box to give holders of that role the authority.

Where a role **already** holds an authority in DHIS2 itself, the cell shows a
green **DHIS2** tag instead of a checkbox. There is nothing useful to change
there: the real authority already grants access, and un-ticking a box next to
it would look like it removed access when it couldn't. Roles holding `ALL` are
marked **Superuser** and show DHIS2 tags throughout.

Use the filter box above the grid to find a role by name in a long list.

### 7.3 User groups

Pick a group from the dropdown, then set two things:

**Authorities** — the microplan authorities every member of that group gets,
on top of whatever their user roles already grant them.

**Members** — a two-column picker of who counts as a member. Users you add on
the right are members *for this app only*; DHIS2 group metadata is not
touched. People who are already in the DHIS2 group are listed on the right
too, marked "in DHIS2 group" and locked, so you can see the whole membership
in one place without being offered a removal this screen couldn't perform.

This is the route to use when you want to give a handful of named people
access without creating a user role for them.

### 7.4 Your access

A read-only summary of how your own access resolves: the account you're signed
in as, your user roles, the groups you count as a member of, and — for every
microplan authority — whether it came from a DHIS2 user role, from these
settings, or from superuser rights.

Check a change here on yourself before trusting it for everyone else. Granted
access appears as soon as the affected user reloads the app.

---

## 8. Typical workflow

1. **Upload** this round's microplan (CSV/Excel), tag it with the right
   program, period, and org unit.
2. Go to **Microplans** and confirm it appears with the expected
   team/settlement counts, then click **Show on map**.
3. On the **Map**, pick the same program, org unit, and period, then select
   a team to see exactly which settlements they were assigned and which
   weeks they cover.
4. Look for **red flagged points** — these are visits recorded outside the
   team's assigned area. Use **View data** or click a flagged point for
   details, then follow up with the team.
5. Repeat per team, or clear the team filter to see flags across the whole
   org unit at once.
6. When you need the numbers outside the app — for a report, a review
   meeting, or further analysis — use **Export** to pull the matching saved
   visualization down as CSV or JSON for the same period: a pivot table for
   the aggregate picture, a line list for the individual records behind it.

---

## 9. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| "Select a program to enable saving" on Upload | Pick an Activity/program before saving — it's required on every upload. |
| A column wasn't picked up in the preview table | Its header doesn't match a recognised alias (see §3.1). Rename the column to one of the listed variants and re-upload. |
| Settlement count is 0 after saving | The configured settlement-geometry source (GRID3/ArcGIS, PMTiles, or org-unit geometry) had no match for the ward names in your file — geometry is optional and upload still succeeds, but polygons won't draw on the map. Check ward name spelling against the source. |
| No **Delete** button on the Microplans page | Neither your DHIS2 user role nor the app's Settings page grants you `F_DELETE_MICROPLAN` (or `ALL`). Ask your administrator. |
| No **Settings** tab | Settings needs `F_ADMIN_MICROPLAN` (or `ALL`). Only a DHIS2 administrator can grant the first one — the app can't bootstrap its own administrator. |
| Can't find the **User guide** tab | It is no longer a tab. Use the **?** button in the app bar, beside your name, or the shortcut in your account menu. |
| Granted access in Settings but the user still can't see the tab | They need to reload the app; permissions are read once when it opens. Check the grant landed on a role or group that user actually belongs to — **Settings → Your access** shows how membership resolves. |
| A checkbox in the role grid is replaced by a **DHIS2** tag | That role already holds the authority in DHIS2 metadata, so there is nothing for the app to add. Change it in the DHIS2 **Users** app if you need to remove it. |
| **Save settings** stays greyed out | There are no unsaved changes. The button only lights up once the draft differs from what's stored. |
| "Could not save settings" | Your DHIS2 user can read the `microplan` dataStore namespace but not write to it. Ask a DHIS2 administrator about your dataStore access. |
| Map shows "Loading map layers…" for a long time | Large org units (e.g. a whole State) pull a lot of tracker/event data; it will finish, but consider narrowing to an LGA or ward, or a shorter period. |
| **View data** button stays disabled | It needs a program, org unit, period, *and* a selected team all set at once. |
| The **Export** page lists nothing | Check the count on the other group tab first — a line list is not in **Aggregated** and a pivot table is not in **Events / Line list**. If both are 0, nothing is shared with your DHIS2 user: save a favourite in Data Visualizer or Line Listing and share it with your user or user group. |
| **Export** button stays disabled | The download hasn't finished (or hasn't started). Run **Download data** first — the button turns on only when every chunk has arrived. |
| Export download says "No rows" | The visualization has no data for the range you chose. Widen the range, or switch back to **Pivot table period**. |
| "This visualization can't be exported" | It is a line list saved across several programs, or a tracked-entity line list with no entity type. See §6.6 — both are fixed by re-saving it in the Line Listing app. |
| A line-list export is missing a column you expect | The data element is probably in a program stage the saved visualization doesn't include. Open **Request details** in the summary panel to see exactly which dimensions were asked for. |
| A long export download seems stuck | Very large results take many chunks; the progress line shows the current chunk. If it genuinely stalls, **Cancel**, narrow the date range, and try again. |

---

## 10. Glossary

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
  uses to save uploaded microplans and its own access settings, shared across
  all users of the app.
- **Authority** — a named permission in DHIS2 (e.g. `F_ADD_MICROPLAN`). You
  hold an authority through a user role; this app can also grant its own
  microplan authorities through the Settings page.
- **User role** — a DHIS2 object bundling authorities together and assigned to
  users. Edited in the DHIS2 **Users** app.
- **User group** — a DHIS2 collection of users, normally used for sharing. The
  Settings page can attach microplan authorities to one, and can add extra
  members for this app only.
- **Pivot table** — a saved DHIS2 visualization (made in the Data Visualizer
  app) that arranges indicators, periods, and org units into a table, holding
  aggregated numbers. The Export page downloads the data behind one.
- **Line list** — a saved visualization (made in the Line Listing / Event
  Visualizer app) that lists individual records rather than totals: one row
  per event, enrollment, or tracked entity. The Export page's second group.
- **Analytics endpoint** — the DHIS2 API the data is actually read from.
  Aggregated visualizations come from `/api/analytics`; line lists come from
  the event, enrollment, or tracked-entity analytics endpoints. §6.1 has the
  full mapping.
- **Program stage** — a step in a tracker program (e.g. "Birth", "Postnatal
  visit"). Data elements belong to a stage, which is why enrollment and
  tracked-entity line lists name the stage alongside the data element.
- **Chunk** — one page of an export download. The app asks DHIS2 for 500 rows
  at a time and stitches the chunks back together, so big tables download
  without timing out.

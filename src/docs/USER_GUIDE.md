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

This is the main working view. It reads top to bottom: a **filter bar** that
asks what you want to see, a **summary strip** of the resulting counts, and
then the map itself, with its layer cards at the top-right and the data table
waiting behind **View data** at the bottom.

Hovering or clicking any visit point opens that person's full profile — bio
data plus every program stage — without leaving the map. See §5.6.

Two things deliberately open **over the page rather than inside the map**: the
profile card and the data table. Both used to be drawn inside the map's frame,
which meant anything taller than the frame was simply cut off — and the part
that got cut was the data. They now float above it, so what you open is always
whole. §5.8 covers how both behave on a phone or tablet.

### 5.1 Filtering what you're looking at

The **filter bar** across the top of the map is staged: it asks for the two
things every query needs first, and only then offers the filters that narrow
that result.

**Always shown — these two load the map**

1. **Programme** — which DHIS2 tracker program to show data for.
2. **Organisation unit** — pick a State (or any level) from the lazy tree
   picker; it loads children on demand, so it stays fast even with tens of
   thousands of org units. Selecting a higher-level unit includes every
   microplan uploaded beneath it.

Until both are set, the bar says so in plain words and the rest stays hidden —
there is nothing yet for those filters to act on.

**Shown once the map has something to draw**

3. **Team** — search and pick a specific team/user to focus the map on just
   their assigned settlements and visits. A team's code *is* its username.
4. **Period** — the DHIS2 relative period the data should be pulled for. Open
   the dropdown and either pick a relative period from the grouped, searchable
   list (Daily → Yearly), or set an exact **custom date range**: fill in
   **Start Date** and **End Date** with the calendar pickers at the top of the
   panel, then click **Apply** (disabled until both dates are set). Once
   applied, the field shows the range, e.g. `2026-08-02 - 2026-08-09`, in place
   of a relative period name.
5. **Data columns** — the attributes and program-stage data elements you want
   added to the data table and to each tracked entity's profile. See §5.2.

The controls all start from the **left edge** and wrap onto a second row as
the window narrows, so they read in order instead of drifting apart across a
wide screen. On a phone each control takes the full width and they stack in the
same order.

Under the bar, a row of **chips** restates what is currently selected —
programme, team, period, extra columns. Each chip has an **✕** that removes
just that one filter, which is quicker than reopening its dropdown; **Clear
all** resets everything.

### 5.2 Choosing extra data columns

The **Data columns** picker lists everything the selected programme collects,
grouped the way the programme itself is structured:

- **Bio data** — the tracked-entity attributes (name, sex, date of birth,
  caregiver, and so on).
- **One group per program stage** — that stage's data elements, named after
  the stage (e.g. *Birth dose*, *6 Weeks*, *10 Weeks*).

Tick a group's header to take all of its fields at once, or pick individual
fields; the search box matches names across every group. What you pick has two
effects:

- the fields become **columns in the data table** (§5.7), placed under a band
  carrying their group's name;
- the fields are **filled in on each entity's profile** (§5.6).

Two things are always included whether or not you pick them, so you never have
to: every **bio-data attribute**, and every attribute or data element that
holds a **coordinate** (those are what the map draws). Picking a coordinate
field does something slightly different — it narrows the map to just the
coordinate layers you picked, the same as unticking the others in the **Point
layers** card.

Keeping stage data elements opt-in is deliberate: a programme with a dozen
stages would otherwise turn every pan of the map into a several-hundred-column
query.

### 5.3 Searching settlements and wards

The search box in the top app bar (visible on the Map page) does a type-ahead
search across every settlement and ward available to the app — hundreds of
thousands of records, searched instantly because the index runs in a background
worker and is cached on your device. Start typing a name; matches drop down
beneath the field, each tagged **settlement** or **ward** and showing its
ward/state for context. On a phone the field moves to its own row under the
tabs, where it has the width a search box needs.

### 5.4 Reading the map

Above the map, a **summary strip** carries the numbers that say whether this
view is worth acting on: microplans shown, **flagged visits** (red when there
are any), visits recorded, settlements, and — when a team is selected — how
many settlements that team visited. They sit above the map rather than inside
it so they stay readable while you pan, and stay visible when the data panel
is open.

On the map itself:

- **Settlement polygons** — the boundaries of settlements assigned to the
  visible teams.
- **Visit points** — clustered markers for the tracker/event data pulled from
  DHIS2 for the selected programme, org unit, and period. Clicking a cluster
  zooms into it.
- **Flagged (red) points** — visits recorded **outside** the team's assigned
  settlements. These are the out-of-bounds cases to follow up on.

  ![Microplanning Uploading](images/screenshot_points.png)

- **Outreach weeks panel** — when a team is selected, a panel in the
  bottom-left lists one colour-coded chip per week that team has assignments
  for (W1–W5), each showing how many settlements are due that week. Every chip
  has its own checkbox, ticked by default: untick a week to hide its settlement
  shading, tick it again to bring it back — handy for isolating one week's
  outreach area without losing the others.

  ![Microplanning Map](images/screenshot_display.png)

### 5.5 Layers and point layers

Two cards sit at the top-right of the map. Click either header to collapse it —
and on a phone they *start* collapsed, because open they would cover most of
the map they exist to control.

**Layers**

- **Basemap** — switch the background tile style by clicking a swatch:
  *OSM Light*, *OSM Standard*, *OSM Dark*, *Satellite imagery*, or
  *No basemap*.
- **Visits** — *Visits in assigned area*, *Flagged visits*.
- **Context** — *Outreach settlements*, *Settlement boundaries*,
  *Organisation unit*.

The overlays are split into what you are *counting* and what you read those
counts *against*, because that is how the map is used in practice: you turn the
context off to see the points, not to see fewer layers.

**Point layers**

If the selected programme has more than one geo-tagged attribute or data
element, this card lists each one with the number of points it contributed, so
you can show them independently. **Hide all / Show all** at the foot toggles
the lot.

### 5.6 The tracked-entity profile (point popups)

**Hover** any point — flagged or not — and a preview card opens with who the
record is about, whether it falls inside or outside the assigned area, the
stage it came from, the organisation unit, and (for a flagged point) how far it
is from the nearest assigned settlement.

The name at the top is built **only from the person's own name attributes** —
`First name`, `Middle name`, `Surname` and `Last name`, matched exactly — and
joined in that order whatever order the form declares them in. Attributes with
a word attached, such as `Caregiver first name` or `Mother's surname`, are
deliberately ignored: titling a child's profile with their caregiver's name is
worse than showing no name at all. They are still listed in full under **Bio
data**; they just can't become the title.

If a programme has none of those four attributes, the card falls back to the
first attribute that identifies the entity without being somebody else's name
— a registration number or ID, for instance.

The card opens **beside the point, to whichever side has room** — normally to
its right, flipping to the left when the point is near the right edge — and is
nudged up or down so it is never cut off at the top or bottom of the screen. It
stays attached to its point as you pan and zoom.

**Click** the point to pin the card and see the **full profile**:

| Section | What's in it |
|---|---|
| **Bio data** | Every tracked-entity attribute, in the programme's own field order |
| **One section per program stage** | The stage's data elements — one block per visit, dated, so a repeated stage shows each of its events rather than a single flattened value |
| **Record details** | When the enrollment was made and last updated, its status, and who recorded it — what you need to chase a flagged point back to a person |

Sections are collapsible; the badge on each header shows how many fields carry
a value (or how many visits a stage has). Empty fields are hidden by default —
tick **Show empty fields** at the bottom to see the full form, including what
wasn't recorded. The point's coordinates are shown beside it.

The card fills in two passes. The bio data and any data columns you picked
appear **instantly**, because they come from the same analytics response the
map is already drawing. The complete stage history is then fetched for that one
entity and slots in underneath. If that second fetch fails (for example, you
don't have tracker read access to the record), the card says so and keeps
showing the analytics values rather than going blank.

Click the **✕**, press the point again, or click empty map to dismiss a pinned
card.

### 5.7 Viewing the underlying data

Click **View data** at the bottom of the map to open the table of analytics
rows behind the current selection. It stays disabled until a programme, org
unit, period and team are all selected.

The table opens as a **sheet across the bottom of the page**, above the map
rather than inside it, so a full row of columns is visible instead of the strip
that fitted in the map's frame. **Esc** closes it.

**Every row fetched for the current selection is in this table** — flagged and
not. The map is the narrower view of the two: a point is only drawn for a
record that carries a coordinate in a visible point layer, so the table's row
count is normally higher than the number of points on the map. Nothing is
filtered out by flag status.

The header has two rows: a **band** naming each section and the column names
beneath it. That is what keeps a wide table readable once you have added a
dozen data elements in **Data columns**. Sections run in this order:

1. **Bio data** — who the row is about. It leads, because it is what you read
   to recognise a record.
2. **One section per program stage**, in the programme's own stage order.
3. **Enrollment** — the row's org unit, dates and who recorded it. Last, and
   hidden by default, since it mostly repeats what the filters already say.

Coordinate fields are not a section of their own: a coordinate attribute sits
in **Bio data** and a coordinate data element sits in its stage, alongside the
other fields of the same form.

A column is shown once. If the same field reaches the table twice — a
programme that lists an attribute more than once, or a field you picked that
was already included — the repeat is dropped. Two stages that each have a field
of the same name are *not* duplicates and both are kept, under their own stage.

- **Sections** — the chips under the title show/hide a whole section's columns
  at once.
- **Search** — filters rows against every visible column.
- **Sort** — click a column's sort arrows; click again to reverse, a third time
  to clear.
- **Rows per page** — 25 up to 1,000, with paging at the foot. Long selections
  page rather than truncate.
- **CSV** — downloads the **whole fetched dataset**, not the view: every row
  (flagged and not, whatever the search box says) and every column (including
  sections you have hidden). Only the column order and the current sort carry
  over, so the file opens looking like the table it came from. Column headings
  are written as `Section · Column`.
- **Expand** — grows the sheet to nearly the full window height for a long
  read, and back again.

Up to **20,000 rows** are fetched for one selection, in pages, behind the
scenes. If a selection is bigger than that, the subtitle says *capped* — narrow
the period or pick a lower-level organisation unit to see the rest.

### 5.8 On a phone or tablet

The whole app works at phone width; the map page rearranges rather than
shrinking:

| On a wide screen | On a phone |
|---|---|
| Filter controls sit on one row | Each takes the full width and they stack, in the same order |
| Settlement search sits in the app bar | Moves to its own full-width row under the tabs |
| Layer cards open at the top-right | Start collapsed — tap a header to open one |
| Summary counts wrap onto a second row | Scroll sideways as one strip, so the map stays above the fold |
| Profile card opens beside the point | Slides up from the bottom as a sheet |
| Data table opens as a bottom sheet | Same, using more of the height |
| Tabs all visible | Scroll sideways; the current tab stays highlighted |

The app bar drops its strapline and the account name on narrow screens — the
avatar still opens the same menu.

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
3. On the **Map**, pick the same programme and org unit — the rest of the
   filter bar appears once those two are set — then choose the period and a
   team, to see exactly which settlements they were assigned and which weeks
   they cover.
4. Read the **summary strip**: if *Flagged visits* is red, there are visits
   recorded outside the team's assigned area.
5. **Click a flagged point** to open the child's profile — bio data and every
   stage — and see how far outside the assigned area it was recorded. That is
   usually enough to tell a mis-typed GPS reading from a genuine
   out-of-catchment visit before you call the team.
6. Add the fields you need to check in bulk under **Data columns**, then open
   **View data** and download the CSV for follow-up.
7. Repeat per team, or clear the team filter to see flags across the whole
   org unit at once.
8. When you need the numbers outside the app — for a report, a review
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
| **View data** button stays disabled | It needs a programme, org unit, period, *and* a selected team all set at once. |
| Only the team, period and data-column filters are missing | They appear once a **programme** and an **organisation unit** are chosen — until then there is nothing for them to narrow. |
| A point's profile shows bio data but no stages | The full record is fetched from the tracker API when you click; if you lack tracker read access to it, the card says so and keeps the analytics values. Empty stages are also hidden — tick **Show empty fields**. |
| A data element I picked isn't in the table | Picks are per programme and are cleared when you switch programme. Check the chip row under the filter bar, and check the section isn't hidden by its chip above the table. |
| Data table says "capped" | The selection is larger than the 20,000-row fetch ceiling. Narrow the period or pick a lower-level organisation unit. |
| The table shows more rows than the map shows points | Expected. A point needs a coordinate in a visible point layer; a record without one is still a row. Check the **Point layers** card if you expect more points. |
| The CSV has columns I had hidden | Also expected — the CSV is the whole dataset, not the view. Hiding a section only tidies the screen. |
| A profile card or the data table looked cut off | Fixed — both now open over the page rather than inside the map frame. If a card still looks short, it is scrolling internally: the header and the **Show empty fields** footer stay put while the sections between them scroll. |
| On a phone, the layer cards seem to be missing | They start collapsed there so they don't cover the map. Tap **Layers** or **Point layers** to open one. |
| On a phone, I can't find the settlement search | It moves out of the app bar onto its own row directly under the tabs. |
| A profile card is titled with a caregiver's name | It shouldn't be — only `First name`, `Middle name`, `Surname` and `Last name` can title a card (§5.6). If you see a caregiver's name there, that attribute is probably named exactly one of those four; rename it in the DHIS2 **Maintenance** app. |
| A profile card shows an ID instead of a name | The programme has none of the four own-name attributes, or they are empty for this record. The card falls back to the first identifying attribute rather than borrowing a relative's name. |
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
- **Tracked entity** — the person a record is about (in immunisation, the
  child). One tracked entity has one set of bio-data attributes and many
  events, spread across the programme's stages. The map's point popup shows
  all of it — see §5.6.
- **Bio data** — the tracked-entity attributes: the fields that describe the
  person rather than a single visit. Always included in the table and the
  profile, whether or not you pick them.
- **Program stage** — one step of a programme's form (e.g. *Birth dose*,
  *6 Weeks*). Its data elements are grouped under its name everywhere they
  appear: the **Data columns** picker, the table's header band, and the
  profile's sections.
- **Dimension** — how DHIS2 analytics names a requestable field. An attribute
  is its own id; a stage data element is written `stageId.dataElementId`. The
  **Data columns** picker hides this, but it is what the request is built from.
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

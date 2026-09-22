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
separated at the far right — so the work tabs never shift position between
an administrator's screen and a field user's.

| Tab | What it's for |
|---|---|
| **Map** | The coverage map — filters, layers, flagged visits |
| **Create Microplan** | Build a microplan in the app, week by week, and send it for review (needs create or review rights) |
| **Manage Settlements** | Check every settlement's GPS and polygon, fill the gaps from a map or by hand, review the changes and sync them to the settlement register (needs a GPS authority) |
| **Manage Duplicates** | Find tracked entities registered more than once, compare their full profiles, merge them by hand and have the merges approved (needs a duplicates authority) |
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
| `F_CREATE_MICROPLAN` | Shows the **Create Microplan** tab and allows building, saving and submitting microplans |
| `F_APPROVE_MICROPLAN` | Shows the **Create Microplan** tab and allows reviewing submitted microplans — adding row notes, approving or sending back |
| `F_DELETE_MICROPLAN` | Shows the **Delete** button on the **Microplans** page |
| `F_DOWNLOAD_MICROPLAN` | Exporting analytics data as CSV or JSON from the **Export** page |
| `F_READ_GPS_MICROPLAN` | Seeing raw event coordinates and out-of-bounds flags on the map, and opening **Manage Settlements** read-only |
| `F_CREATE_GPS_MICROPLAN` | Shows **Manage Settlements** and allows adding or correcting settlement GPS and polygons, saving drafts and submitting them — in your data capture org units |
| `F_APPROVE_GPS_MICROPLAN` | Shows **Manage Settlements** and allows accepting or rejecting settlement GPS, adding review notes, approving or sending back, and syncing — in your data capture org units |
| `F_VIEW_GPS_ALL_MICROPLAN` | Seeing settlements outside your data capture org units — only while **Allow to view all GPS places** is on (§10.5) |
| `F_CREATE_GPS_ALL_MICROPLAN` | Editing settlements outside your data capture org units — only while **Allow to create all GPS places** is on |
| `F_APPROVE_GPS_ALL_MICROPLAN` | Reviewing settlements outside your data capture org units — only while **Allow to approve all GPS places** is on |
| `F_REVIEW_DUPLICATES_MICROPLAN` | Shows **Manage Duplicates** and allows viewing duplicate profiles and preparing merges for approval — in your data capture org units |
| `F_APPROVE_DUPLICATES_MICROPLAN` | Shows **Manage Duplicates** and allows accepting prepared merges (saving them to DHIS2 and deleting the duplicate) or rejecting them — in your data capture org units |
| `F_REVIEW_DUPLICATES_ALL_MICROPLAN` | Reviewing duplicates outside your data capture org units — only while **Allow to review all duplicates** is on (§10.6) |
| `F_APPROVE_DUPLICATES_ALL_MICROPLAN` | Approving merges outside your data capture org units — only while **Allow to create/approve all duplicates** is on |
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
   existing user roles and user groups from inside the app (see §10). The app
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

## 4. Creating a microplan (Create Microplan page)

Instead of preparing a spreadsheet and uploading it, you can build the
microplan directly in the app. Go to **Create Microplan** in the navigation
bar. The tab appears for anyone holding `F_CREATE_MICROPLAN` (to plan) or
`F_APPROVE_MICROPLAN` (to review), or `ALL`.

The page works like a spreadsheet: one row per facility and assigned person,
one column per week, and in every week cell a searchable list of the
settlements that facility's team can visit.

### 4.1 Choose what you're planning

The filter panel at the top reads as one sentence: *for this programme, in
this organisation unit, plan monthly (or quarterly, or yearly), for this
period.* All four are required.

| Filter | What it does |
|---|---|
| **Programme** | The DHIS2 program the outreach belongs to. Only facilities the programme is assigned to are listed. |
| **Organisation unit** | Where to plan — a State, LGA or ward. Every facility under it (with the programme) becomes part of the plan. |
| **Schedule** | **Monthly** gives one column per week. **Quarterly** gives one column per month of the quarter (3). **Yearly** gives one column per month of the year (12). |
| **Period** | Monthly: the current month and the next 12. Quarterly: the remaining quarters of the current year and all 4 of the next. Yearly: the current year and the next 5. Past periods can't be planned. |

Years and quarters follow the instance's **reporting cycle** — a calendar
year, or a financial year starting in April, July or October — which an
administrator sets in **Settings → Reporting cycle** (§10.4). For example, on
an April–March cycle, *FY 2026/27* runs from April 2026 to March 2027 and its
Q1 is April–June 2026. The period list is grouped under the reporting year
(and, for months, the quarter) each period belongs to, and a line under the
filters reminds you which cycle is in use. Months and weeks are the same
whichever cycle is chosen.

**Reset filters** (at the end of the filter row) clears the programme and
org unit and goes back to the current month. If you have unsaved edits, it
asks first.

There is exactly **one microplan per programme, organisation unit and
period**. Choosing the same three again always reopens the same plan — you
can't accidentally start a second copy.

### 4.2 Finding your microplans

Until the filters are complete, the page shows the **list of created
microplans**. With a plan open, press **All microplans** (top right, with the
number of plans) to get back to the list at any time; **← Back to …** returns
you to the plan you were on, unsaved edits intact.

The list is split into **Awaiting your review** (for reviewers), **Your
microplans** (ones you created or last saved) and **Other microplans**. Filter
it by status — **All**, **Draft**, **Awaiting review**, **Sent back**,
**Approved**, each with its count — or search by org unit, programme, period,
creator or reviewer. Click a card to open that plan; the plan you last had
open is outlined.

### 4.3 How weeks and months are worked out

On a **quarterly** or **yearly** plan the columns are simply the months of
the quarter or year, in reporting-cycle order — a yearly plan on a July cycle
starts with July and ends with June.

For a **monthly** plan, the columns are weeks:

Weeks run **Monday to Sunday**. A week that starts in one month and ends in
the next counts as **Week 1 of the later month** — so each week belongs to
the month its Sunday falls in. Most months therefore have 4 weeks; a month
with five Sundays has 5. For example, for **September 2026**:

| Week 1 | Week 2 | Week 3 | Week 4 |
|---|---|---|---|
| 31 Aug – 6 Sep | 7–13 Sep | 14–20 Sep | 21–27 Sep |

and 28 Sep – 4 Oct is Week 1 of October. Every day of the year is in exactly
one week of one month's plan, so nothing is planned twice or missed at a
month boundary. Each column header shows its date range.

### 4.4 The rows

The grid lists the **lowest-level org units the programme is assigned to**
under your selection — normally the health facilities. For each one:

- the org-unit levels between your selection and the facility (e.g. **LGA**,
  **Ward**) are shown as their own columns, so you can sort out which ward a
  facility belongs to at a glance;
- **Assigned to** shows the DHIS2 user(s) whose data-capture org unit *is that
  facility*. Users assigned higher up (to the ward or LGA) are not listed. A
  facility with three users has three rows — one per person — so each person
  gets their own weekly settlements;
- a facility with nobody assigned still gets one row, marked **Unassigned**,
  so it can be planned (and its assignment fixed in DHIS2 later).

If someone is un-assigned from a facility after you have planned settlements
for them, their row is kept and marked **no longer assigned**, so planned work
isn't silently lost. When a previously *unassigned* facility gets a user, the
settlements planned on the Unassigned row move to that user's row.

Use the search box above the grid to find a facility, ward or person, and
tick **Rows with gaps only** to see just the rows that still have an empty
week. The strip above the grid shows how many facilities, rows and
settlements are in the plan, and what share of cells are filled in.

When there are many rows, the grid is split into pages. Choose **Rows per
page** (25, 50, 100, 250 or 500) at the bottom, and use the arrows to move
between pages.

### 4.5 Picking settlements in a week cell

Click a week cell (or move to it with the arrow keys and press **Enter**). A
panel opens beside the cell — on a phone it slides up from the bottom of the
screen — listing every settlement in the facility's **ward** (the level
directly above the facility).

- **Type to search.** Every word you type must appear in the settlement's
  name, ward, LGA or state; names that *start* with what you typed come
  first. Accents are ignored, so `oyo` finds *Ọ̀yọ́*. Search is instant even for
  very long lists.
- **Click a settlement, or press Enter**, to tick or untick it. Pick as many
  as you need; the cell shows the first two and a **+N** count.
- **Select all / Select matches** ticks everything currently listed (up to
  1,000 at a time); **Clear** empties the cell.
- A yellow **W2** tag next to a settlement means it is already planned for
  the same person in Week 2 — a hint, not a block.
- If a settlement is missing from the list, type its name and choose **Add
  "…" as a settlement not in the list**. It is saved with a **new** tag so it
  can be checked later.
- **Backspace** in an empty search box removes the last settlement you
  picked. **Esc** or **Done** closes the panel.

The settlement list comes from the national settlements service and is
looked up by the ward's **name** (a two-letter state prefix like `kn` and a
trailing "Ward" are ignored when matching). It is downloaded **once per ward**
and shared by every facility and every week in that ward, and the lists for
the wards on the page you're looking at are fetched in the background — so
the first cell you open is usually ready already.

In the grid, **arrow keys** move between cells like a spreadsheet, and the
facility column stays pinned on the left while you scroll across the weeks
(on tablets and larger screens).

### 4.6 Saving, submitting and review

A microplan moves through four states, shown as a coloured badge beside its
title:

| State | Who can change what |
|---|---|
| **Not started** / **Draft** | Planners (`F_CREATE_MICROPLAN`) edit the week cells and **Save draft** as often as they like. |
| **Awaiting review** | Read-only for planners. The assigned reviewer can write a **Review note** on any row, then **Approve** or **Send back**. |
| **Sent back** | Editable again for planners, with the reviewer's notes and comment shown. Make the changes and **Re-submit**. |
| **Approved** | Final and read-only for everyone. |

1. **Save draft** stores your work in the DHIS2 dataStore. Nothing is saved
   automatically — an amber *Unsaved changes* marker shows when you have
   edits, and the browser warns you if you try to close the tab. Switching
   to another app tab and back keeps your unsaved edits; choosing a
   different plan in the filters asks before discarding them.
2. **Submit for review** asks you to choose a **reviewer** (who needs
   `F_APPROVE_MICROPLAN`) and optionally add a message. It warns you if some
   cells are still empty, but lets you submit anyway. From here the plan is a
   snapshot: the reviewer sees exactly what you submitted, even if
   assignments change in DHIS2 afterwards.
3. The **reviewer** opens the plan (it's in their *Awaiting your review*
   list), adds a note to any row that needs attention in the **Review note**
   column — every other cell is read-only for them — and can **Save notes**
   along the way. Then:
   - **Approve** — optionally with a comment. The plan becomes final.
   - **Send back** — with a comment saying what needs to change (required).
     The plan returns to the planners in the **Sent back** state, with the
     row notes still visible, until it is re-submitted.

A superuser (`ALL`) can review any submitted plan, whoever the named reviewer
is.

If a colleague saved the same plan after you opened it, saving shows **Someone
else saved this microplan** and lets you either **Discard mine, load theirs**
or **Overwrite with mine** — the app never silently replaces someone else's
work.

### 4.7 Discarding

- **Discard changes** appears while you have unsaved edits. It throws them
  away and puts the grid back to the last saved version (or empty, if the
  plan has never been saved).
- **Discard microplan** permanently deletes a plan that is still a **Draft**
  or **Sent back** — every planned settlement, review note and its history,
  for everyone — after you confirm. You'll need `F_CREATE_MICROPLAN`. A plan
  that is awaiting review or approved can't be discarded. Choosing the same
  programme, org unit and period again afterwards starts a fresh, empty plan.

### 4.8 Downloading the plan as CSV

**CSV** downloads the **whole** plan — every row on every page, regardless of
the search box — with one column per org-unit level (all levels, from the
country down), the facility and its id, the assigned person and username, one
column per week (settlements separated by `;`, with the week's dates in the
header), the total number of distinct settlements for the row, the review
note, the period and the status. The file opens directly in Excel with
accented names intact.

### 4.9 Where created microplans are stored

Created microplans live in the same `microplan` dataStore namespace as
uploaded ones, under their own keys:

- `created-index` — the catalogue shown before you pick filters;
- `created:<programme>_<org unit>_<period>` — the full plan: its rows and
  selected settlements, review notes, reviewer, and a history of who saved,
  submitted, approved or sent it back, and when.

---

## 5. Managing settlements (Manage Settlements page)

**Manage Settlements** is where the settlement list itself is looked after.
Every settlement the settlement register (`ng_settlements`) holds for an org
unit is listed with its coordinates, polygon, source and estimated households,
and anything missing is called out. From each row you can see the settlement
on a map, add or correct its GPS, and — as a reviewer — accept or reject it.
Approved changes are queued and pushed to the register with **Sync**.

The tab appears if you hold any of `F_READ_GPS_MICROPLAN` (read-only),
`F_CREATE_GPS_MICROPLAN` (edit) or `F_APPROVE_GPS_MICROPLAN` (review), or
one of the `…_GPS_ALL_MICROPLAN` authorities. The chips at the top right of
the page say what you can do and where: **my org units** or **all org units**.

### 5.1 Choose an organisation unit

The filter bar has one control, **Organisation unit** — a state, LGA or ward
(a facility lists its ward's settlements). The register knows places by name,
so the app turns the org unit into the register's state / LGA / ward names;
the grey **Register filter** chip under the bar shows exactly which names it
used. Which DHIS2 level is a state, an LGA and a ward is set by an
administrator in **Settings → GPS places** (§10.5).

A whole state is tens of thousands of settlements; the page shows how many
rows have arrived while it loads. If the register has no exact match for the
org unit's name, the nearest wider area is listed instead and a blue note
says so.

### 5.2 Which settlements you can see and change

Everyone is limited to the settlements in their own **data capture org
units** (and everything below them) — separately for viewing, editing and
reviewing. Rows outside them are hidden, and a grey note says how many.

To work beyond that, a user needs **both**:

- the matching authority — `F_VIEW_GPS_ALL_MICROPLAN`,
  `F_CREATE_GPS_ALL_MICROPLAN` or `F_APPROVE_GPS_ALL_MICROPLAN`; **and**
- the matching switch turned on in **Settings → GPS places** — *Allow to
  view / create / approve all GPS places*.

Anyone allowed to edit or review everywhere can also see everywhere. This is
what makes **partial updates** work: a ward team edits and submits only its
ward, an LGA supervisor reviews only their LGA, and nobody's work overwrites
anyone else's.

### 5.3 The table

The table behaves like a spreadsheet. The header and the first two columns
(row number and settlement name) stay put while you scroll; click a column
header to sort, again to reverse, a third time to clear. Use **↑ / ↓**,
**Page Up / Page Down** and **Home / End** to move the highlighted row, and
**Enter** (or double-click) to open it on the map. Only the rows on screen
are drawn, so it stays smooth with hundreds of thousands of rows.

| Column | What it shows |
|---|---|
| **Settlement** | Name and register ID. An amber dot means an unsaved change. |
| **Status** | *Not edited*, **Draft**, **In review**, **Sent back**, **Approved** or **Rejected** (§5.6). |
| **Ward / LGA / State** | Where the register places it. |
| **Latitude / Longitude** | The coordinates. A proposed change is shown in amber with the current value struck through beneath. **Missing** means there is none; **Invalid** means the register holds a value that isn't a real coordinate. |
| **Polygon** | **Present**, **Missing**, or **New area** / **Removed** for a proposed change. |
| **Source** | Where the register's record came from (e.g. GRID3, DHIS2). |
| **Est. households** | The register's household estimate. |
| **GPS actions** | **Map** (view on map), **GPS** (add or correct), and ↶ (undo a proposed change). |
| **Review** | **Accept / Reject** for reviewers; the decision for everyone else. |
| **Review note** | The reviewer's note. Editable only by a reviewer while the row is in review. |
| **Last change** | Who changed it last, when, and how (typed in, picked on map, drawn on map, device location). |
| **Sync** | **Pending sync**, **Synced** or **Sync failed** once approved. |

Every cell except the review decision and the review note is read-only —
coordinates change only through the GPS dialogs.

Above the table, the chips filter the rows — **All**, **Missing GPS**,
**Missing polygon**, **Unsaved**, and each status — each with its count; the
search box matches settlement, ward, LGA, state or ID. Like a spreadsheet
filter, the rows are re-filtered when you change the filter or save, not on
every edit, so a settlement you have just fixed doesn't disappear from
*Missing GPS* under your cursor.

At the bottom, a status bar shows the rows in view, how many are missing GPS
and the total estimated households, beside **Rows per page** (25, 50, 100,
250, 500, 1,000, 5,000, 10,000 or 50,000) and the page controls. Large pages
are as smooth as small ones, because only the rows on screen are drawn.

### 5.4 Viewing a settlement on the map

**Map** opens the settlement on a map: its current point and polygon in
blue, any proposed change in amber, and the other settlements of the same
ward in grey for orientation. Hover over any point or polygon to see its
details — name, place, coordinates, polygon, households, source and status —
and click to pin the card. Switch between **Streets**, **Satellite** and
**Dark** basemaps; **My location** centres the map on your device. The
pointer's coordinates are always shown at the bottom right.

### 5.5 Adding or correcting GPS

Press **GPS** on a row (you need edit rights for that settlement, and the row
must be editable — see §5.6) and choose:

- **Pick on map** — opens the map in picking mode with three tools:
  - **Point** (the default) — click to place the settlement's point, then
    drag the amber marker to fine-tune it;
  - **Draw area** — press and drag to draw the settlement's outline freehand;
    releasing closes it. If there is no point yet, it is set to the area's
    centre; **Point to area centre** and **Remove area** adjust it afterwards;
  - **Pan** — move the map without placing anything.

  **Use my location** puts the point where your device is. Press **Use this
  location** to keep it.
- **Enter manually** — type the latitude and longitude in decimal degrees, or
  paste `lat, lon` into either box to fill both. A point outside Nigeria is
  flagged, and if the two numbers look swapped, one click swaps them back.

The change is *staged*: the row turns amber and the header counts your
unsaved changes. Press **Save** to keep your changes as a draft — you can
come back and change them as often as you like until you submit. **Discard**
throws away everything unsaved. ↶ on a row undoes its proposed change.
Unsaved changes survive switching tabs or org units, and the browser warns
you before you close the page with changes still unsaved.

### 5.6 Submitting, review and approval

| Status | Who can change it | What happens next |
|---|---|---|
| *Not edited* / **Draft** | Editors (`F_CREATE_GPS_MICROPLAN`) | **Submit** sends it for review |
| **In review** | Reviewers (`F_APPROVE_GPS_MICROPLAN`) — decision and note only | **Approve** or **Send back** |
| **Sent back** | Editors | Correct it, then **Submit** again |
| **Approved** / **Rejected** | Nobody, until synced | Joins the sync queue; editable again once synced |

**Submit** submits every draft (and sent-back row) *in the current view* —
filter to a ward first to submit just that ward. Submitted rows are
read-only for editors.

As a reviewer, for each row press **Accept** or **Reject** (press it again to
clear the decision). **Reject** asks what should happen to the GPS:

- **Maintain current GPS** — discard the proposed change and keep what the
  settlement has now;
- **Blank the GPS** — clear the latitude, longitude and polygon, so the
  settlement shows as missing GPS and can be captured again.

You can add a **review note** to any row in review. A reviewer can also
accept or reject a settlement nobody has edited — to confirm the register's
coordinates, or to blank a wrong one.

Then, for the rows in review *in the current view*:

- **Approve** — accepted and undecided rows are approved with their proposed
  GPS; rejected rows are closed as rejected, with the GPS blanked or kept as
  chosen. The dialog shows how many of each.
- **Send back** — the rows return to the editors, with your notes, until
  they are re-submitted. Tick **Only the rejected rows** to send back just
  those and approve the rest separately.

### 5.7 Syncing to the settlement register

Approved rows, and rejected rows whose GPS was blanked, wait in the sync
queue (**Pending sync**). Reviewers press **Sync** to send them to the
register's update endpoint. Every update carries its audit trail: who
created and last updated it and when, who submitted and approved it, and
`syncedAt` / `syncedBy`. Rows that fail stay in the queue as **Sync failed**
(hover the badge for the error) and are retried next time.

Until an administrator sets the endpoint in **Settings → GPS places**, Sync
explains that it isn't available yet; the updates stay safely queued in
DHIS2, and **Download queue (JSON)** gives you the exact payload that will be
sent.

### 5.8 Downloading the table as CSV

**CSV** downloads the **full table** — every settlement you can see for the
org unit, not just the page on screen. When a search or filter is active it
offers **Current view** as well. Each row has the register's values, any
proposed change (with the polygon as GeoJSON), status, review decision and
note, and every audit field.

### 5.9 Where the changes are stored

Changes are kept in the `microplan` dataStore namespace, one key per LGA:
`gps:<state>:<lga>`. Each settlement anyone has touched has one record there
with its original and proposed values, status, review decision and note, sync
state and history. Saving merges row by row, so two people working in the
same LGA don't overwrite each other; if someone saved the same settlement
after you loaded it, your change to that row is not saved, their version is
shown instead, and a message tells you how many rows that affected.

---

## 6. Managing duplicates (Manage Duplicates page)

**Manage Duplicates** finds tracked entities that were registered more than
once — the same child entered twice or three times, at different facilities
or on different days. For each group of matching records you either **retain**
the ones that turn out not to be duplicates, or **merge** the rest into one
record by hand. Nothing changes in DHIS2 until a second person, an approver,
accepts the merge.

The tab appears if you hold `F_REVIEW_DUPLICATES_MICROPLAN` (review, retain
and prepare merges), `F_APPROVE_DUPLICATES_MICROPLAN` (accept or reject
merges), or one of the `…_DUPLICATES_ALL_MICROPLAN` authorities. The chips at
the top right of the page say what you can do and where: **my org units** or
**all org units**.

### 6.1 How duplicates are found

Two tracked entities are duplicates when **every** attribute chosen by an
administrator in **Settings → Duplicates** (§10.6) has the same value on
both — for example first name + surname + date of birth. Values are compared
ignoring upper/lower case, accents and extra spaces, so `Jane  Doé` matches
`jane doe`. A record with any of those attributes empty is never matched.

All the records that share the same values form a **group** — two, three or
more. The oldest (first registered) record that hasn't been retained is the
**original**; every other record is listed as a duplicate of it. The
**Group** column shows how many records share the values.

The chip under the filter bar, **Matched on: …**, shows exactly which
attributes are being compared.

### 6.2 Choose a programme and an organisation unit, then scan

The filter bar has two controls: **Programme** (it starts on the one set in
Settings) and **Organisation unit**. Every tracked entity enrolled in the
programme and registered at the org unit or anywhere below it is compared.

Press **Scan for duplicates**. A state holds hundreds of thousands of
records, so the scan reads them a thousand at a time and shows how many it
has compared so far; **Cancel scan** stops it. The result is **kept on this
device**: the next time you open the same programme and org unit the list
appears straight away, with *Last scanned … by …* above the table. Press
**Rescan** when you want to pick up records entered since.

Decisions — retained records, merges waiting for approval, rejected merges,
completed merges — are shared through DHIS2 and appear for everyone, even on
a device that has never scanned, and they survive every rescan. A record you
retained is shown as **Retained** after the next scan; nobody has to review
it again.

### 6.3 Which duplicates you can see and work on

Everyone is limited to the duplicates registered in their own **data
capture org units** (and everything below them) — separately for reviewing
and for approving. Rows outside them are hidden, and a grey note says how
many.

To work beyond that, a user needs **both**:

- the matching authority — `F_REVIEW_DUPLICATES_ALL_MICROPLAN` or
  `F_APPROVE_DUPLICATES_ALL_MICROPLAN`; **and**
- the matching switch turned on in **Settings → Duplicates** — *Allow to
  review all duplicates* or *Allow to create/approve all duplicates*.

A merge deletes records, so preparing or approving one needs **every** record
of the group inside your scope. When a group spans org units you don't cover,
you can open it and look, and a note says why you can't merge it; you can
still **retain** the records that are yours. This is what makes **partial
updates** work: a ward team works its ward, an LGA supervisor approves only
their LGA, and each decision is saved record by record so nobody's work
overwrites anyone else's.

### 6.4 The table

The table behaves like a spreadsheet and stays smooth with hundreds of
thousands of rows: only the rows on screen are drawn. The header and the
first two columns (row number and record) stay put while you scroll
sideways; click a column header to sort, again to reverse, a third time to
clear.

| Column | What it shows |
|---|---|
| **Record** | The first matched values and the tracked entity ID |
| **Status** | *Detected*, *Awaiting approval*, *Kept as duplicate*, *Retained* or *Merged*; a red **!** means the last attempt failed (hover for why) |
| one column per matched attribute | The record's value; in orange underneath, the original's value where it is spelled differently |
| **Org unit** | Where the record was registered, with its **full hierarchy** underneath (country › state › LGA › ward …); hover for the whole line |
| **Registered · by** | When the record was registered and the DHIS2 user who registered it |
| **Updated · by** | When it was last changed and by whom |
| **Duplicate of** | The original's ID, registration date and (if different) org unit |
| **Group** | How many records share these values |
| **Actions** | 👤 every record of the group side by side; **Merge** / **Edit** / **Review** / **Audit**; **Retain** (or **Undo** on a retained row) |
| **Prepared by**, **Decided by**, **Note** | Who prepared the merge, who decided it (or retained the record) and when, and their note or the last error |

Above the table: **search** (names, IDs, org unit, registering or updating
user, reviewer), and status tabs with counts — *All*, *Detected*,
*Awaiting approval*, *Kept as duplicate*, *Retained*, *Merged* and *With
errors*. Below it: the row count, **Rows per page** (25 to 10,000) and the
page buttons.

Keyboard: **↑ ↓**, **Page Up/Down**, **Home/End** move the highlighted row;
**Enter** opens the merge, **Space** the profiles; double-click a row to open
the profiles.

### 6.5 Viewing the full profiles

The 👤 button opens **every record of the group side by side** — three
columns for a group of three. Each column shows the record's org unit with
its full hierarchy, when and by whom it was registered and last updated, its
enrollment, all **bio data** (attributes) and every **event** of the
programme, stage by stage. Values that differ from another record are
highlighted. Each record keeps the same colour here and in the merge
(original in blue, then amber, violet…). On a phone, switch between the
records with the tabs at the top. Tick **Show empty** to list attributes with
no value too. A record that has been merged away shows the snapshot stored
with the merge.

### 6.6 Retaining records that are not duplicates

Records can match on every attribute and still be different people — twins
born the same day, or a common name in the same village. After reviewing,
press **Retain** on the row (or **Retain — not a duplicate** on the record's
card in the merge), optionally with a note on why. The record:

- is left out of every merge of its group;
- is listed as **Retained** — not *Detected* — after every later scan, so
  nobody reviews it again;
- no longer counts as the original: if you retain the oldest record, the
  next one becomes the original.

**Undo** on a retained row lists it as a duplicate again. Retaining a record
that is part of a merge waiting for approval sets that merge aside (it shows
*Kept as duplicate* with a note); prepare it again without that record.

### 6.7 Merging (reviewers)

Press **Merge** on any row of the group (you need
`F_REVIEW_DUPLICATES_MICROPLAN` covering every record in it). All the records
are loaded and shown as cards, side by side:

1. **Keep this record** — choose the record that survives. Every other card
   turns red: *Marked for delete*. The original is preselected.
2. **Retain — not a duplicate** — set aside any record that turns out not to
   belong (§6.6). It is left out of the merge. If only one record is left,
   there is nothing to merge and **Save retained** just records the retained
   ones.
3. **Resolve the values.** Every field is listed with one column per record,
   in the records' colours. Where only one record has a value it is taken;
   where they agree nothing needs doing; where they **differ** (orange dot)
   click the value you want — or press **Edit** and type the correct value.
   **Set all differences to First (oldest) / Last (newest) / Kept record**
   does every conflict at once; **Only differences** hides the rest.
   - *Bio data* — the attributes.
   - *Enrollment* — enrollment and incident dates.
   - *Shared visits* — a stage that happens once is one visit; a repeatable
     stage is one visit per day. A visit several records share is merged value
     by value; if the kept record doesn't have it, it is created on the kept
     record.
4. **Visits only one record has** — visits of the records being removed are
   copied onto the kept record; untick any you don't want. The kept record's
   own visits stay as they are.
5. Press **Merge N into 1 & save for approval**. The merged result, the
   choices you made, the exact payload that will be sent, and a snapshot of
   **every record as it is now** are saved; the group's rows become
   *Awaiting approval*.

Warnings in the dialog tell you when records being removed are enrolled in
**other programmes** (those enrollments are deleted with them — merge them in
their own programme first), when a **unique attribute** is taken from a
record being removed (DHIS2 may refuse the save while that record still
holds it), and that relationships are not moved.

A merge waiting for approval can be changed with **Edit**; a rejected one
with **Prepare a new merge**.

### 6.8 Approving (approvers)

Press **Review** on an *Awaiting approval* row (you need
`F_APPROVE_DUPLICATES_MICROPLAN` covering every record in the group). The
preview shows the **kept** record, every record **marked for delete** and any
**retained** ones, with their org unit hierarchy and who registered and
updated them; how many values were resolved, records removed and visits
merged or copied; every resolved value; the exact **tracker payload**; and
the history. Add an optional note, then:

- **Accept & merge** — the app first checks that no record has changed or
  been retained since the merge was prepared (if one has, the button is
  disabled and you are asked to edit the merge). It then saves the kept
  record with
  `POST /api/tracker?async=false&importStrategy=CREATE_AND_UPDATE` and
  deletes each other record with
  `POST /api/tracker?async=false&importStrategy=DELETE`. The rows become
  *Merged*.
- **Reject · keep as duplicates** — nothing changes in DHIS2. The rows
  become *Kept as duplicate* and stay on the list for everyone without anyone
  having to scan again; a reviewer can prepare a different merge later.

If DHIS2 refuses the save, the reason is shown and stored on the rows
(*With errors*); nothing was changed. If the save worked but a delete failed,
accepting again skips the save and the records already deleted, and retries
only the rest.

**Accept N** / **Reject N** above the table decide every prepared merge in
the current view that you may approve — narrow it with the search, the status
tabs or the org unit first. Merges whose records changed or were retained are
skipped and marked with the error.

Deleting a tracked entity that has enrollments needs the DHIS2 cascade-delete
authority on your user role; without it the delete step fails with that
reason.

### 6.9 Downloading the table as CSV

**CSV** downloads the **full table** — every row you can see, not just the
page on screen. With a search or status filter active it offers **Current
view** too. Each row has the status, the matched values, the record's ID, org
unit and **full org unit hierarchy**, when and by whom it was registered and
last updated, the original and group size, the kept and removed records, who
prepared, decided or retained it and when, and the note or error.

### 6.10 Where decisions are stored (audit)

Decisions are kept in the `microplan` dataStore namespace, one key per
programme and org unit at the storage level set in Settings (default level
3): `dup:<programme>:<org unit>`. Each key holds:

- **merges** — one per group: the kept, removed and retained records, every
  resolved value, the payload, **full snapshots of every record as it was
  when the merge was prepared**, and a history of who prepared, edited,
  accepted, rejected and deleted what, and when. Accepted merges are never
  removed, so the original data of every merged record can always be
  recovered; a group merged again later gets a new record beside the old one.
- **retained records** — one per record: who retained it, when, and why.

Saving merges item by item: if someone saved the same merge or retained
record after you loaded it, yours is not saved and theirs is shown instead.

The scan result itself is kept only in your browser (IndexedDB) and never
written to DHIS2.

---

## 7. Managing uploaded microplans (Microplans page)

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

## 8. The Map page

This is the main working view. It reads top to bottom: a **filter bar** that
asks what you want to see, a **summary strip** of the resulting counts, and
then the map itself, with its layer cards at the top-right and the data table
waiting behind **View data** at the bottom.

Hovering or clicking any visit point opens that person's full profile — bio
data plus every program stage — without leaving the map. See §8.6.

Two things deliberately open **over the page rather than inside the map**: the
profile card and the data table. Both used to be drawn inside the map's frame,
which meant anything taller than the frame was simply cut off — and the part
that got cut was the data. They now float above it, so what you open is always
whole. §8.8 covers how both behave on a phone or tablet.

### 8.1 Filtering what you're looking at

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
   added to the data table and to each tracked entity's profile. See §8.2.

The controls all start from the **left edge** and wrap onto a second row as
the window narrows, so they read in order instead of drifting apart across a
wide screen. On a phone each control takes the full width and they stack in the
same order.

Under the bar, a row of **chips** restates what is currently selected —
programme, team, period, extra columns. Each chip has an **✕** that removes
just that one filter, which is quicker than reopening its dropdown; **Clear
all** resets everything.

### 8.2 Choosing extra data columns

The **Data columns** picker lists everything the selected programme collects,
grouped the way the programme itself is structured:

- **Bio data** — the tracked-entity attributes (name, sex, date of birth,
  caregiver, and so on).
- **One group per program stage** — that stage's data elements, named after
  the stage (e.g. *Birth dose*, *6 Weeks*, *10 Weeks*).

Tick a group's header to take all of its fields at once, or pick individual
fields; the search box matches names across every group. What you pick has two
effects:

- the fields become **columns in the data table** (§8.7), placed under a band
  carrying their group's name;
- the fields are **filled in on each entity's profile** (§8.6).

Two things are always included whether or not you pick them, so you never have
to: every **bio-data attribute**, and every attribute or data element that
holds a **coordinate** (those are what the map draws). Picking a coordinate
field does something slightly different — it narrows the map to just the
coordinate layers you picked, the same as unticking the others in the **Point
layers** card.

Keeping stage data elements opt-in is deliberate: a programme with a dozen
stages would otherwise turn every pan of the map into a several-hundred-column
query.

### 8.3 Searching settlements and wards

The search box in the top app bar (visible on the Map page) does a type-ahead
search across every settlement and ward available to the app — hundreds of
thousands of records, searched instantly because the index runs in a background
worker and is cached on your device. Start typing a name; matches drop down
beneath the field, each tagged **settlement** or **ward** and showing its
ward/state for context. On a phone the field moves to its own row under the
tabs, where it has the width a search box needs.

### 8.4 Reading the map

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

### 8.5 Layers and point layers

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

### 8.6 The tracked-entity profile (point popups)

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

### 8.7 Viewing the underlying data

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

### 8.8 On a phone or tablet

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

## 9. Exporting data (Export page)

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

### 9.1 Which endpoint your data actually comes from

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

### 9.2 Step 1 — choose a visualization

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

### 9.3 Step 2 — choose a date range

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

### 9.4 Step 3 — download the data

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

### 9.5 Step 4 — export the file

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

### 9.6 When a visualization can't be exported

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

## 10. Settings (administrators)

The **Settings** tab appears only for users holding `F_ADMIN_MICROPLAN` (or
`ALL`). It is where you decide who can use the app, without needing rights to
edit DHIS2 user roles themselves.

Everything on the page edits one draft. Nothing takes effect until you press
**Save settings**, and while you have unsaved edits a yellow strip says so;
**Discard changes** puts the draft back to what is stored.

### 10.1 What is stored, and where

Your choices are saved to the DHIS2 dataStore under the key
`microplan/settings`. That key holds six things:

- which microplan authorities each **user role** confers,
- which microplan authorities each **user group** confers,
- which **users** the app should treat as members of a user group,
- the **reporting cycle** used by Create Microplan (§10.4),
- the **GPS places** switches used by Manage Settlements (§10.5),
- the **Duplicates** attributes and switches used by Manage Duplicates (§10.6).

Because it lives in the dataStore rather than in DHIS2 metadata, saving here
never edits a user role, a user group, or a user account. It only tells *this
app* to grant extra access — see §2.1.

The foot of the page shows when the settings were last saved and by whom.

### 10.2 Role authorities

A grid of your DHIS2 user roles down the side and the microplan authorities
across the top. Tick a box to give holders of that role the authority.

Where a role **already** holds an authority in DHIS2 itself, the cell shows a
green **DHIS2** tag instead of a checkbox. There is nothing useful to change
there: the real authority already grants access, and un-ticking a box next to
it would look like it removed access when it couldn't. Roles holding `ALL` are
marked **Superuser** and show DHIS2 tags throughout.

Use the filter box above the grid to find a role by name in a long list.

### 10.3 User groups

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

### 10.4 Reporting cycle

Choose the month your reporting year starts in:

| Option | Year runs | Example year | Its Q1 |
|---|---|---|---|
| **Calendar year** (default) | January – December | 2026 | Jan–Mar 2026 |
| **Financial year from April** | April – March | FY 2026/27 | Apr–Jun 2026 |
| **Financial year from July** | July – June | FY 2026/27 | Jul–Sep 2026 |
| **Financial year from October** | October – September | FY 2026/27 | Oct–Dec 2026 |

Each option previews the current year and its four quarters. A financial year
is named by the two calendar years it spans, starting year first.

The choice drives the **Quarterly** and **Yearly** periods on the Create
Microplan page, and how its monthly list is grouped. Like every other
setting, it takes effect when you press **Save settings**. Changing it later
doesn't touch microplans already created — each keeps the period and columns
it was created with, and stays openable from the list.

### 10.5 GPS places

Settings for **Manage Settlements** (§5):

**Access beyond data capture org units** — three switches, each paired with
an authority. A user holding the authority goes beyond their data capture org
units only while its switch is on; turning a switch off suspends that access
for everyone without editing a single user role.

| Switch | Paired authority | Lets holders |
|---|---|---|
| **Allow to view all GPS places** | `F_VIEW_GPS_ALL_MICROPLAN` | see settlements anywhere |
| **Allow to create all GPS places** | `F_CREATE_GPS_ALL_MICROPLAN` | edit (and see) settlements anywhere |
| **Allow to approve all GPS places** | `F_APPROVE_GPS_ALL_MICROPLAN` | review, approve and sync (and see) settlements anywhere |

**Hierarchy levels** — which DHIS2 levels hold states, LGAs and wards
(defaults: 2, 3 and 4). The settlement register knows places by name, and
these levels are how an org unit — and each user's data capture org units —
are translated into those names.

**Sync endpoint** — the URL of the register's create/update/merge endpoint.
Leave it empty until that endpoint exists; approved updates wait in DHIS2 in
the meantime. Updates are POSTed as `{ "updates": [...] }`, 500 at a time.

### 10.6 Duplicates

Settings for **Manage Duplicates** (§6):

**Attributes for duplicate detection** — first choose the **Programme**
(Manage Duplicates opens on it, and its attributes are listed), then add the
attributes that identify a person from the list on the right. Two records are
duplicates only when **every** attribute in *Matched on* agrees, so a few
identifying attributes — names, date of birth, sex, a phone number — find
more real duplicates than a long list. The order is the order of the columns
on Manage Duplicates; use ↑ ↓ to change it. Changing the list starts a fresh
scan result (old scans were made on different attributes).

**Access beyond data capture org units** — two switches, each paired with
an authority, exactly like the GPS switches:

| Switch | Paired authority | Lets holders |
|---|---|---|
| **Allow to review all duplicates** | `F_REVIEW_DUPLICATES_ALL_MICROPLAN` | see duplicates and prepare merges anywhere |
| **Allow to create/approve all duplicates** | `F_APPROVE_DUPLICATES_ALL_MICROPLAN` | accept or reject merges (and see duplicates) anywhere |

**Storage level** — merge records are stored in one dataStore key per org
unit at this level (default 3), so reviewers in different areas never write
the same key. Changing it affects new records only.

### 10.7 Your access

A read-only summary of how your own access resolves: the account you're signed
in as, your user roles, the groups you count as a member of, and — for every
microplan authority — whether it came from a DHIS2 user role, from these
settings, or from superuser rights.

Check a change here on yourself before trusting it for everyone else. Granted
access appears as soon as the affected user reloads the app.

---

## 11. Typical workflow

1. **Plan** this round's microplan on **Create Microplan** — pick the
   programme, org unit and month, fill in each team's settlements week by
   week, and submit it; a reviewer approves it or sends it back. Or, if the
   plan already exists as a spreadsheet, **Upload** it (CSV/Excel), tagged
   with the right program, period, and org unit.
2. Keep the settlement list itself in shape on **Manage Settlements** —
   fill in missing GPS and polygons, have them reviewed, and sync them to
   the settlement register, so the settlements you plan against can be
   mapped.
3. Clean up the tracked-entity records on **Manage Duplicates** — scan the org
   unit, retain the records that aren't really duplicates, merge the children
   registered more than once, and have an approver accept the merges, so
   coverage isn't counted twice.
4. Go to **Microplans** and confirm it appears with the expected
   team/settlement counts, then click **Show on map**.
5. On the **Map**, pick the same programme and org unit — the rest of the
   filter bar appears once those two are set — then choose the period and a
   team, to see exactly which settlements they were assigned and which weeks
   they cover.
6. Read the **summary strip**: if *Flagged visits* is red, there are visits
   recorded outside the team's assigned area.
7. **Click a flagged point** to open the child's profile — bio data and every
   stage — and see how far outside the assigned area it was recorded. That is
   usually enough to tell a mis-typed GPS reading from a genuine
   out-of-catchment visit before you call the team.
8. Add the fields you need to check in bulk under **Data columns**, then open
   **View data** and download the CSV for follow-up.
9. Repeat per team, or clear the team filter to see flags across the whole
   org unit at once.
10. When you need the numbers outside the app — for a report, a review
   meeting, or further analysis — use **Export** to pull the matching saved
   visualization down as CSV or JSON for the same period: a pivot table for
   the aggregate picture, a line list for the individual records behind it.

---

## 12. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| No **Create Microplan** tab | You need `F_CREATE_MICROPLAN` or `F_APPROVE_MICROPLAN` (or `ALL`), from your DHIS2 user role or the app's Settings page. |
| Create Microplan says "No facilities to plan" | The programme isn't assigned to any org unit under your selection. Assign it to the facilities in the DHIS2 **Maintenance** app, or pick another org unit. |
| A facility shows **Unassigned** | No DHIS2 user has that facility as their data-capture org unit. Users assigned to the ward or LGA above it don't count. Fix it in the DHIS2 **Users** app; the planned settlements move to the new user's row. |
| A week cell says "No settlements found" | The settlements service has no ward with the same name as the facility's parent org unit. Check the spelling of the ward name in DHIS2 against the settlements list, or use **Add "…"** to type the settlements in by hand. |
| No **Manage Settlements** tab | You need one of `F_READ_GPS_MICROPLAN`, `F_CREATE_GPS_MICROPLAN` or `F_APPROVE_GPS_MICROPLAN` (or a `…_GPS_ALL_MICROPLAN` authority), from your DHIS2 user role or the app's Settings page. |
| Manage Settlements says "No settlements found" | The register has no state / LGA / ward with the same name as the org unit, or the hierarchy levels in **Settings → GPS places** don't match your hierarchy. Check the **Register filter** chip under the filter bar. |
| "…settlements outside your data capture org units are hidden" | Expected: you only see your own org units. An administrator can grant `F_VIEW_GPS_ALL_MICROPLAN` *and* turn on **Allow to view all GPS places**. |
| The **GPS** button on a row is greyed out | The row is in review, or approved and not yet synced, or outside the org units you may edit. Hover the button to see which. |
| No **Accept / Reject** on a row | You need `F_APPROVE_GPS_MICROPLAN` for that settlement's org unit, and the row must be in review (or not edited, or already synced). Drafts can't be reviewed until they are submitted. |
| **Submit** is greyed out | There is nothing to submit in the current view — no draft with a proposed change, and nothing sent back. Check your search and filter. |
| "…row(s) had been changed by someone else and were not saved" | A colleague saved the same settlement after you loaded it. Their version is now shown; redo your change on top of it if it's still needed. |
| **Sync now** is greyed out | The register's update endpoint isn't configured yet (**Settings → GPS places**). Updates stay queued; use **Download queue (JSON)** meanwhile. |
| A row shows **Sync failed** | The endpoint refused or couldn't be reached. Hover the badge for the error; the row stays in the queue and is sent again with the next **Sync**. |
| No **Manage Duplicates** tab | You need `F_REVIEW_DUPLICATES_MICROPLAN` or `F_APPROVE_DUPLICATES_MICROPLAN` (or an `…_DUPLICATES_ALL_MICROPLAN` authority), from your DHIS2 user role or the app's Settings page. |
| Manage Duplicates says "No attributes are set for duplicate detection" | An administrator hasn't chosen the attributes yet — **Settings → Duplicates**. |
| "…of the duplicate-detection attributes are not part of this programme" | The attributes in Settings belong to another programme, so no record here carries them. Pick the right programme, or change the attributes in Settings. |
| A scan finds nothing I know is a duplicate | Every matched attribute must agree, and records with any of them empty are skipped. Check the spelling on both records, or use fewer attributes. Also press **Rescan** — the list is the result of the last scan on this device. |
| **Merge** is greyed out | The record is outside the org units you may review, or you only hold the approve authority. |
| The merge dialog says I can view the group but not merge it | A record of the group is registered outside your data capture org units. Someone whose org units (or *…ALL* access) cover the whole group has to merge it; you can still **Retain** your own records. |
| A record I retained is back as *Detected* | Someone pressed **Undo** on it. The **Decided by** column and the note show who retained it last. |
| A merge I prepared now says *Kept as duplicate* with "…retained — prepare the merge again" | One of its records was retained after you prepared it. Open it and prepare the merge again without that record. |
| **Accept & merge** is greyed out | One of the records changed in DHIS2 after the merge was prepared, was deleted, or was retained since. Press **Edit merge** to prepare it again from the current data. |
| "DHIS2 refused the merged record: E1064 …" | A unique attribute value still belongs to the record being removed. Keep the other record instead, or type a corrected value, and prepare the merge again. |
| "Merged record saved; deleting … failed" | Usually a missing cascade-delete authority for tracked entities with enrollments. Ask an administrator, then press **Accept & merge** again — it only retries the deletes that didn't happen. |
| **Registered · by** says "unknown user" | The DHIS2 version or the record doesn't carry who registered it (older records, imports). |
| No **Quarterly** periods that match our financial year | The reporting cycle is still the calendar year. An administrator can change it in **Settings → Reporting cycle**. |
| The period list shows a "Selected" group | You opened a plan from the list whose period is no longer offered — it has started, or the reporting cycle changed since. It stays open and editable; new plans use the current cycle. |
| No **Discard microplan** button | The plan has never been saved (there is nothing to delete — use **Discard changes** or **Reset filters**), it is awaiting review or approved, or you don't hold `F_CREATE_MICROPLAN`. |
| Can't edit a microplan's cells | It has been submitted or approved. Only a plan that is a draft or has been sent back can be edited. |
| No **Approve** / **Send back** buttons | They appear only for the reviewer named when the plan was submitted (or a superuser), and only while it is awaiting review. The reviewer also needs `F_APPROVE_MICROPLAN`. |
| **Send back** stays greyed out | A comment explaining what needs to change is required. |
| "Someone else saved this microplan" | A colleague saved the same plan after you opened it. Load theirs to see their changes, or overwrite with yours if you're sure. |
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
| A profile card is titled with a caregiver's name | It shouldn't be — only `First name`, `Middle name`, `Surname` and `Last name` can title a card (§8.6). If you see a caregiver's name there, that attribute is probably named exactly one of those four; rename it in the DHIS2 **Maintenance** app. |
| A profile card shows an ID instead of a name | The programme has none of the four own-name attributes, or they are empty for this record. The card falls back to the first identifying attribute rather than borrowing a relative's name. |
| The **Export** page lists nothing | Check the count on the other group tab first — a line list is not in **Aggregated** and a pivot table is not in **Events / Line list**. If both are 0, nothing is shared with your DHIS2 user: save a favourite in Data Visualizer or Line Listing and share it with your user or user group. |
| **Export** button stays disabled | The download hasn't finished (or hasn't started). Run **Download data** first — the button turns on only when every chunk has arrived. |
| Export download says "No rows" | The visualization has no data for the range you chose. Widen the range, or switch back to **Pivot table period**. |
| "This visualization can't be exported" | It is a line list saved across several programs, or a tracked-entity line list with no entity type. See §9.6 — both are fixed by re-saving it in the Line Listing app. |
| A line-list export is missing a column you expect | The data element is probably in a program stage the saved visualization doesn't include. Open **Request details** in the summary panel to see exactly which dimensions were asked for. |
| A long export download seems stuck | Very large results take many chunks; the progress line shows the current chunk. If it genuinely stalls, **Cancel**, narrow the date range, and try again. |

---

## 13. Glossary

- **Microplan** — the uploaded file describing which team visits which
  settlements, and in which weeks, for a given activity/program and period.
- **Created microplan** — a microplan built on the **Create Microplan**
  page rather than uploaded: one per programme, org unit and period, with a
  Draft → Awaiting review → Approved (or Sent back) workflow.
- **Reporting cycle** — the month the reporting (financial) year starts in:
  January (calendar year), April, July or October. Set in Settings; used for
  quarterly and yearly microplans.
- **Plan week** — a Monday–Sunday week, counted in the month its Sunday falls
  in; a week that straddles two months is Week 1 of the later one.
- **Settlement register** — the national settlement list (`ng_settlements`)
  that Manage Settlements reads from and, through **Sync**, writes back to.
- **Data capture org unit** — an org unit assigned to your DHIS2 user for
  data entry. Manage Settlements limits viewing, editing and reviewing to
  these (and everything below them) unless an administrator widens it.
- **Staged update** — a settlement GPS change saved in DHIS2 but not yet in
  the register: a draft, a submission in review, or an approved change
  waiting to sync.
- **Sync** — sending approved settlement updates, with their audit trail, to
  the register's update endpoint.
- **Duplicate** — a tracked entity whose duplicate-detection attributes all
  match an older record's (the **original**). Records that match form a
  **group**; merging keeps one record of the group and deletes the others
  once an approver accepts.
- **Retained** — a record a reviewer decided is not a duplicate. It is left
  out of merges and later scans show it as retained instead of listing it for
  review.
- **Kept as duplicate** — a merge an approver rejected. Nothing changed in
  DHIS2; the group stays listed for everyone so it doesn't have to be found
  again.
- **Reviewer** — the person chosen at submission to approve a created
  microplan or send it back. Needs `F_APPROVE_MICROPLAN`.
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
  all of it — see §8.6.
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
  uses to save uploaded and created microplans and its own access settings,
  shared across all users of the app.
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
  the event, enrollment, or tracked-entity analytics endpoints. §9.1 has the
  full mapping.
- **Program stage** — a step in a tracker program (e.g. "Birth", "Postnatal
  visit"). Data elements belong to a stage, which is why enrollment and
  tracked-entity line lists name the stage alongside the data element.
- **Chunk** — one page of an export download. The app asks DHIS2 for 500 rows
  at a time and stitches the chunks back together, so big tables download
  without timing out.

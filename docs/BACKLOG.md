# Backlog — captured 26 Aug 2026

Everything from Gyaan's list, verbatim in intent, grouped by what it costs.
Nothing here is done unless it says so. Items are checked against the code
before being started — four earlier roadmap items turned out to be already
built, so "missing" means verified missing.

## A · Hard failures (fix first)

| | What | Notes |
|---|---|---|
| A1 | `pdfjs-dist` worker crash in knowledge | `Cannot find module .../pdf.worker.mjs` — PDF ingest is dead |
| A2 | Cannot attach files in Read / research | |
| A3 | Debrief shows Tuesday's brief on Wednesday | Day-boundary bug; same class as the two already fixed |
| A4 | GitHub contribution matrix out of date | Doesn't match github.com |
| A5 | Calendar shows only part of the day | Should show the whole day |
| A6 | Gesture control not working | |

## B · Removals

| | What |
|---|---|
| B1 | Remove Forge entirely |
| B2 | Remove Holo Lab entirely |

## C · Map — "a fully functional gmap"

| | What |
|---|---|
| C1 | Zoom to current location, real-time |
| C2 | Ping / marker on current position |
| C3 | Weather trends around me |
| C4 | Saved places (gym, etc.) clearly visible |
| C5 | Route to the gym when it's gym time |
| C6 | Raise the zoom limit — more zoom than currently allowed |

## D · Screens

| | What |
|---|---|
| D1 | Agenda: visually differentiate days |
| D2 | YouTube block: pull from my saved playlist |
| D3 | Sitrep: four layers of update |
| D4 | Mail in morning block must match the Mail page exactly |
| D5 | Agent page: show past history |
| D6 | Agent page: cite where information came from |
| D7 | Eisenhower matrix: assign tasks to the correct quadrant automatically |
| D8 | Memory graph: hold everything |
| D9 | Health: more features and graphs |

## E · Code lab

| | What |
|---|---|
| E1 | Code and Push: proper indentation, IDE-like |
| E2 | Solutions default to Python, with a language picker |

## F · Portfolio

| | What |
|---|---|
| F1 | Pie charts |
| F2 | Timeline charts |
| F3 | Histograms |
| F4 | Distribution charts |
| F5 | Transaction entry — log a trade with full details |
| F6 | Link to portfolio from the main dashboard |

## G · Markets

| | What |
|---|---|
| G1 | Search bar covering everything searchable |
| G2 | Company lookup by name (e.g. TATA) |
| G3 | Company summary |
| G4 | Balance sheets and fundamentals |

## H · Settings

| | What |
|---|---|
| H1 | Add/remove API keys for Fish Audio, Cartesia, ElevenLabs, and the rest |
| H2 | Key rotation — required, not optional |

## Open questions for Gyaan

- **Maps**: real Google Maps needs a billed API key. Free alternatives
  (OpenStreetMap/MapLibre + OSRM routing) do most of it. Which?
- **Markets fundamentals**: balance sheets need a paid-ish data source.
  Alpha Vantage free is 25 req/**day**. Say the word and I'll wire whichever
  key you get.

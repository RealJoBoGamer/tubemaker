# TubeMaker – London Tube map builder

Build your own London Tube map in the browser, starting from a template traced from TfL's
[large print Tube map](https://content.tfl.gov.uk/large-print-tube-map.pdf) or from a blank canvas.
Export it as PNG or PDF, and upload it to a community gallery that runs on PHP + MySQL
(manageable entirely from phpMyAdmin).

The template includes every Tube line, the DLR, the Elizabeth line and the six London Overground
lines (Liberty, Lioness, Mildmay, Suffragette, Weaver, Windrush): 421 stations, interchange
connectors, fare zones and the River Thames, laid out schematically with every track running
horizontal, vertical or at 45°. **Thameslink, the London Cable
Car and London Trams are left out on purpose.**

## Features

- **Lines**: pick any TfL line (official colours), a community-shared preset, or make a custom
  line with any colour and style: solid, double/cased (Overground, DLR and Elizabeth line style),
  dashed, dotted or striped. You can reorder, hide, recolour and duplicate lines.
- **Drawing**: click stations in order to draw a line, click empty space to create stations as
  you go, and click a segment to add a station into it. Lines that share track are drawn side by
  side automatically.
- **45° layout**: tracks always run at 0°, 45° or 90° with rounded corners. New stations snap to
  45° rays from the previous one (hold Alt to place freely), dragged stations snap into line with
  their neighbours, and **Map settings ▸ Straighten whole map to 45°** turns any map (or an old
  save) into a schematic. Each segment can be straight, a 45° elbow either way, or use bend points.
- **Key symbols**: interchange circles (added automatically where lines meet), internal
  interchange connectors and dotted walking links between stations, step-free access (to the
  platform or to the train), National Rail, airport, river services (less or more than 10
  minutes' walk), Victoria Coach Station and closed stations. There are also freely placed stamps
  for these and for toilets, car parks, cycle parking and fare-zone markers.
- **Key / legend**: built automatically from the lines and symbols you use. You can drag it and
  set it to 1 to 4 columns.
- **Fare zones**: shaded bands with editable corners, colours and labels, plus the River Thames
  with editable points.
- **Labels**: 8 preset positions, or drag them anywhere. Labels can run over several lines and
  come in four sizes.
- **Editing**: snap to grid, box-select (Shift+drag), multi-move, align, arrow-key nudge,
  undo/redo, autosave to the browser and keyboard shortcuts.
- **Export**: PNG (1×, 2×, 4×), PDF (A4 to A0, via jsPDF loaded from cdnjs), SVG, and a JSON map
  file you can open again later.
- **Community page**: upload with title, name and description; browse newest, most liked or
  most viewed; search; like; comment; download; and **remix** someone else's map in the editor.
  Uploaders can update or delete their own maps: a secret edit token is kept in their browser.

## Install (XAMPP / WAMP / MAMP / any Apache + PHP + MySQL host)

1. Copy this folder into your web root, e.g. `C:\xampp\htdocs\tubemaker` or `public_html/tubemaker`.
2. Open **phpMyAdmin** and set up the database:
   - **Local / full access:** go to **Import** and choose `database/schema.sql`. This creates the
     `tubemaker` database and all of its tables.
   - **Shared hosting** (the database is created for you in cPanel): select that database in
     phpMyAdmin, then **Import** `database/tables.sql`.
3. Edit `api/config.php` to match your MySQL host, database name, user and password. You can
   also set the `TUBEMAKER_DB_*` environment variables instead. Change `ip_salt` to any random
   string.
4. Visit `http://localhost/tubemaker/` to open the editor, and `community.html` for the gallery.

Requirements: PHP 8.0+ with `pdo_mysql`, plus MySQL 5.7+ or MariaDB 10.3+. The editor itself is
static HTML/JS, so building and exporting maps works without the backend. Only uploading and the
community page need PHP and MySQL.

Quick local test without Apache:

```bash
mysql -u root -p < database/schema.sql
TUBEMAKER_DB_USER=root TUBEMAKER_DB_PASS=secret php -S 127.0.0.1:8080
```

### Database tables (visible in phpMyAdmin)

| Table          | Purpose |
|----------------|---------|
| `maps`         | Uploaded maps: title, author, description, full editor JSON (`map_json`), PNG preview (`thumbnail` BLOB), likes, views, remix source, hashed edit token. Set `is_hidden = 1` to moderate a map. |
| `map_likes`    | One row per visitor per liked map (visitor IPs are stored only as salted hashes). |
| `map_comments` | Comments on maps. |
| `line_presets` | Custom line styles shared by users (name, colour, style, popularity). |

### API

`api/maps.php?action=…`: `list`, `get`, `comments`, `presets` (GET) and `create`, `update`,
`delete`, `like`, `comment`, `preset` (POST JSON). `api/thumb.php?id=…` serves previews. Limits
on upload size and rate (per visitor per hour) are set in `api/config.php`.

## Project layout

```
index.html            editor
community.html        community gallery
assets/js/
  template-data.js    generated London template (stations, labels, track curves, river)
  symbols.js          key symbols drawn as SVG
  doc.js              map document model, TfL presets, template builder
  render.js           SVG renderer (editor, exports, thumbnails)
  editor.js           editor UI and tools
  export.js           PNG / PDF / SVG / JSON export
  api.js, community.js
api/                  PHP backend (PDO + MySQL)
database/             schema.sql (with CREATE DATABASE) and tables.sql
tools/                template generator (Python)
```

## Regenerating the template

`tools/build_template.py` reads the TfL PDF. It finds every station label in the text layer,
finds the station marker where that station's line colours meet next to its label, and traces
each line's own pixels between stations. When the editor loads the template,
`TubeDoc.octilinearize()` (in `assets/js/doc.js`) straightens it: it nudges stations so tracks
run at exactly 0/45/90°, gives every other track one 45° bend, and steps tracks sideways where
they would otherwise run through a station they don't serve. Station lists and lines are
defined in `tools/lines_data.py`.

```bash
pip install numpy pillow scipy scikit-image
curl -LO https://content.tfl.gov.uk/large-print-tube-map.pdf
pdftotext -f 1 -l 1 -bbox large-print-tube-map.pdf words.html
pdftoppm  -f 1 -l 1 -r 72 -png large-print-tube-map.pdf map      # writes map-1.png
python3 tools/build_template.py words.html map-1.png assets/js/template-data.js
```

## Licence note

The Tube map design and the line colours belong to Transport for London. TfL lets people use
online maps for personal use only; commercial use needs a licence (see
[tfl.gov.uk/maplicensing](https://tfl.gov.uk/maplicensing)). TubeMaker is a fan tool and is not
affiliated with TfL.

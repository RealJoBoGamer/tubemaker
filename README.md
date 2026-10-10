# TubeMaker – London Tube map builder

Build your own London Tube map in the browser, starting from a template traced from TfL's
[large print Tube map](https://content.tfl.gov.uk/large-print-tube-map.pdf) or from a blank canvas.
Export it as PNG or PDF, and upload it to a community gallery that runs on PHP + MySQL
(manageable entirely from phpMyAdmin).

The template is a near 1:1 copy of TfL's map. It is built straight from the PDF's vector artwork,
so tracks, station markers, labels, fare-zone shading, the River Thames and the symbols all come
from TfL's own drawing. It includes every Tube line, the DLR, the Elizabeth line and the six London
Overground lines (Liberty, Lioness, Mildmay, Suffragette, Weaver, Windrush), with 421 stations.
**Thameslink, the London Cable Car and London Trams are left out on purpose.**

Station facts (NaPTAN id and fare zone) come from the official
[TfL Unified API](https://api.tfl.gov.uk), and the editor can look any station up live.

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
- **Official symbols**: the step-free, National Rail, airport, riverboat, pier and coach symbols
  are copied from TfL's own key artwork (`assets/js/tfl-symbols.js`).
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
3. Copy `api/config.sample.php` to `api/config.php` (if it isn't there already) and edit it to
   match your MySQL host, database name, user and password. You can also set the `TUBEMAKER_DB_*`
   environment variables instead. Change `ip_salt` to any random string. Without `config.php`
   the API falls back to the sample's defaults.
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

The template is rebuilt from TfL's PDF with three scripts in `tools/` (Python 3 with numpy, Pillow,
scipy and scikit-image, plus poppler-utils):

```bash
curl -LO https://content.tfl.gov.uk/large-print-tube-map.pdf
pdftotext  -f 1 -l 1 -bbox large-print-tube-map.pdf words.html
pdftocairo -f 1 -l 1 -svg  large-print-tube-map.pdf map.svg
python3 tools/fetch_tfl.py tools/tfl_stations.json                 # official station data (TfL API)
python3 tools/extract_symbols.py map.svg assets/js/tfl-symbols.js  # official key symbols
python3 tools/build_template.py words.html map.svg assets/js/template-data.js
```

How `build_template.py` works:
1. **Centrelines.** Each line colour's vector shapes are rendered alone at 4× and thinned to an
   exact centreline.
2. **Station order.** Stations are matched to TfL's stops by walking each line from end to end:
   its circles, step-free icons and ticks come in the same order as the station list.
3. **Station complexes.** Circles joined by bars, dotted walking links and river piers are read
   from the black outline shapes and the dot chains.
4. **Tracks.** Every line's own path is traced between stations and rebuilt as exact 0°, 45° and
   90° runs, so parallel lines keep TfL's spacing and stacking order.
5. **Labels.** Labels keep TfL's wording, wrapping, alignment and baselines. National Rail,
   airport, riverboat and coach symbols, and the white boxes for stations in two fare zones, are
   placed where TfL put them.

Station lists per line are in `tools/lines_data.py`.

## Fonts

- **Johnston100**, TfL's own typeface, is used first if it is installed on your computer. It is
  proprietary, so it is not included.
- **London Tube** (`assets/fonts/london-tube.ttf`, freeware from fontspace.com, see
  `London-Tube-info.txt`) is a close match for New Johnston and is the template's default.
- **Railway Sans** (SIL Open Font License) is the fallback.

## Licence note

The Tube map design and the line colours belong to Transport for London. TfL lets people use
online maps for personal use only; commercial use needs a licence (see
[tfl.gov.uk/maplicensing](https://tfl.gov.uk/maplicensing)). TubeMaker is a fan tool and is not
affiliated with TfL.

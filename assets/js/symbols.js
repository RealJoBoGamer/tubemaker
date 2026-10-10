/* Key symbols drawn as SVG snippets. Every function returns an SVG string
 * centred on (x, y). `s` is a scale factor (1 = map size). */
(function () {
  const NAVY = '#1c2c6b';
  const RED = '#dc241f';

  function wheelchair(x, y, s, color) {
    // simple ISO-style wheelchair figure inside a 14 unit circle
    return `<g transform="translate(${x},${y}) scale(${s})" fill="none" stroke="${color}" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="-0.6" cy="-4.4" r="1.25" fill="${color}" stroke="none"/>
      <path d="M-1.2,-2.4 L-0.9,1.1 L2.4,1.1 L3.6,4.1" stroke-width="1.5"/>
      <path d="M-0.9,-0.6 L1.8,-0.6" stroke-width="1.3"/>
      <path d="M-2.9,-0.4 A3.2,3.2 0 1 0 2.0,3.2" stroke-width="1.3"/>
    </g>`;
  }

  const SYMBOLS = {
    'interchange': {
      label: 'Interchange stations',
      draw: (x, y, s = 1) => `<circle cx="${x}" cy="${y}" r="${6.5 * s}" fill="#fff" stroke="#000" stroke-width="${2.4 * s}"/>`,
    },
    'internal-interchange': {
      label: 'Internal interchange',
      draw: (x, y, s = 1) => `<g><rect x="${x - 14 * s}" y="${y - 3.2 * s}" width="${28 * s}" height="${6.4 * s}" fill="#fff" stroke="#000" stroke-width="${2.4 * s}"/>
        <circle cx="${x - 14 * s}" cy="${y}" r="${6.5 * s}" fill="#fff" stroke="#000" stroke-width="${2.4 * s}"/>
        <circle cx="${x + 14 * s}" cy="${y}" r="${6.5 * s}" fill="#fff" stroke="#000" stroke-width="${2.4 * s}"/>
        <rect x="${x - 10 * s}" y="${y - 2 * s}" width="${20 * s}" height="${4 * s}" fill="#fff"/></g>`,
    },
    'walk': {
      label: 'Less than 10 minutes walk between stations',
      draw: (x, y, s = 1) => `<g><line x1="${x - 14 * s}" y1="${y}" x2="${x + 14 * s}" y2="${y}" stroke="#000" stroke-width="${3 * s}" stroke-dasharray="${2 * s} ${2.6 * s}"/>
        <circle cx="${x - 14 * s}" cy="${y}" r="${6.5 * s}" fill="#fff" stroke="#000" stroke-width="${2.4 * s}"/>
        <circle cx="${x + 14 * s}" cy="${y}" r="${6.5 * s}" fill="#fff" stroke="#000" stroke-width="${2.4 * s}"/></g>`,
    },
    'step-free-train': {
      label: 'Step-free access from street to train',
      draw: (x, y, s = 1) => `<g><circle cx="${x}" cy="${y}" r="${7 * s}" fill="${NAVY}"/>${wheelchair(x, y, s, '#fff')}</g>`,
    },
    'step-free-platform': {
      label: 'Step-free access from street to platform',
      draw: (x, y, s = 1) => `<g><circle cx="${x}" cy="${y}" r="${6.4 * s}" fill="#fff" stroke="${NAVY}" stroke-width="${1.3 * s}"/>${wheelchair(x, y, s * 0.92, NAVY)}</g>`,
    },
    'national-rail': {
      label: 'National Rail interchange',
      draw: (x, y, s = 1) => `<g transform="translate(${x - 8 * s},${y - 5 * s}) scale(${s * 0.66})" fill="none" stroke="${RED}" stroke-width="2.3" stroke-linejoin="miter">
        <path d="M0,4.5 H24 M24,4.5 L17,-1.5 M24,10.5 H0 M0,10.5 L7,16.5 M5,4.5 L19,10.5"/></g>`,
    },
    'airport': {
      label: 'Airport',
      draw: (x, y, s = 1) => `<g transform="translate(${x},${y}) scale(${s * 0.62}) rotate(-90)" fill="${NAVY}">
        <path d="M0,-11 C1.3,-11 1.6,-9.5 1.6,-8 L1.6,-3 L11,2.5 L11,5 L1.6,2 L1.6,7.5 L4.2,9.6 L4.2,11.4 L0,10.2 L-4.2,11.4 L-4.2,9.6 L-1.6,7.5 L-1.6,2 L-11,5 L-11,2.5 L-1.6,-3 L-1.6,-8 C-1.6,-9.5 -1.3,-11 0,-11 Z"/></g>`,
    },
    'river-near': {
      label: 'Less than 10 minutes walk to river services',
      draw: (x, y, s = 1) => `<g><circle cx="${x}" cy="${y}" r="${7 * s}" fill="#fff" stroke="${NAVY}" stroke-width="${1.2 * s}"/>
        <g transform="translate(${x},${y}) scale(${s})" fill="${NAVY}"><path d="M-5,0.5 H5 L3.2,3.2 H-3.6 Z"/><path d="M-3,0 V-2.6 H2.4 L3.6,0 Z"/><path d="M-5.5,4.6 Q-2.75,3.4 0,4.6 T5.5,4.6" fill="none" stroke="${NAVY}" stroke-width="0.9"/></g></g>`,
    },
    'river-far': {
      label: 'More than 10 minutes walk to river services',
      draw: (x, y, s = 1) => `<g transform="translate(${x},${y}) scale(${s})" fill="${NAVY}"><path d="M-5,0.5 H5 L3.2,3.2 H-3.6 Z"/><path d="M-3,0 V-2.6 H2.4 L3.6,0 Z"/></g>`,
    },
    'coach': {
      label: 'Victoria Coach Station',
      draw: (x, y, s = 1) => `<g transform="translate(${x},${y}) scale(${s})"><rect x="-9" y="-3.6" width="18" height="6.6" rx="1.6" fill="${NAVY}"/>
        <rect x="-7.5" y="-2.4" width="15" height="2.2" fill="#fff"/><circle cx="-5.5" cy="3.4" r="1.5" fill="#fff" stroke="${NAVY}" stroke-width="0.9"/><circle cx="5.5" cy="3.4" r="1.5" fill="#fff" stroke="${NAVY}" stroke-width="0.9"/></g>`,
    },
    'closed': {
      label: 'Station closed',
      draw: (x, y, s = 1) => `<g transform="translate(${x},${y}) scale(${s})"><circle r="6.5" fill="#fff" stroke="${RED}" stroke-width="2"/><path d="M-4.6,-4.6 L4.6,4.6" stroke="${RED}" stroke-width="2"/></g>`,
    },
    'outside-fare-zone': {
      label: 'Outside fare zones',
      draw: (x, y, s = 1) => `<rect x="${x - 12 * s}" y="${y - 6 * s}" width="${24 * s}" height="${12 * s}" fill="#e5ecf8"/>`,
    },
    'both-zones': {
      label: 'Station in both fare zones',
      draw: (x, y, s = 1) => `<g transform="translate(${x},${y}) scale(${s})"><rect x="-14" y="-9" width="28" height="18" fill="#fff" stroke="#d3d2d2" stroke-width="1.4"/>
        <text x="0" y="-1.2" text-anchor="middle" font-size="7" fill="${NAVY}" font-family="'London Tube', Railway, Arial, sans-serif">Moor</text>
        <text x="0" y="6" text-anchor="middle" font-size="7" fill="${NAVY}" font-family="'London Tube', Railway, Arial, sans-serif">Park</text></g>`,
    },
    'toilets': {
      label: 'Toilets',
      draw: (x, y, s = 1) => `<g><rect x="${x - 7 * s}" y="${y - 7 * s}" width="${14 * s}" height="${14 * s}" rx="${2 * s}" fill="${NAVY}"/><text x="${x}" y="${y + 3.6 * s}" text-anchor="middle" font-size="${9.5 * s}" font-weight="bold" fill="#fff" font-family="Arial, sans-serif">WC</text></g>`,
    },
    'car-park': {
      label: 'Car park',
      draw: (x, y, s = 1) => `<g><rect x="${x - 6.5 * s}" y="${y - 6.5 * s}" width="${13 * s}" height="${13 * s}" rx="${1.6 * s}" fill="#1d70b8"/><text x="${x}" y="${y + 4 * s}" text-anchor="middle" font-size="${11 * s}" font-weight="bold" fill="#fff" font-family="Arial, sans-serif">P</text></g>`,
    },
    'bike': {
      label: 'Cycle parking',
      draw: (x, y, s = 1) => `<g transform="translate(${x},${y}) scale(${s})" fill="none" stroke="${NAVY}" stroke-width="1.3"><circle cx="-4.6" cy="2" r="3.2"/><circle cx="4.6" cy="2" r="3.2"/><path d="M-4.6,2 L-1.5,-3 L3,-3 L4.6,2 M-1.5,-3 L0.5,2 L3,-3 M-2.6,-4.6 H-0.4"/></g>`,
    },
  };

  // Use TfL's own artwork (assets/js/tfl-symbols.js) where available. `fit` is the
  // size the symbol has at scale 1, matching the hand-drawn fallbacks above.
  const OFFICIAL = window.TFL_SYMBOLS || {};
  const FIT = {
    'step-free-train': 14, 'step-free-platform': 14, 'national-rail': 16, 'airport': 14,
    'river-near': 14, 'river-far': 10, 'coach': 18,
  };
  for (const [name, sym] of Object.entries(OFFICIAL)) {
    if (!SYMBOLS[name] || !FIT[name]) continue;
    const f = FIT[name] / Math.max(sym.w, 0.01);
    SYMBOLS[name].draw = (x, y, s = 1) => `<g transform="translate(${x},${y}) scale(${(s * f).toFixed(4)})">${sym.svg}</g>`;
    SYMBOLS[name].official = true;
  }

  window.TubeSymbols = { SYMBOLS, NAVY, RED, FIT };
})();

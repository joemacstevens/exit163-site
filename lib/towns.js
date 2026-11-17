// The 70 Bergen County municipalities, plus a county-wide bucket.
const BERGEN = [
  'Allendale', 'Alpine', 'Bergenfield', 'Bogota', 'Carlstadt', 'Cliffside Park', 'Closter', 'Cresskill',
  'Demarest', 'Dumont', 'East Rutherford', 'Edgewater', 'Elmwood Park', 'Emerson', 'Englewood',
  'Englewood Cliffs', 'Fair Lawn', 'Fairview', 'Fort Lee', 'Franklin Lakes', 'Garfield', 'Glen Rock',
  'Hackensack', 'Harrington Park', 'Hasbrouck Heights', 'Haworth', 'Hillsdale', 'Ho-Ho-Kus', 'Leonia',
  'Little Ferry', 'Lodi', 'Lyndhurst', 'Mahwah', 'Maywood', 'Midland Park', 'Montvale', 'Moonachie',
  'New Milford', 'North Arlington', 'Northvale', 'Norwood', 'Oakland', 'Old Tappan', 'Oradell',
  'Palisades Park', 'Paramus', 'Park Ridge', 'Ramsey', 'Ridgefield', 'Ridgefield Park', 'Ridgewood',
  'River Edge', 'River Vale', 'Rochelle Park', 'Rockleigh', 'Rutherford', 'Saddle Brook', 'Saddle River',
  'South Hackensack', 'Teaneck', 'Tenafly', 'Teterboro', 'Upper Saddle River', 'Waldwick', 'Wallington',
  'Washington Township', 'Westwood', 'Wood-Ridge', 'Woodcliff Lake', 'Wyckoff',
];

const slugify = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const TOWNS = [
  { slug: 'bergen-county', name: 'Bergen County (county-wide)' },
  ...BERGEN.map((name) => ({ slug: slugify(name), name })),
];

const BY_SLUG = new Map(TOWNS.map((t) => [t.slug, t]));

// Loose match: "ho ho kus", "Ridgewood NJ", "washington twp" -> slug, or null.
function resolveTown(input) {
  if (!input) return null;
  let s = slugify(String(input).replace(/\b(nj|new jersey|township|twp|borough|boro)\b/gi, ' '));
  if (s === 'bergen' || s === 'county' || s === 'bergen-county') return 'bergen-county';
  if (s === 'washington') return 'washington-township';
  if (BY_SLUG.has(s)) return s;
  const hit = TOWNS.find((t) => t.slug.replace(/-/g, '') === s.replace(/-/g, ''));
  return hit ? hit.slug : null;
}

// Approximate town-center coordinates [lat, lng], good to about half a mile. They are used only to
// rank results by closeness and to give a rough "about 15 minutes" drive estimate; never show them
// to anyone or treat them as an address.
const COORDS = {
  'allendale': [41.033, -74.133], 'alpine': [40.956, -73.931], 'bergenfield': [40.927, -73.997],
  'bogota': [40.876, -74.030], 'carlstadt': [40.838, -74.092], 'cliffside-park': [40.821, -73.988],
  'closter': [40.973, -73.961], 'cresskill': [40.941, -73.959], 'demarest': [40.957, -73.963],
  'dumont': [40.940, -73.997], 'east-rutherford': [40.826, -74.090], 'edgewater': [40.827, -73.975],
  'elmwood-park': [40.904, -74.118], 'emerson': [40.976, -74.026], 'englewood': [40.893, -73.973],
  'englewood-cliffs': [40.885, -73.952], 'fair-lawn': [40.940, -74.132], 'fairview': [40.812, -73.999],
  'fort-lee': [40.851, -73.970], 'franklin-lakes': [41.017, -74.206], 'garfield': [40.881, -74.113],
  'glen-rock': [40.963, -74.133], 'hackensack': [40.886, -74.043], 'harrington-park': [40.984, -73.980],
  'hasbrouck-heights': [40.858, -74.081], 'haworth': [40.961, -73.990], 'hillsdale': [41.003, -74.040],
  'ho-ho-kus': [40.996, -74.101], 'leonia': [40.861, -73.988], 'little-ferry': [40.853, -74.042],
  'lodi': [40.882, -74.083], 'lyndhurst': [40.812, -74.124], 'mahwah': [41.089, -74.144],
  'maywood': [40.903, -74.062], 'midland-park': [40.989, -74.141], 'montvale': [41.047, -74.023],
  'moonachie': [40.841, -74.045], 'new-milford': [40.935, -74.019], 'north-arlington': [40.788, -74.133],
  'northvale': [41.007, -73.949], 'norwood': [40.996, -73.962], 'oakland': [41.013, -74.264],
  'old-tappan': [41.011, -73.991], 'oradell': [40.959, -74.037], 'palisades-park': [40.848, -73.998],
  'paramus': [40.945, -74.075], 'park-ridge': [41.037, -74.041], 'ramsey': [41.057, -74.141],
  'ridgefield': [40.834, -74.009], 'ridgefield-park': [40.857, -74.022], 'ridgewood': [40.979, -74.117],
  'river-edge': [40.929, -74.040], 'river-vale': [40.995, -74.012], 'rochelle-park': [40.907, -74.075],
  'rockleigh': [41.001, -73.930], 'rutherford': [40.827, -74.107], 'saddle-brook': [40.899, -74.093],
  'saddle-river': [41.032, -74.102], 'south-hackensack': [40.866, -74.046], 'teaneck': [40.890, -74.012],
  'tenafly': [40.925, -73.963], 'teterboro': [40.860, -74.060], 'upper-saddle-river': [41.058, -74.099],
  'waldwick': [41.011, -74.118], 'wallington': [40.853, -74.114], 'washington-township': [40.988, -74.065],
  'westwood': [40.991, -74.033], 'wood-ridge': [40.846, -74.088], 'woodcliff-lake': [41.023, -74.066],
  'wyckoff': [41.009, -74.173],
};

// Straight-line miles between two town centers; null if either is unknown or county-wide.
function milesBetween(a, b) {
  const A = COORDS[a];
  const B = COORDS[b];
  if (!A || !B) return null;
  if (a === b) return 0;
  const dLat = (A[0] - B[0]) * 69.0;
  const dLng = (A[1] - B[1]) * 69.0 * Math.cos(((A[0] + B[0]) / 2) * Math.PI / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

// Rough drive time, rounded to 5 minutes: local roads for the first 5 miles, highway pace after
// that (Englewood to Mahwah comes out around 35). Same town reads as 5.
function driveMinutes(miles) {
  if (miles === null || miles === undefined) return null;
  const mins = 3 + Math.min(miles, 5) * 2.8 + Math.max(miles - 5, 0) * 1.6;
  return Math.max(5, Math.round(mins / 5) * 5);
}

// "Hackensack, Teaneck or Englewood" -> ['hackensack', 'teaneck', 'englewood'] (unknown names dropped).
function resolveTowns(input) {
  if (!input) return [];
  const parts = Array.isArray(input) ? input : String(input).split(/,|\/|\band\b|\bor\b|&/i);
  const slugs = parts.map((p) => resolveTown(p)).filter((s) => s && s !== 'bergen-county');
  return [...new Set(slugs)];
}

module.exports = { TOWNS, BY_SLUG, COORDS, slugify, resolveTown, resolveTowns, milesBetween, driveMinutes };

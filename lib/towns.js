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

module.exports = { TOWNS, BY_SLUG, slugify, resolveTown };

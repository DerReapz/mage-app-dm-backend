// Mirror of the player-app sheet schema, kept in sync by hand.
// Used by mergeSheet() to give the dashboard a safe shape even when
// older sheets are missing newer fields.

const mkSkills = (ks) => ks.map((k) => ({ label: k, spec: '', value: 0 }));
const mkFree   = (n)  => Array.from({ length: n }, () => ({ name: '', value: 0 }));
const mkSphere = ()   => ({ name: '', value: 0, descs: Array(5).fill('') });

export const DEFAULT_SHEET = {
  identity:     { name:'', concept:'', chronicle:'', ambition:'', desire:'', avatar:'', paradigm:'', tradition:'', tutor:'' },
  physical:     { Strength:1, Dexterity:1, Stamina:1 },
  social:       { Charisma:1, Manipulation:1, Composure:1 },
  mental:       { Intelligence:1, Wits:1, Resolve:1 },
  physSkills:   mkSkills(['Athletics','Brawl','Craft','Drive','Firearms','Larceny','Melee','Stealth','Survival']),
  socSkills:    mkSkills(['Animal Ken','Etiquette','Insight','Intimidation','Leadership','Performance','Persuasion','Streetwise','Subterfuge']),
  mentSkills:   mkSkills(['Academics','Awareness','Finance','Investigation','Medicine','Occult','Politics','Science','Technology']),
  chronicleTenets: Array(5).fill(''),
  touchstones:  Array(5).fill(''),
  tradTenets:   Array(5).fill(''),
  spheres:      Array(6).fill(null).map(mkSphere),
  health:       Array(15).fill(0),
  willpower:    Array(15).fill(0),
  arete:        Array(10).fill(false),
  quint:        Array(10).fill(false),
  paradox:      Array(10).fill(0),
  powerBonus:   '',
  areteReroll:  '',
  backgrounds:  mkFree(9),
  merits:       mkFree(7),
  flaws:        mkFree(7),
  noHaven:      false,
  havenRating:  0,
  havenName:    '',
  havenRows:    mkFree(4),
  havenMerits:  mkFree(8),
  havenFlaws:   mkFree(8),
  havenLocation:    '',
  havenDescription: '',
  gearCarried:    Array(8).fill(''),
  equipmentOwned: Array(8).fill(''),
  vehicles:       Array(6).fill(''),
  xpTotal:      '',
  xpSpent:      '',
  weapons:      Array(6).fill(null).map(() => ({ name: '', dmg: '' })),
  trueAge:      '', apparentAge: '', dob: '', awakening: '',
  appearance:   '', distFeatures: '', history: '', possessions: '', notes: '',
};

export const mergeSheet = (saved) => {
  if (!saved) return structuredClone(DEFAULT_SHEET);
  const d = structuredClone(DEFAULT_SHEET);
  return {
    ...d, ...saved,
    identity:    { ...d.identity,    ...saved.identity    },
    physical:    { ...d.physical,    ...saved.physical    },
    social:      { ...d.social,      ...saved.social      },
    mental:      { ...d.mental,      ...saved.mental      },
    physSkills:  saved.physSkills?.length  ? saved.physSkills  : d.physSkills,
    socSkills:   saved.socSkills?.length   ? saved.socSkills   : d.socSkills,
    mentSkills:  saved.mentSkills?.length  ? saved.mentSkills  : d.mentSkills,
    spheres:     saved.spheres?.length     ? saved.spheres     : d.spheres,
    backgrounds: saved.backgrounds?.length ? saved.backgrounds : d.backgrounds,
    merits:      saved.merits?.length      ? saved.merits      : d.merits,
    flaws:       saved.flaws?.length       ? saved.flaws       : d.flaws,
    havenRows:      saved.havenRows?.length      ? saved.havenRows      : d.havenRows,
    havenMerits:    saved.havenMerits?.length    ? saved.havenMerits    : d.havenMerits,
    havenFlaws:     saved.havenFlaws?.length     ? saved.havenFlaws     : d.havenFlaws,
    gearCarried:    saved.gearCarried?.length    ? saved.gearCarried    : d.gearCarried,
    equipmentOwned: saved.equipmentOwned?.length ? saved.equipmentOwned : d.equipmentOwned,
    vehicles:       saved.vehicles?.length       ? saved.vehicles       : d.vehicles,
    weapons:        saved.weapons?.length        ? saved.weapons        : d.weapons,
  };
};

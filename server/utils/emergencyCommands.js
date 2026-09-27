export const SUPPORTED_EMERGENCY_INTENTS = [
  'ACCIDENT',
  'MEDICAL_EMERGENCY',
  'FIRE',
  'FLOOD_DISASTER',
  'GENERAL_EMERGENCY',
  'CALL_EMERGENCY_HELPER',
  'NORMAL',
];

export const LEGACY_EMERGENCY_INTENTS = {
  MEDICAL: 'MEDICAL_EMERGENCY',
  BLOOD: 'MEDICAL_EMERGENCY',
  CALL_HELPER: 'CALL_EMERGENCY_HELPER',
  LOCATION_SHARE: 'GENERAL_EMERGENCY',
};

function normalizeEmergencyText(command) {
  return String(command || '')
    .normalize('NFKC')
    .toLocaleLowerCase('en-IN')
    .replace(/[_\-]+/g, ' ')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const intentPatterns = [
  {
    type: 'ACCIDENT',
    patterns: [
      /\baccident\b|\broad\s+accident\b|\baccident\s+hogya\b|\baccident\s+ho\s+gya\b|\baccident\s+ho\s+gaya\b|\baccident\s+hua\b|\bhit\b|\bcrash\b|\bfall\b|\broad\s+hit\b|\bghatna\b|\bmar gaya\b|\bghatna\b/,
      /\bkatl\b|\bghayal\b|\bzkha\b|\bjad\b|\bchot\b|\bbohot\s+chot\b|\bapda\b/,
    ],
  },
  {
    type: 'MEDICAL_EMERGENCY',
    patterns: [
      /\bmedical\s+emergency\b|\bdoctor\s+help\b|\bambulance\b|\bjaldi\s+ambulance\b|\bbehosh\b|\bunconscious\b|\bheart\s+attack\b|\bchest\s+pain\b|\bbreathing\s+problem\b|\bsaans\s+problem\b|\btabiyat\s+bahut\s+kharab\b|\bsevere\s+pain\b|\bseizure\b/,
      /\bimmediate\s+medical\s+help\b|\bmedicine\s+needed\b|\bmedical\b|\bdoctor\b|\bneed\s+doctor\b/,
    ],
  },
  {
    type: 'FIRE',
    patterns: [/\bfire\b|\baag\b|\bghar\s+mein\s+aag\b|\baag\s+lag\b|\bsmoke\b|\bflame\b|\bexplosion\b/],
  },
  {
    type: 'FLOOD_DISASTER',
    patterns: [/\bflood\b|\bbarish\b|\bwaterlogging\b|\bwater\s+logging\b|\bbahut\s+pani\b|\broad\s+flood\b|\bbadh\b|\bdisaster\b/],
  },
  {
    type: 'CALL_EMERGENCY_HELPER',
    patterns: [
      /\bcall\s+(my\s+)?helper\b|\bhelper\s+ko\s+call\b|\bcall\s+my\s+emergency\s+helper\b|\bmy\s+helper\b|\bmadad\s+ke\s+liye\s+call\b|\bcall\s+helper\b|\bhelper\s+call\b/,
      /\bhelp\s+me\s+call\b|\bcall\s+my\s+contact\b/,
    ],
  },
  {
    type: 'GENERAL_EMERGENCY',
    patterns: [
      /\bemergency\b|\bhelp\s+me\b|\bhelp\s+chahiye\b|\bmujhe\s+madad\b|\bmadad\s+chahiye\b|\bbachao\b|\bplease\s+help\b|\bhelp\s+please\b|\bsahayak\s+help\b|\bquick\s+help\b|\bcritical\b/,
    ],
  },
];

export function parseEmergencyCommand(command) {
  if (typeof command !== 'string' || !command.trim()) return null;
  const normalized = normalizeEmergencyText(command);
  if (!normalized) return null;
  if (/\b(i saw|saw|watch(?:ed)?|on youtube|news|heard about)\b/.test(normalized) && !/\b(happened to me|happened here|ho gaya|ho gya|hua hai|injured|help)\b/.test(normalized)) {
    return null;
  }

  const match = intentPatterns.find(({ patterns }) => patterns.some((pattern) => pattern.test(normalized)));
  if (!match) return null;

  return {
    intent: match.type,
    normalizedCommand: normalized,
  };
}

export function normalizeEmergencyIntent(intent) {
  if (!intent || typeof intent !== 'string') return null;
  const trimmed = intent.trim();
  if (SUPPORTED_EMERGENCY_INTENTS.includes(trimmed)) return trimmed;
  if (LEGACY_EMERGENCY_INTENTS[trimmed]) return LEGACY_EMERGENCY_INTENTS[trimmed];
  return null;
}

export function isEmergencyIntent(intent) {
  return Boolean(intent && normalizeEmergencyIntent(intent));
}

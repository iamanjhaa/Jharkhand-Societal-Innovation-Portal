const supportedTypes = [
  'ACCIDENT',
  'INJURY',
  'MEDICAL_EMERGENCY',
  'DANGER',
  'OTHER_CRITICAL_EMERGENCY',
  'FIRE',
  'FLOOD_DISASTER',
  'CALL_EMERGENCY_HELPER',
];

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('en-IN')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[_-]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const nonPersonalContext = /\b(what should|what do|what is|how do|how to|tell me|explain|prevention|i saw|i have seen|i witnessed|i heard about|news|report(?:ed)?|there was|someone|somebody|he|she|they|my (?:friend|brother|sister|father|mother|husband|wife|son|daughter|child|parent|relative|neighbor|neighbour|colleague)|another person)\b/;
const negatedOrSafe = /\b(?:i am not|i'm not|i was not|i wasn't|did not|didn't|never|no longer|i am safe|i'm safe|i feel safe|no emergency)\b/;
const personalAccident = /\b(?:i got (?:into )?(?:(?:an? )?accident)?|i had an accident|i met with an accident|i was in an accident|i'm in an accident|i am in an accident|my accident|mera accident|meri accident|mujhe accident|accident ho gaya|accident ho gya|accident hogaya|accident hogya|accident hua hai|accident hua|crash ho gaya|crash hogaya|ghatna mere saath|i (?:was )?(?:hit|hurt|injured)|i fell and (?:hurt|injured))\b/;
const personalInjury = /\b(?:i am|i'm|i feel|i got|i have|i'm badly|i am badly|mujhe|main)\b.{0,35}\b(?:injured|hurt|bleeding|bleed(?:ing)?|unconscious|behosh|ghayal|chot lagi|chot aayi)\b|\b(?:i am|i'm|i got)\s+(?:badly )?(?:injured|hurt|bleeding|unconscious)\b/;
const personalMedical = /\b(?:i need (?:emergency )?(?:medical )?help|i need an? ambulance|send an? ambulance|i'm having (?:a )?(?:heart attack|seizure)|i am having (?:a )?(?:heart attack|seizure)|i can't breathe|i cannot breathe|i am having trouble breathing|i'm having trouble breathing|mujhe ambulance chahiye|saans nahi aa rahi)\b/;
const personalDanger = /\b(?:help me now|i need emergency help|i need help now|please help me|bachao|mujhe bachao|madad karo|i am in danger|i'm in danger|i am trapped|i'm trapped|i am being attacked|i'm being attacked|someone is attacking me)\b/;
const personalFireOrFlood = /\b(?:my (?:house|home|building|area) (?:is|has) on fire|there is a fire in my (?:house|home|building)|mere ghar mein aag|my (?:house|home|village) is flooding|flood in my (?:house|home|village)|my home is flooded|i am trapped in (?:a )?flood)\b/;

function classify(normalized) {
  if (personalAccident.test(normalized)) return { emergencyType: 'ACCIDENT', confidence: 0.98 };
  if (personalInjury.test(normalized)) return { emergencyType: 'INJURY', confidence: 0.97 };
  if (personalMedical.test(normalized)) return { emergencyType: 'MEDICAL_EMERGENCY', confidence: 0.97 };
  if (personalDanger.test(normalized)) return { emergencyType: 'DANGER', confidence: 0.96 };
  if (personalFireOrFlood.test(normalized)) {
    return { emergencyType: /\bflood|flooded\b/.test(normalized) ? 'FLOOD_DISASTER' : 'FIRE', confidence: 0.96 };
  }

  const explicitHelperRequest = /\b(?:call|contact)\s+(?:my )?(?:emergency )?(?:helper|contact)\b|\bhelper ko call\b/.test(normalized);
  if (explicitHelperRequest && !nonPersonalContext.test(normalized) && !negatedOrSafe.test(normalized)) {
    return { emergencyType: 'CALL_EMERGENCY_HELPER', confidence: 0.94 };
  }

  const directDistress = /\b(?:help|madad|bachao|emergency|danger|fire|aag|flood|badh)\b/.test(normalized);
  const firstPerson = /\b(?:i|i'm|i am|me|my|mujhe|main|mera|meri|mere)\b/.test(normalized);
  const urgentSelfFireOrFlood = firstPerson && directDistress && /\b(?:fire|aag|flood|badh|trapped|danger)\b/.test(normalized);
  if (urgentSelfFireOrFlood && !nonPersonalContext.test(normalized) && !negatedOrSafe.test(normalized)) {
    return { emergencyType: /\bflood|badh\b/.test(normalized) ? 'FLOOD_DISASTER' : 'OTHER_CRITICAL_EMERGENCY', confidence: 0.9 };
  }
  return null;
}

export const SUPPORTED_EMERGENCY_INTENTS = supportedTypes;

export function parseEmergencyCommand(command) {
  if (typeof command !== 'string' || !command.trim()) return null;
  const normalized = normalizeText(command);
  if (!normalized || negatedOrSafe.test(normalized)) return null;
  if (nonPersonalContext.test(normalized)) return null;
  const match = classify(normalized);
  if (!match) return null;

  return {
    intent: 'EMERGENCY',
    emergencyType: match.emergencyType,
    userInDanger: true,
    urgency: 'CRITICAL',
    description: command.trim().slice(0, 500),
    confidence: match.confidence,
    normalizedCommand: normalized,
  };
}

export function normalizeEmergencyIntent(intent) {
  if (typeof intent !== 'string') return null;
  const normalized = intent.trim().toUpperCase();
  if (normalized === 'EMERGENCY') return normalized;
  if (supportedTypes.includes(normalized)) return normalized;
  if (normalized === 'MEDICAL' || normalized === 'BLOOD') return 'MEDICAL_EMERGENCY';
  if (normalized === 'CALL_HELPER') return 'CALL_EMERGENCY_HELPER';
  if (normalized === 'LOCATION_SHARE') return 'DANGER';
  return null;
}

export function isEmergencyIntent(intent) {
  return Boolean(normalizeEmergencyIntent(intent));
}

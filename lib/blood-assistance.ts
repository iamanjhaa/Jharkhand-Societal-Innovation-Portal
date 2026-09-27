export const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;
export const BLOOD_COMPONENTS = [
  "Whole Blood",
  "Packed Red Blood Cells",
  "PRBC",
  "Platelets",
  "SDP",
  "FFP",
  "Cryoprecipitate",
] as const;

export type BloodAssistanceIntent = {
  intent: "BLOOD_ASSISTANCE";
  isBloodRequest: true;
  bloodGroup: string | null;
  component?: string;
  units?: number;
  urgency: "urgent" | "normal";
  needsLocation: boolean;
  asksForBloodGroup: boolean;
  locationRequired: boolean;
};

function normalizeBloodGroup(value: string) {
  if (!value) return undefined;

  const compact = value
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9+-]/g, "");

  if (!compact) return undefined;

  const roots = ["AB", "A", "B", "O"];
  for (const root of roots) {
    if (!compact.startsWith(root)) continue;

    const remainder = compact.slice(root.length);
    if (remainder.includes("+")) return `${root}+` as typeof BLOOD_GROUPS[number];
    if (remainder.includes("-")) return `${root}-` as typeof BLOOD_GROUPS[number];
    if (/^(?:POS(?:ITIVE)?|PLUS|VE|P)$/i.test(remainder)) return `${root}+` as typeof BLOOD_GROUPS[number];
    if (/^(?:NEG(?:ATIVE)?|MINUS|N)$/i.test(remainder)) return `${root}-` as typeof BLOOD_GROUPS[number];
  }

  return undefined;
}

function parseBloodGroupCandidates(text: string) {
  const matches = [...text.matchAll(/(?:^|[^A-Z])((?:AB|A|B|O)\s*(?:\+\s*VE?|\-\s*VE?|\+|-|POSITIVE|NEGATIVE|POS|NEG|PLUS|MINUS|VE|P|N))(?![A-Z])/gi)];

  return matches
    .map((match) => normalizeBloodGroup(match[1]))
    .filter((group): group is typeof BLOOD_GROUPS[number] => Boolean(group))
    .filter((group, index, arr) => arr.indexOf(group) === index);
}

function parseUnits(text: string) {
  const explicit = text.match(/(\d+(?:\.\d+)?)\s*(?:unit|units|bottle|bottles|bag|bags)/i);
  if (explicit) return Number(explicit[1]);

  const hindiMatches = text.match(/(\d+(?:\.\d+)?)\s*(?:यूनिट|बोतल|बैग|गिलास)/i);
  if (hindiMatches) return Number(hindiMatches[1]);

  const words = text.match(/(?:need|require|requires?|chahiye|do|two|three|four|five|six|seven|eight|nine|ten)\s*(\d+|one|two|three|four|five|six|seven|eight|nine|ten)/i);
  if (words) {
    const value = words[1].toLowerCase();
    const map: Record<string, number> = {
      one: 1,
      two: 2,
      three: 3,
      four: 4,
      five: 5,
      six: 6,
      seven: 7,
      eight: 8,
      nine: 9,
      ten: 10,
    };
    return Number.isFinite(Number(value)) ? Number(value) : map[value] ?? undefined;
  }

  const simple = text.match(/\b(\d+)\b/);
  return simple ? Number(simple[1]) : undefined;
}

function detectComponent(text: string) {
  const normalized = text.toLowerCase();
  const lookup = [
    [/(whole\s*blood|full\s*blood|wb)/i, "Whole Blood"],
    [/(packed\s*red\s*blood\s*cells|packed\s*rbc|prbc|rbc\s*packed)/i, "Packed Red Blood Cells"],
    [/(platelets?|platlet)/i, "Platelets"],
    [/(sdp|single\s*donor\s*platelet)/i, "SDP"],
    [/(ffp|fresh\s*frozen\s*plasma)/i, "FFP"],
    [/(cryo|cryoprecipitate|cryo precipitate)/i, "Cryoprecipitate"],
    [/(prbc|packed red blood)/i, "Packed Red Blood Cells"],
    [/\bplasma\b/i, "FFP"],
  ] as const;

  for (const [regex, label] of lookup) {
    if (regex.test(normalized)) return label;
  }
  return undefined;
}

export function detectBloodAssistance(input: string): BloodAssistanceIntent | null {
  const text = input.trim();
  if (!text) return null;

  const normalized = text.toLowerCase();
  const bloodKeywords = /(blood|rakt|रक्त|ब्लड|platelets?|plasma|donor|blood bank|bloodbank|b\s*(?:positive|negative|pos|neg|\+|\-)|a\s*(?:positive|negative|pos|neg|\+|\-)|o\s*(?:positive|negative|pos|neg|\+|\-)|ab\s*(?:positive|negative|pos|neg|\+|\-))/i;
  if (!bloodKeywords.test(normalized)) {
    return null;
  }

  const bloodGroup = parseBloodGroupCandidates(text)[0] ?? null;
  const component = detectComponent(text);
  const units = parseUnits(text);
  const urgency = /(urgent|emergency|accident|immediate|asap|critical|jaldi|abhi|urgently|bahut\s*jaldi|accident\s*ho\s*gaya)/i.test(normalized) ? "urgent" : "normal";
  const needsLocation = /(?:near\s*me|nearby|near\s*my\s*location|blood\s*bank\s*near|mere\s*paas|mere\s*area|mere\s*aas\s*paas|kaha\s*hai|location|city)/i.test(normalized);
  const asksForBloodGroup = !bloodGroup;

  return {
    intent: "BLOOD_ASSISTANCE",
    isBloodRequest: true,
    bloodGroup,
    component,
    units,
    urgency,
    needsLocation,
    asksForBloodGroup,
    locationRequired: Boolean(bloodGroup),
  };
}

export type EmergencyType =
  | 'ACCIDENT'
  | 'INJURY'
  | 'MEDICAL_EMERGENCY'
  | 'DANGER'
  | 'OTHER_CRITICAL_EMERGENCY'
  | 'FIRE'
  | 'FLOOD_DISASTER'
  | 'CALL_EMERGENCY_HELPER';

export const SUPPORTED_EMERGENCY_INTENTS: EmergencyType[];
export function parseEmergencyCommand(command: string): {
  intent: 'EMERGENCY';
  emergencyType: EmergencyType;
  userInDanger: true;
  urgency: 'CRITICAL';
  description: string;
  confidence: number;
  normalizedCommand: string;
} | null;
export function normalizeEmergencyIntent(intent: unknown): EmergencyType | 'EMERGENCY' | null;
export function isEmergencyIntent(intent: unknown): boolean;

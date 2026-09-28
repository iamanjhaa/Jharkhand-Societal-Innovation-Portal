export function normalizePhoneNumber(value) {
  const input = String(value || '').trim();
  if (!input || input.length > 30 || !/^[+\d\s().-]+$/.test(input)) return null;
  let digits = input.replace(/\D/g, '');
  if (/^[6-9]\d{9}$/.test(digits)) digits = `91${digits}`;
  else if (/^0[6-9]\d{9}$/.test(digits)) digits = `91${digits.slice(1)}`;
  if (digits.length < 8 || digits.length > 15 || digits.startsWith('0')) return null;
  return `+${digits}`;
}

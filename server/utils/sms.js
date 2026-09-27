function getSmsConfiguration() {
  const provider = String(process.env.SMS_PROVIDER || '').trim().toLowerCase();
  if (provider !== 'twilio') return null;

  const accountId = String(process.env.SMS_ACCOUNT_ID || '').trim();
  const apiKey = String(process.env.SMS_API_KEY || '').trim();
  const apiSecret = String(process.env.SMS_API_SECRET || '').trim();
  const fromNumber = String(process.env.SMS_FROM_NUMBER || '').trim();
  if (!accountId || !apiKey || !apiSecret || !fromNumber) return null;
  return { accountId, apiKey, apiSecret, fromNumber };
}

export function isSmsConfigured() {
  return Boolean(getSmsConfiguration());
}

export async function sendEmergencySms({ to, body }) {
  const configuration = getSmsConfiguration();
  if (!configuration) return { sent: false, status: 'SMS_NOT_CONFIGURED' };

  const form = new URLSearchParams({ To: to, From: configuration.fromNumber, Body: body });
  const authorization = Buffer.from(`${configuration.apiKey}:${configuration.apiSecret}`).toString('base64');
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(configuration.accountId)}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${authorization}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form,
  });
  const responseText = await response.text();
  let data = {};
  try {
    data = responseText ? JSON.parse(responseText) : {};
  } catch {
    data = {};
  }
  if (!response.ok) {
    const error = new Error(data.message || `SMS provider returned HTTP ${response.status}`);
    error.providerStatus = response.status;
    throw error;
  }
  return { sent: true, status: 'SMS_REQUEST_ACCEPTED', providerMessageId: data.sid || null };
}

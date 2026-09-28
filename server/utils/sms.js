function getSmsConfiguration() {
  const provider = String(process.env.SMS_PROVIDER || '').trim().toLowerCase();
  if (provider !== 'twilio') return { error: 'SMS_PROVIDER must be set to twilio' };

  const accountId = String(process.env.SMS_ACCOUNT_ID || '').trim();
  const apiKey = String(process.env.SMS_API_KEY || '').trim();
  const apiSecret = String(process.env.SMS_API_SECRET || '').trim();
  const fromNumber = String(process.env.SMS_FROM_NUMBER || '').trim();
  if (!accountId || !apiKey || !apiSecret || !fromNumber) {
    return { error: 'Twilio SMS configuration is incomplete; set SMS_ACCOUNT_ID, SMS_API_KEY, SMS_API_SECRET, and SMS_FROM_NUMBER' };
  }
  if (!/^AC[a-f\d]{32}$/i.test(accountId) || !/^SK[a-f\d]{32}$/i.test(apiKey) || !/^\+[1-9]\d{7,14}$/.test(fromNumber)) {
    return { error: 'Twilio SMS configuration contains an invalid account ID, API key, or sender number' };
  }
  return { accountId, apiKey, apiSecret, fromNumber };
}

export function getSmsConfigurationStatus() {
  const provider = String(process.env.SMS_PROVIDER || '').trim();
  return {
    providerConfigured: provider === 'twilio',
    accountIdConfigured: Boolean(String(process.env.SMS_ACCOUNT_ID || '').trim()),
    apiKeyConfigured: Boolean(String(process.env.SMS_API_KEY || '').trim()),
    apiSecretConfigured: Boolean(String(process.env.SMS_API_SECRET || '').trim()),
    fromNumberConfigured: Boolean(String(process.env.SMS_FROM_NUMBER || '').trim()),
  };
}

export function isSmsConfigured() {
  const configuration = getSmsConfiguration();
  return !('error' in configuration) && String(process.env.SMS_PROVIDER || '').trim() === 'twilio';
}

export async function sendEmergencySms({ to, body }) {
  const configuration = getSmsConfiguration();
  if ('error' in configuration) {
    return { sent: false, status: 'SMS_NOT_CONFIGURED', errorCode: 'CONFIGURATION_MISSING' };
  }

  const form = new URLSearchParams({ To: to, From: configuration.fromNumber, Body: body });
  const authorization = Buffer.from(`${configuration.apiKey}:${configuration.apiSecret}`).toString('base64');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(configuration.accountId)}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${authorization}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form,
      signal: controller.signal,
    });
    const responseText = await response.text();
    let data = {};
    try {
      data = responseText ? JSON.parse(responseText) : {};
    } catch {
      data = {};
    }
    if (!response.ok) {
      const error = new Error('Twilio rejected the emergency SMS request');
      error.providerStatus = response.status;
      error.providerCode = typeof data.code === 'number' || typeof data.code === 'string' ? String(data.code).slice(0, 40) : null;
      throw error;
    }
    return { sent: true, status: 'SMS_REQUEST_ACCEPTED', providerMessageId: data.sid || null };
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutError = new Error('SMS provider request timed out');
      timeoutError.providerCode = 'TIMEOUT';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

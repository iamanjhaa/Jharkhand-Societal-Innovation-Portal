import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEmergencyCommand } from '../utils/emergencyCommands.js';
import { normalizePhoneNumber } from '../utils/phoneNumbers.js';
import { getSmsConfigurationStatus, isSmsConfigured, sendEmergencySms } from '../utils/sms.js';
import mongoose from 'mongoose';
import EmergencyHelper from '../models/EmergencyHelper.js';
import EmergencyRequest from '../models/EmergencyRequest.js';

test('personal emergency examples activate the emergency intent', () => {
  for (const phrase of [
    'I got accident',
    'Mera accident ho gaya',
    'I am injured',
    'I need emergency help',
    'Help, I met with an accident',
  ]) {
    const intent = parseEmergencyCommand(phrase);
    assert.equal(intent?.intent, 'EMERGENCY', phrase);
    assert.equal(intent?.userInDanger, true, phrase);
    assert.equal(intent?.urgency, 'CRITICAL', phrase);
  }
});

test('general discussion and third-party accident reports do not activate SOS', () => {
  for (const phrase of [
    'Hii',
    'Hamare area mein paani ki problem hai',
    'Road kharab hai',
    'There was an accident near my village yesterday',
    'I saw an accident on the road',
    'What is an accident?',
    'What should I do after an accident?',
    'Tell me about accident prevention',
    'My friend got into an accident',
    'My brother got into an accident',
    'He got into an accident',
    'There was an accident near my village yesterday',
    'I am safe, there was an accident yesterday',
  ]) {
    assert.equal(parseEmergencyCommand(phrase), null, phrase);
  }
});

test('emergency helper schema limits each contact priority to the five-contact maximum', async () => {
  const base = {
    citizen: new mongoose.Types.ObjectId(),
    name: 'Emergency contact',
    phone: '+919876543210',
  };
  await new EmergencyHelper({ ...base, priority: 5 }).validate();
  await assert.rejects(new EmergencyHelper({ ...base, priority: 6 }).validate(), (error) => error.name === 'ValidationError');
});

test('emergency session requires a six-hour expiry value and stores at most five contact results', async () => {
  const base = {
    citizen: new mongoose.Types.ObjectId(),
    type: 'ACCIDENT',
    command: 'I got accident',
    source: 'WEB',
    expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
  };
  await new EmergencyRequest(base).validate();
  const smsResult = {
    contactId: new mongoose.Types.ObjectId(),
    contactName: 'Emergency contact',
    phone: '+919876543210',
    status: 'pending',
  };
  const tooManyContacts = new EmergencyRequest({ ...base, smsResults: Array.from({ length: 6 }, () => smsResult) });
  await assert.rejects(tooManyContacts.validate(), (error) => error.name === 'ValidationError');
});

test('Indian ten-digit numbers are normalized while valid international numbers are preserved', () => {
  assert.equal(normalizePhoneNumber('9876543210'), '+919876543210');
  assert.equal(normalizePhoneNumber('0 98765 43210'), '+919876543210');
  assert.equal(normalizePhoneNumber('+1 (202) 555-0100'), '+12025550100');
  assert.equal(normalizePhoneNumber('12345'), null);
});

test('missing SMS configuration is reported without attempting delivery', async () => {
  const names = ['SMS_PROVIDER', 'SMS_ACCOUNT_ID', 'SMS_API_KEY', 'SMS_API_SECRET', 'SMS_FROM_NUMBER'];
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  try {
    for (const name of names) delete process.env[name];
    assert.equal(isSmsConfigured(), false);
    assert.deepEqual(getSmsConfigurationStatus(), {
      providerConfigured: false,
      accountIdConfigured: false,
      apiKeyConfigured: false,
      apiSecretConfigured: false,
      fromNumberConfigured: false,
    });
    const result = await sendEmergencySms({ to: '+919876543210', body: 'Emergency test' });
    assert.equal(result.sent, false);
    assert.equal(result.status, 'SMS_NOT_CONFIGURED');
  } finally {
    for (const name of names) {
      if (previous.get(name) === undefined) delete process.env[name];
      else process.env[name] = previous.get(name);
    }
  }
});

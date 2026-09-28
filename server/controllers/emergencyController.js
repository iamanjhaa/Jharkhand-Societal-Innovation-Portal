import { randomUUID } from 'node:crypto';
import EmergencyHelper from '../models/EmergencyHelper.js';
import EmergencyRequest from '../models/EmergencyRequest.js';
import User from '../models/User.js';
import { normalizeEmergencyIntent, parseEmergencyCommand } from '../utils/emergencyCommands.js';
import { createNotification } from '../utils/notifications.js';
import { normalizePhoneNumber } from '../utils/phoneNumbers.js';
import { getSmsConfigurationStatus, isSmsConfigured, sendEmergencySms } from '../utils/sms.js';

const SESSION_DURATION_MS = 6 * 60 * 60 * 1000;
const MAX_EMERGENCY_HELPERS = 5;

function isCitizen(req, res) {
  if (req.user.role !== 'citizen') {
    res.status(403).json({ success: false, message: 'Emergency mode is available only to citizen accounts' });
    return false;
  }
  return true;
}

async function reserveEmergencyHelperSlot(userId) {
  const existingCount = await EmergencyHelper.countDocuments({ citizen: userId });
  await User.updateOne(
    { _id: userId, emergencyHelperCount: { $exists: false } },
    { $set: { emergencyHelperCount: existingCount } },
  );
  const reservation = await User.updateOne(
    { _id: userId, emergencyHelperCount: { $lt: MAX_EMERGENCY_HELPERS } },
    { $inc: { emergencyHelperCount: 1 } },
  );
  return reservation.modifiedCount === 1;
}

async function releaseEmergencyHelperSlot(userId) {
  await User.updateOne(
    { _id: userId, emergencyHelperCount: { $gt: 0 } },
    { $inc: { emergencyHelperCount: -1 } },
  );
}

function sessionResponse(emergency) {
  const session = typeof emergency.toObject === 'function' ? emergency.toObject() : emergency;
  return {
    emergency: {
      id: session.publicId,
      type: session.type,
      status: session.status,
      description: session.description || session.command,
      latitude: session.latitude ?? null,
      longitude: session.longitude ?? null,
      locationTimestamp: session.locationTimestamp || null,
      triggeredAt: session.triggeredAt,
      expiresAt: session.expiresAt,
      resolvedAt: session.resolvedAt || null,
      contactsAlerted: session.contactsAlerted || 0,
      smsStatus: session.metadata?.smsStatus || ((session.smsResults || []).some((result) => result.errorCode === 'CONFIGURATION_MISSING') ? 'SMS_NOT_CONFIGURED' : 'COMPLETED'),
      smsResults: (session.smsResults || []).map((result) => ({
        contactName: result.contactName,
        status: result.status,
        sentAt: result.sentAt,
      })),
    },
    emergencyId: session.publicId,
    alertCount: session.contactsAlerted || 0,
    smsResults: (session.smsResults || []).map((result) => ({
      contactName: result.contactName,
      status: result.status,
      sentAt: result.sentAt,
    })),
  };
}

function parseLocation(body) {
  const latitude = body.latitude === undefined ? null : Number(body.latitude);
  const longitude = body.longitude === undefined ? null : Number(body.longitude);
  const accuracy = body.locationAccuracy === undefined ? null : Number(body.locationAccuracy);
  if (latitude === null && longitude === null) return { latitude: null, longitude: null, accuracy: null };
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return null;
  }
  return { latitude, longitude, accuracy: Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : null };
}

export async function getEmergencyHelpers(req, res, next) {
  try {
    if (!isCitizen(req, res)) return;
    const helpers = await EmergencyHelper.find({ citizen: req.user._id }).sort({ priority: 1, createdAt: 1 }).limit(MAX_EMERGENCY_HELPERS).lean();
    return res.json({ success: true, data: { enabled: Boolean(req.user.emergencyVoiceModeEnabled), helpers } });
  } catch (error) {
    return next(error);
  }
}

export async function createEmergencyHelper(req, res, next) {
  let reserved = false;
  try {
    if (!isCitizen(req, res)) return;
    const name = String(req.body.name || '').trim();
    const phone = normalizePhoneNumber(req.body.phone);
    if (!name || name.length > 80 || !phone) {
      return res.status(400).json({ success: false, message: 'A helper name and valid phone number are required' });
    }
    const existingHelpers = await EmergencyHelper.find({ citizen: req.user._id }).select('priority phone').lean();
    if (existingHelpers.some((helper) => normalizePhoneNumber(helper.phone) === phone)) {
      return res.status(409).json({ success: false, message: 'This helper phone number is already configured' });
    }
    reserved = await reserveEmergencyHelperSlot(req.user._id);
    if (!reserved) return res.status(400).json({ success: false, message: 'Maximum 5 emergency contacts allowed.' });
    const usedPriorities = new Set(existingHelpers.map((helper) => helper.priority));
    const priority = [1, 2, 3, 4, 5].find((slot) => !usedPriorities.has(slot)) || MAX_EMERGENCY_HELPERS;
    const helper = await EmergencyHelper.create({
      citizen: req.user._id,
      name,
      phone,
      relationship: String(req.body.relationship || '').trim().slice(0, 40),
      priority,
      enabled: req.body.enabled !== false,
      alertEnabled: req.body.alertEnabled !== false,
    });
    return res.status(201).json({ success: true, data: helper });
  } catch (error) {
    if (reserved) {
      try {
        await releaseEmergencyHelperSlot(req.user._id);
      } catch (releaseError) {
        return next(releaseError);
      }
    }
    if (error.code === 11000) return res.status(409).json({ success: false, message: 'This helper phone number is already configured' });
    return next(error);
  }
}

export async function updateEmergencyHelper(req, res, next) {
  try {
    if (!isCitizen(req, res)) return;
    const update = {};
    for (const field of ['name', 'relationship', 'enabled', 'alertEnabled']) {
      if (req.body[field] !== undefined) update[field] = req.body[field];
    }
    if (req.body.phone !== undefined) {
      update.phone = normalizePhoneNumber(req.body.phone);
    }
    if (req.body.phone !== undefined && !update.phone) {
      return res.status(400).json({ success: false, message: 'A valid phone number is required' });
    }
    if (typeof update.name === 'string') update.name = update.name.trim();
    if (typeof update.relationship === 'string') update.relationship = update.relationship.trim().slice(0, 40);
    if (update.name !== undefined && (!update.name || update.name.length > 80)) {
      return res.status(400).json({ success: false, message: 'A valid contact name is required' });
    }
    const helper = await EmergencyHelper.findOneAndUpdate(
      { _id: req.params.id, citizen: req.user._id },
      update,
      { new: true, runValidators: true },
    );
    if (!helper) return res.status(404).json({ success: false, message: 'Emergency helper not found' });
    return res.json({ success: true, data: helper });
  } catch (error) {
    return next(error);
  }
}

export async function deleteEmergencyHelper(req, res, next) {
  try {
    if (!isCitizen(req, res)) return;
    const helper = await EmergencyHelper.findOneAndDelete({ _id: req.params.id, citizen: req.user._id });
    if (!helper) return res.status(404).json({ success: false, message: 'Emergency helper not found' });
    await releaseEmergencyHelperSlot(req.user._id);
    return res.json({ success: true });
  } catch (error) {
    return next(error);
  }
}

export async function updateEmergencyMode(req, res, next) {
  try {
    if (!isCitizen(req, res)) return;
    const enabled = req.body.enabled;
    if (typeof enabled !== 'boolean') return res.status(400).json({ success: false, message: 'enabled must be a boolean' });
    await User.updateOne({ _id: req.user._id }, { emergencyVoiceModeEnabled: enabled });
    return res.json({ success: true, data: { enabled } });
  } catch (error) {
    return next(error);
  }
}

export async function createEmergencyRequest(req, res, next) {
  try {
    if (!isCitizen(req, res)) return;
    console.info('[EMERGENCY] request received');
    const command = String(req.body.transcript || req.body.command || '').trim();
    if (command.length > 500) return res.status(400).json({ success: false, message: 'Emergency description must be 500 characters or fewer' });
    const parsed = parseEmergencyCommand(command);
    if (!parsed) return res.status(400).json({ success: false, message: 'The command did not contain a clear emergency intent' });
    console.info('[EMERGENCY] personal emergency intent detected', { emergencyType: parsed.emergencyType });
    const requestedIntent = normalizeEmergencyIntent(req.body.intent);
    if (req.body.intent && requestedIntent && requestedIntent !== parsed.intent && requestedIntent !== parsed.emergencyType && requestedIntent !== 'EMERGENCY') {
      return res.status(400).json({ success: false, message: 'The emergency intent does not match the transcript' });
    }
    const location = parseLocation(req.body);
    if (!location) return res.status(400).json({ success: false, message: 'Location coordinates are invalid' });

    await EmergencyRequest.updateMany(
      { citizen: req.user._id, activeForCitizen: req.user._id, expiresAt: { $lte: new Date() } },
      { $set: { status: 'EXPIRED' }, $unset: { activeForCitizen: 1 } },
    );
    const currentEmergency = await EmergencyRequest.findOne({ citizen: req.user._id, activeForCitizen: req.user._id });
    if (currentEmergency) {
      return res.status(200).json({ success: true, data: sessionResponse(currentEmergency), duplicate: true });
    }

    const recentEmergencyCount = await EmergencyRequest.countDocuments({
      citizen: req.user._id,
      createdAt: { $gte: new Date(Date.now() - 10 * 60_000) },
    });
    if (recentEmergencyCount >= 3) {
      return res.status(429).json({ success: false, message: 'An emergency was recently recorded. If you are still in danger, contact local emergency services now.' });
    }

    const helpers = await EmergencyHelper.find({ citizen: req.user._id, enabled: true, alertEnabled: true })
      .sort({ priority: 1, createdAt: 1 })
      .limit(MAX_EMERGENCY_HELPERS)
      .lean();
    const smsContacts = helpers.map((helper) => ({ ...helper, phone: normalizePhoneNumber(helper.phone) }));
    const startedAt = new Date();
    const expiresAt = new Date(startedAt.getTime() + SESSION_DURATION_MS);
    const emergencyId = randomUUID();
    const smsConfigured = isSmsConfigured();
    let emergency;
    try {
      emergency = await EmergencyRequest.create({
        publicId: emergencyId,
        activeForCitizen: req.user._id,
        citizen: req.user._id,
        type: parsed.emergencyType,
        command,
        description: parsed.description,
        source: req.body.source === 'ANDROID' ? 'ANDROID' : 'WEB',
        latitude: location.latitude,
        longitude: location.longitude,
        locationAccuracy: location.accuracy,
        locationTimestamp: location.latitude === null
          ? null
          : (req.body.locationTimestamp && Number.isFinite(Date.parse(req.body.locationTimestamp)) ? new Date(req.body.locationTimestamp) : new Date()),
        status: 'ALERTING',
        triggeredAt: startedAt,
        expiresAt,
        smsResults: smsContacts.map((helper) => ({
          contactId: helper._id,
          contactName: helper.name,
          phone: helper.phone || null,
          status: smsConfigured && helper.phone ? 'pending' : 'failed',
          provider: 'twilio',
          errorCode: !smsConfigured ? 'CONFIGURATION_MISSING' : helper.phone ? null : 'INVALID_CONTACT_PHONE',
        })),
        metadata: { normalizedCommand: parsed.normalizedCommand, confidence: parsed.confidence },
      });
    } catch (error) {
      if (error.code !== 11000) throw error;
      const activeEmergency = await EmergencyRequest.findOne({ citizen: req.user._id, activeForCitizen: req.user._id });
      if (activeEmergency) return res.status(200).json({ success: true, data: sessionResponse(activeEmergency), duplicate: true });
      throw error;
    }

    const locationText = location.latitude === null
      ? 'The citizen current location could not be retrieved.'
      : `Location: https://www.google.com/maps?q=${location.latitude},${location.longitude}`;
    const safeCitizenName = String(req.user.name || 'A citizen').replace(/[\r\n\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 80);
    const smsBody = [
      'SAHAYAK EMERGENCY ALERT',
      `${safeCitizenName} may need immediate assistance (${parsed.emergencyType.replace(/_/g, ' ').toLowerCase()}).`,
      locationText,
      'Please contact them immediately.',
      'Jharkhand Societal Innovation Portal',
    ].join('\n');
    console.info('[SMS] contact attempts starting', {
      activeContactCount: smsContacts.length,
      smsConfigured,
    });
    const smsResults = await Promise.all(smsContacts.map(async (helper, index) => {
      if (!smsConfigured) return { index, status: 'failed', errorCode: 'CONFIGURATION_MISSING' };
      if (!helper.phone) return { index, status: 'failed', errorCode: 'INVALID_CONTACT_PHONE' };
      try {
        console.info('[SMS] send started', { contactIndex: index + 1 });
        const result = await sendEmergencySms({ to: helper.phone, body: smsBody });
        console.info('[SMS] send result', { contactIndex: index + 1, status: result.sent ? 'accepted' : 'failed' });
        return {
          index,
          status: result.sent ? 'sent' : 'failed',
          providerMessageId: result.providerMessageId || null,
          sentAt: result.sent ? new Date() : null,
          errorCode: result.errorCode || null,
        };
      } catch (error) {
        console.error('[SMS] send result', {
          contactIndex: index + 1,
          status: 'failed',
          providerStatus: error.providerStatus || null,
          providerCode: error.providerCode || null,
        });
        return { index, status: 'failed', errorCode: error.providerCode || (error.providerStatus ? `HTTP_${error.providerStatus}` : 'PROVIDER_ERROR') };
      }
    }));
    for (const result of smsResults) {
      const sms = emergency.smsResults[result.index];
      sms.status = result.status;
      sms.providerMessageId = result.providerMessageId || null;
      sms.sentAt = result.sentAt || null;
      sms.errorCode = result.errorCode || null;
    }
    emergency.contactsAlerted = emergency.smsResults.filter((result) => result.status === 'sent').length;
    emergency.status = emergency.contactsAlerted > 0 ? 'HELPER_CONTACTED' : 'ALERTING';
    emergency.metadata = {
      ...(emergency.metadata || {}),
      alertDelivery: emergency.contactsAlerted ? 'SMS_REQUEST_ACCEPTED' : 'SMS_NOT_SENT',
      smsStatus: smsConfigured ? 'COMPLETED' : 'SMS_NOT_CONFIGURED',
    };
    await emergency.save();
    console.info('[EMERGENCY] session created', {
      smsRequestsAccepted: emergency.contactsAlerted,
      smsRequestsFailed: emergency.smsResults.length - emergency.contactsAlerted,
      smsConfigured,
    });

    const emergencyData = sessionResponse(emergency);
    try {
      await createNotification({
        recipient: req.user._id,
        recipientRole: 'citizen',
        type: 'emergency',
        title: 'Sahayak Emergency Alert',
        message: `${parsed.emergencyType.replace(/_/g, ' ')} emergency recorded. Twilio accepted ${emergency.contactsAlerted} of ${helpers.length} active emergency alert SMS requests.`,
        relatedEntityType: 'EmergencyRequest',
        relatedEntityId: emergency._id,
        actor: req.user._id,
        actorRole: 'citizen',
        eventKey: `emergency:${emergency._id.toString()}`,
      });
    } catch (notificationError) {
      console.error('Emergency portal notification could not be saved', notificationError.name);
    }
    return res.status(201).json({
      success: true,
      data: emergencyData,
    });
  } catch (error) {
    return next(error);
  }
}

export function getSmsConfigurationDiagnostics(req, res) {
  const status = getSmsConfigurationStatus();
  return res.json({
    success: true,
    data: {
      providerConfigured: status.providerConfigured,
      accountIdConfigured: status.accountIdConfigured,
      apiKeyConfigured: status.apiKeyConfigured,
      apiSecretConfigured: status.apiSecretConfigured,
      fromNumberConfigured: status.fromNumberConfigured,
    },
  });
}

export async function getActiveEmergency(req, res, next) {
  try {
    if (!isCitizen(req, res)) return;
    const now = new Date();
    await EmergencyRequest.updateMany(
      { citizen: req.user._id, activeForCitizen: req.user._id, expiresAt: { $lte: now } },
      { $set: { status: 'EXPIRED' }, $unset: { activeForCitizen: 1 } },
    );
    const emergency = await EmergencyRequest.findOne({ citizen: req.user._id, activeForCitizen: req.user._id });
    return res.json({ success: true, data: emergency ? sessionResponse(emergency).emergency : null });
  } catch (error) {
    return next(error);
  }
}

export async function getMyEmergencyRequests(req, res, next) {
  try {
    if (!isCitizen(req, res)) return;
    const now = new Date();
    await EmergencyRequest.updateMany(
      { citizen: req.user._id, status: { $nin: ['RESOLVED', 'CANCELLED', 'EXPIRED'] }, expiresAt: { $lte: now } },
      { $set: { status: 'EXPIRED' }, $unset: { activeForCitizen: 1 } },
    );
    const requests = await EmergencyRequest.find({ citizen: req.user._id }).sort({ createdAt: -1 }).limit(50).lean();
    return res.json({ success: true, data: requests.map((request) => sessionResponse(request).emergency) });
  } catch (error) {
    return next(error);
  }
}

export async function resolveEmergencyRequest(req, res, next) {
  try {
    if (!isCitizen(req, res)) return;
    const emergency = await EmergencyRequest.findOneAndUpdate(
      { publicId: req.params.id, citizen: req.user._id, activeForCitizen: req.user._id, expiresAt: { $gt: new Date() } },
      { $set: { status: 'RESOLVED', resolvedAt: new Date() }, $unset: { activeForCitizen: 1 } },
      { new: true },
    );
    if (!emergency) return res.status(404).json({ success: false, message: 'Active emergency session not found' });
    return res.json({ success: true, data: sessionResponse(emergency).emergency });
  } catch (error) {
    return next(error);
  }
}

export async function cancelEmergencyRequest(req, res, next) {
  try {
    if (!isCitizen(req, res)) return;
    const emergency = await EmergencyRequest.findOneAndUpdate(
      { publicId: req.params.id, citizen: req.user._id, status: { $nin: ['RESOLVED', 'CANCELLED', 'EXPIRED'] } },
      { status: 'CANCELLED', cancelledAt: new Date(), $unset: { activeForCitizen: 1 } },
      { new: true },
    );
    if (!emergency) return res.status(404).json({ success: false, message: 'Active emergency request not found' });
    return res.json({ success: true, data: sessionResponse(emergency).emergency });
  } catch (error) {
    return next(error);
  }
}

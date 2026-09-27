import EmergencyHelper from '../models/EmergencyHelper.js';
import EmergencyRequest from '../models/EmergencyRequest.js';
import User from '../models/User.js';
import { normalizeEmergencyIntent, parseEmergencyCommand } from '../utils/emergencyCommands.js';
import { createNotification } from '../utils/notifications.js';
import { isSmsConfigured, sendEmergencySms } from '../utils/sms.js';

function isCitizen(req, res) {
  if (req.user.role !== 'citizen') {
    res.status(403).json({ success: false, message: 'Emergency mode is available only to citizen accounts' });
    return false;
  }
  return true;
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
    const helpers = await EmergencyHelper.find({ citizen: req.user._id }).sort({ priority: 1, createdAt: 1 }).lean();
    return res.json({ success: true, data: { enabled: Boolean(req.user.emergencyVoiceModeEnabled), helpers } });
  } catch (error) {
    return next(error);
  }
}

export async function createEmergencyHelper(req, res, next) {
  try {
    if (!isCitizen(req, res)) return;
    const name = String(req.body.name || '').trim();
    const phone = String(req.body.phone || '').trim();
    if (!name || !phone || !/^\+?[1-9][\d\s-]{6,18}$/.test(phone)) {
      return res.status(400).json({ success: false, message: 'A helper name and valid phone number are required' });
    }
    const highest = await EmergencyHelper.findOne({ citizen: req.user._id }).sort({ priority: -1 }).select('priority').lean();
    const helper = await EmergencyHelper.create({
      citizen: req.user._id,
      name,
      phone,
      priority: Math.min(20, Number(req.body.priority) || (highest?.priority || 0) + 1),
      enabled: req.body.enabled !== false,
      alertEnabled: req.body.alertEnabled !== false,
    });
    return res.status(201).json({ success: true, data: helper });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ success: false, message: 'This helper phone number is already configured' });
    return next(error);
  }
}

export async function updateEmergencyHelper(req, res, next) {
  try {
    if (!isCitizen(req, res)) return;
    const update = {};
    for (const field of ['name', 'phone', 'priority', 'enabled', 'alertEnabled']) {
      if (req.body[field] !== undefined) update[field] = req.body[field];
    }
    if (update.phone && !/^\+?[1-9][\d\s-]{6,18}$/.test(String(update.phone))) {
      return res.status(400).json({ success: false, message: 'A valid phone number is required' });
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
    if (!req.user.emergencyVoiceModeEnabled) {
      return res.status(409).json({ success: false, message: 'Enable Emergency Voice Mode before sending an emergency request' });
    }
    const command = String(req.body.transcript || req.body.command || '').trim();
    const parsed = parseEmergencyCommand(command);
    if (!parsed) return res.status(400).json({ success: false, message: 'The command did not contain a clear emergency intent' });
    const requestedIntent = normalizeEmergencyIntent(req.body.intent);
    if (req.body.intent && requestedIntent && requestedIntent !== parsed.intent) {
      return res.status(400).json({ success: false, message: 'The emergency intent does not match the transcript' });
    }
    const location = parseLocation(req.body);
    if (!location) return res.status(400).json({ success: false, message: 'Location coordinates are invalid' });

    const normalizedIntent = normalizeEmergencyIntent(parsed.intent) || parsed.intent;
    const duplicateSince = new Date(Date.now() - 60_000);
    const duplicate = await EmergencyRequest.findOne({
      citizen: req.user._id,
      type: normalizedIntent,
      command,
      createdAt: { $gte: duplicateSince },
    }).sort({ createdAt: -1 }).lean();
    if (duplicate) {
      return res.status(200).json({
        success: true,
        data: {
          emergency: duplicate,
          emergencyId: `EMG-${duplicate._id.toString().slice(-8).toUpperCase()}`,
          duplicate: true,
          alertDelivery: duplicate.metadata?.alertDelivery || 'DUPLICATE_IGNORED',
          smsStatus: duplicate.metadata?.smsStatus || 'DUPLICATE_IGNORED',
        },
      });
    }
    const emergency = await EmergencyRequest.create({
      citizen: req.user._id,
      type: normalizedIntent,
      command,
      source: req.body.source === 'ANDROID' ? 'ANDROID' : 'WEB',
      latitude: location.latitude,
      longitude: location.longitude,
      locationAccuracy: location.accuracy,
      locationTimestamp: location.latitude === null ? null : (req.body.locationTimestamp ? new Date(req.body.locationTimestamp) : new Date()),
      status: 'ALERTING',
      metadata: { normalizedCommand: parsed.normalizedCommand },
    });
    const helpers = await EmergencyHelper.find({ citizen: req.user._id, enabled: true }).sort({ priority: 1 }).lean();
    const alertHelpers = helpers.filter((helper) => helper.alertEnabled);
    const locationLink = location.latitude === null ? 'Location unavailable' : `https://maps.google.com/?q=${location.latitude},${location.longitude}`;
    const primaryHelper = helpers[0] || null;
    const emergencyId = `EMG-${emergency._id.toString().slice(-8).toUpperCase()}`;
    let smsStatus = alertHelpers.length ? (isSmsConfigured() ? 'PENDING' : 'SMS_NOT_CONFIGURED') : 'NO_ENABLED_HELPERS';
    let alertDelivery = smsStatus;
    if (primaryHelper && isSmsConfigured()) {
      const smsBody = [
        'SAHAYAK EMERGENCY ALERT',
        `Emergency: ${normalizedIntent}`,
        `Citizen: ${req.user.name}`,
        `Location: ${locationLink}`,
        `Emergency ID: ${emergencyId}`,
      ].join('\n');
      try {
        const smsResult = await sendEmergencySms({ to: primaryHelper.phone, body: smsBody });
        smsStatus = smsResult.status;
        alertDelivery = smsResult.sent ? 'SMS_REQUEST_ACCEPTED' : smsResult.status;
        emergency.status = smsResult.sent ? 'HELPER_CONTACTED' : 'ALERTING';
        emergency.metadata = {
          ...(emergency.metadata || {}),
          providerMessageId: smsResult.providerMessageId || null,
        };
      } catch (error) {
        smsStatus = 'SMS_PROVIDER_ERROR';
        alertDelivery = smsStatus;
        emergency.status = 'FAILED';
        emergency.metadata = { ...(emergency.metadata || {}), smsError: error.message };
      }
    } else {
      emergency.status = 'ALERTING';
    }
    emergency.metadata = {
      ...(emergency.metadata || {}),
      locationLink,
      alertDelivery,
      smsStatus,
    };
    await emergency.save();
    await createNotification({
      recipient: req.user._id,
      recipientRole: 'citizen',
      type: 'emergency',
      title: 'Sahayak Emergency Alert',
      message: `${normalizedIntent.replace(/_/g, ' ')} emergency recorded (${emergencyId}). ${smsStatus === 'SMS_REQUEST_ACCEPTED' ? 'Your emergency helper was notified by SMS.' : smsStatus === 'SMS_NOT_CONFIGURED' ? 'SMS service is not configured.' : primaryHelper ? 'Your helper could not be notified by SMS.' : 'No emergency helper is configured.'}`,
      relatedEntityType: 'EmergencyRequest',
      relatedEntityId: emergency._id,
      actor: req.user._id,
      actorRole: 'citizen',
      eventKey: `emergency:${emergency._id.toString()}`,
    });
    return res.status(201).json({
      success: true,
      data: {
        emergency,
        emergencyId,
        alertCount: smsStatus === 'SMS_REQUEST_ACCEPTED' ? 1 : 0,
        alertDelivery,
        smsStatus,
        callTarget: (normalizedIntent === 'ACCIDENT' || normalizedIntent === 'CALL_EMERGENCY_HELPER') && primaryHelper ? { name: primaryHelper.name, phone: primaryHelper.phone } : null,
      },
    });
  } catch (error) {
    return next(error);
  }
}

export async function getMyEmergencyRequests(req, res, next) {
  try {
    if (!isCitizen(req, res)) return;
    const requests = await EmergencyRequest.find({ citizen: req.user._id }).sort({ createdAt: -1 }).limit(50).lean();
    return res.json({ success: true, data: requests });
  } catch (error) {
    return next(error);
  }
}

export async function cancelEmergencyRequest(req, res, next) {
  try {
    if (!isCitizen(req, res)) return;
    const emergency = await EmergencyRequest.findOneAndUpdate(
      { _id: req.params.id, citizen: req.user._id, status: { $nin: ['RESOLVED', 'CANCELLED'] } },
      { status: 'CANCELLED', cancelledAt: new Date() },
      { new: true },
    );
    if (!emergency) return res.status(404).json({ success: false, message: 'Active emergency request not found' });
    return res.json({ success: true, data: emergency });
  } catch (error) {
    return next(error);
  }
}

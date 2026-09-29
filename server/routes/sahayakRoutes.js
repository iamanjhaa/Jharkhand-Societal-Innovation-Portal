import express from 'express';
import multer from 'multer';
import authMiddleware from '../middleware/authMiddleware.js';

const router = express.Router();
const audioUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function getSahayakApiUrl() {
  return (process.env.SAHAYAK_API_URL || 'http://localhost:8000').replace(/\/$/, '');
}

router.get('/status', authMiddleware, async (_req, res) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3_000);
  try {
    const response = await fetch(`${getSahayakApiUrl()}/health`, { signal: controller.signal });
    const data = await response.json();
    if (!response.ok || data.status !== 'ok' || data.providerConfigured !== true) {
      return res.status(503).json({ success: false, message: 'Sahayak AI service is unavailable' });
    }
    return res.json({ success: true, data: { available: true } });
  } catch (error) {
    console.error(`Sahayak health check failed: ${error.message}`);
    return res.status(503).json({ success: false, message: 'Sahayak AI service is unavailable' });
  } finally {
    clearTimeout(timeout);
  }
});

function normalizeBloodGroup(value) {
  if (typeof value !== 'string') return '';
  const normalized = value.toUpperCase().replace(/\s+/g, '');
  const match = normalized.match(/^(AB|A|B|O)(\+VE?|-VE?|\+|-|POSITIVE|NEGATIVE|POS|NEG|PLUS|MINUS|P|N)$/);
  if (!match) return '';
  return `${match[1]}${/^(?:\+|PLUS|POS|POSITIVE|P|\+VE|\+V)$/i.test(match[2]) ? '+' : '-'}`;
}

function extractBloodGroups(value, depth = 0) {
  if (depth > 4 || value == null) return [];
  if (typeof value === 'string') {
    return [...value.matchAll(/(?:^|[^A-Z])((?:AB|A|B|O)\s*(?:\+\s*VE?|\-\s*VE?|\+|-|POSITIVE|NEGATIVE|POS|NEG|PLUS|MINUS|P|N))(?![A-Z])/gi)]
      .map((match) => normalizeBloodGroup(match[1]))
      .filter(Boolean);
  }
  if (Array.isArray(value)) return value.flatMap((item) => extractBloodGroups(item, depth + 1));
  if (typeof value === 'object') return Object.values(value).flatMap((item) => extractBloodGroups(item, depth + 1));
  return [];
}

function parseProviderResponse(body) {
  let response = body;
  if (typeof response === 'string') {
    try {
      response = JSON.parse(response);
    } catch {
      throw new Error('malformed provider JSON');
    }
  }
  if (!response || typeof response !== 'object') throw new Error('malformed provider response');

  const payloadResponse = response.payload?.response;
  if (payloadResponse === undefined) return response;
  if (typeof payloadResponse === 'string') {
    try {
      return JSON.parse(payloadResponse);
    } catch {
      throw new Error('malformed provider payload');
    }
  }
  if (payloadResponse && typeof payloadResponse === 'object') return payloadResponse;
  throw new Error('empty provider payload');
}

function findProviderRows(value, depth = 0) {
  if (depth > 5 || value == null) return null;
  if (Array.isArray(value)) {
    const rows = value.filter((item) => item && typeof item === 'object' && !Array.isArray(item));
    return value.length === 0 || rows.length > 0 ? rows : null;
  }
  if (typeof value !== 'object') return null;
  for (const key of ['results', 'items', 'records', 'bloodBanks', 'bloodbanks', 'stock', 'data', 'response']) {
    if (value[key] !== undefined) {
      const rows = findProviderRows(value[key], depth + 1);
      if (rows) return rows;
    }
  }
  return null;
}

function optionalNumber(value) {
  if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function optionalText(value) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function availabilityForGroup(item, bloodGroup) {
  const availableGroups = [
    ...extractBloodGroups(item.available),
    ...extractBloodGroups(item.available_withQty),
  ];
  const unavailableGroups = [
    ...extractBloodGroups(item.not_available ?? item.notAvailable),
    ...extractBloodGroups(item.not_available_withQty ?? item.notAvailableWithQty),
  ];
  const moderateGroups = extractBloodGroups(item.moderate);
  const explicitGroup = normalizeBloodGroup(item.bloodGroup ?? item.blood_group ?? item.bloodgroup ?? item.bloodGroupName ?? item.group ?? '');
  const hasGroupData = Boolean(explicitGroup || availableGroups.length || unavailableGroups.length || moderateGroups.length);
  if (hasGroupData && explicitGroup && explicitGroup !== bloodGroup) return null;
  if (availableGroups.includes(bloodGroup)) return { availability: 'available', verified: true, groupScoped: explicitGroup === bloodGroup };
  if (unavailableGroups.includes(bloodGroup)) return { availability: 'unavailable', verified: true, groupScoped: explicitGroup === bloodGroup };
  if (moderateGroups.includes(bloodGroup)) return { availability: 'unknown', verified: false };
  if (hasGroupData && !explicitGroup) return null;

  const status = String(item.currentStatus ?? item.availability ?? item.status ?? '').trim().toLowerCase();
  if (explicitGroup && (item.available === true || /^(available|in stock|yes)$/i.test(status))) return { availability: 'available', verified: true, groupScoped: true };
  if (explicitGroup && (item.available === false || item.not_available === true || item.notAvailable === true || /^(unavailable|not available|out of stock|no)$/i.test(status))) return { availability: 'unavailable', verified: true, groupScoped: true };
  return { availability: 'unknown', verified: false };
}

function normalizeComponent(value) {
  if (typeof value !== 'string') return 'Whole Blood';
  const normalized = value.trim().toLowerCase();
  if (!normalized) return 'Whole Blood';
  if (normalized.includes('platelet')) return 'Platelets';
  if (normalized.includes('packed red') || normalized.includes('prbc')) return 'Packed Red Blood Cells';
  if (normalized.includes('whole blood') || normalized.includes('whole-blood')) return 'Whole Blood';
  if (normalized.includes('ffp')) return 'FFP';
  if (normalized.includes('sdp')) return 'SDP';
  if (normalized.includes('cryo')) return 'Cryoprecipitate';
  return 'Whole Blood';
}

function haversineDistanceKm(fromLatitude, fromLongitude, toLatitude, toLongitude) {
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const latitudeDelta = toRadians(toLatitude - fromLatitude);
  const longitudeDelta = toRadians(toLongitude - fromLongitude);
  const latitudeA = toRadians(fromLatitude);
  const latitudeB = toRadians(toLatitude);

  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(longitudeDelta / 2) ** 2;

  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function mapProviderResults(rawResults, latitude, longitude, requestedBloodGroup, component) {
  return rawResults
    .map((item) => {
      const groupStatus = availabilityForGroup(item, requestedBloodGroup);
      if (!groupStatus) return null;

      const candidateLatitude = optionalNumber(item.latitude ?? item.lat);
      const candidateLongitude = optionalNumber(item.longitude ?? item.long ?? item.lon);
      const bankLatitude = candidateLatitude !== null && candidateLatitude >= -90 && candidateLatitude <= 90 ? candidateLatitude : null;
      const bankLongitude = candidateLongitude !== null && candidateLongitude >= -180 && candidateLongitude <= 180 ? candidateLongitude : null;
      const providerDistance = optionalNumber(item.distanceKm ?? item.distance_km);
      const calculatedDistance = bankLatitude !== null && bankLongitude !== null
        ? haversineDistanceKm(latitude, longitude, bankLatitude, bankLongitude)
        : null;

      return {
        name: optionalText(item.name ?? item.bloodBankName ?? item.centerName),
        address: optionalText(item.address),
        distanceKm: providerDistance !== null && providerDistance >= 0
          ? providerDistance
          : calculatedDistance !== null ? Number(calculatedDistance.toFixed(1)) : null,
        availability: groupStatus.availability,
        lastUpdated: optionalText(item.lastUpdated ?? item.lastUpdate ?? item.updatedAt),
        phone: optionalText(item.phone ?? item.ph ?? item.mobile),
        latitude: bankLatitude,
        longitude: bankLongitude,
        bloodGroup: requestedBloodGroup,
        component,
        units: groupStatus.groupScoped && groupStatus.availability === 'available'
          ? optionalNumber(item.units ?? item.quantity ?? item.qty)
          : null,
        source: 'eRaktKosh',
        verified: groupStatus.verified,
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      const leftDistance = left.distanceKm ?? Number.MAX_SAFE_INTEGER;
      const rightDistance = right.distanceKm ?? Number.MAX_SAFE_INTEGER;
      return leftDistance - rightDistance;
    });
}

router.post('/chat', authMiddleware, async (req, res) => {
  const { problem, language } = req.body || {};
  if (typeof problem !== 'string' || !problem.trim()) {
    return res.status(400).json({ success: false, message: 'Problem text cannot be empty' });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 35_000);
  try {
    const response = await fetch(`${getSahayakApiUrl()}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ problem: problem.trim(), language: language === 'hi' ? 'hi' : 'en' }),
      signal: controller.signal,
    });

    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ success: false, message: data.detail || data.message || 'Sahayak request failed' });
    return res.json({ success: true, data });
  } catch (error) {
    if (error.name === 'AbortError') return res.status(504).json({ success: false, message: 'Sahayak took too long to respond' });
    console.error(`Sahayak request failed: ${error.message}`);
    return res.status(503).json({ success: false, message: 'Sahayak AI service is unavailable' });
  } finally {
    clearTimeout(timeout);
  }
});

router.post('/transcribe', authMiddleware, audioUpload.single('audio'), async (req, res, next) => {
  if (!req.file || req.file.size === 0) {
    return res.status(400).json({ success: false, message: 'A non-empty voice recording is required' });
  }

  const provider = String(process.env.STT_PROVIDER || '').trim().toLowerCase();
  const apiKey = String(process.env.STT_API_KEY || '').trim();
  const model = String(process.env.STT_MODEL || 'whisper-1').trim();
  if (provider !== 'openai' || !apiKey || !model) {
    return res.status(500).json({ success: false, message: 'Speech transcription is not configured. Set STT_PROVIDER=openai, STT_API_KEY, and STT_MODEL in the server environment.' });
  }

  const form = new FormData();
  form.append('file', new Blob([req.file.buffer], { type: req.file.mimetype }), req.file.originalname || 'emergency.webm');
  form.append('model', model);

  try {
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ success: false, message: data.error?.message || 'Speech transcription failed' });
    return res.json({ success: true, data: { transcript: data.text || '' } });
  } catch (error) {
    return next(error);
  }
});

router.post('/blood-search', authMiddleware, async (req, res, next) => {
  const body = req.body || {};
  const bloodGroup = normalizeBloodGroup(body.bloodGroup || body.blood_group || '');
  const component = normalizeComponent(body.component || body.bloodComponent || 'Whole Blood');
  const units = Number(body.units ?? body.unitCount ?? 1);
  const latitude = optionalNumber(body.latitude);
  const longitude = optionalNumber(body.longitude);
  const requestedRadiusKm = Number(body.radiusKm);
  const radiusKm = Number.isFinite(requestedRadiusKm) && requestedRadiusKm > 0 ? requestedRadiusKm : 25;

  if (!bloodGroup) {
    return res.status(400).json({ success: false, message: 'Which blood group is required?' });
  }

  if (latitude === null || longitude === null || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return res.status(400).json({ success: false, message: 'Location permission is required to find nearby blood banks.' });
  }

  const apiSetuClientId = process.env.BLOOD_AVAILABILITY_CLIENT_ID?.trim();
  const apiSetuApiKey = process.env.BLOOD_AVAILABILITY_API_KEY?.trim();
  if (!apiSetuClientId || !apiSetuApiKey) {
    return res.status(503).json({
      success: false,
      message: 'eRaktKosh API credentials are not configured.',
    });
  }

  const providerName = process.env.BLOOD_AVAILABILITY_PROVIDER || 'eRaktKosh';
  const providerUrl = process.env.BLOOD_AVAILABILITY_API_URL
    || 'https://apigw.umangapp.in/umang/apisetu/dept/eraktkoshiapi/ws1/stocknearby';

  let results = [];
  let lastUpdated = null;
  let providerMessage = '';
  let providerStatus = null;
  let providerData = null;

  if (providerUrl) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const providerResponse = await fetch(providerUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          depid: '98',
          formtrkr: '0',
          srvid: '722',
          subsid: '0',
          subsid2: '0',
          'X-APISETU-CLIENTID': apiSetuClientId,
          'X-APISETU-APIKEY': apiSetuApiKey,
          ...(process.env.BLOOD_AVAILABILITY_TENANT_ID ? { tenantId: process.env.BLOOD_AVAILABILITY_TENANT_ID } : {}),
        },
        body: JSON.stringify({
          ...(process.env.BLOOD_AVAILABILITY_TOKEN ? { tkn: process.env.BLOOD_AVAILABILITY_TOKEN } : {}),
          lang: 'en',
          ...(process.env.BLOOD_AVAILABILITY_USER_ID ? { usrid: process.env.BLOOD_AVAILABILITY_USER_ID } : {}),
          mode: 'web',
          pltfrm: 'apisetu',
          did: null,
          depid: '98',
          srvid: '722',
          source: 'UMANG',
          deptLat: latitude,
          deptLong: longitude,
          bbType: '',
          radius: String(Math.round(radiusKm * 1000)),
          usag: null,
        }),
        signal: controller.signal,
      });
      providerStatus = providerResponse.status;
      const responseText = await providerResponse.text();
      let data = null;
      try {
        data = responseText ? JSON.parse(responseText) : null;
      } catch {
        providerMessage = 'eRaktKosh returned an unexpected response.';
      }

      if (!providerResponse.ok) {
        providerMessage = providerResponse.status === 401 || providerResponse.status === 403
          ? 'eRaktKosh API authentication is not configured or is not authorized.'
          : 'eRaktKosh blood availability service returned an error.';
      } else if (!data || typeof data !== 'object') {
        providerMessage = 'eRaktKosh returned an unexpected response.';
      } else if ((data.rs && data.rs !== 'S') || (data.rc && data.rc !== 'ER0000')) {
        const isAuthError = /auth|token|credential|unauthori[sz]ed/i.test(`${data.rc || ''} ${data.rd || ''}`);
        providerMessage = isAuthError
          ? 'eRaktKosh API authentication is not configured or is not authorized.'
          : 'eRaktKosh blood availability service returned an error.';
      } else {
        try {
          providerData = parseProviderResponse(data);
          const providerRows = findProviderRows(providerData);
          if (providerRows) {
            results = mapProviderResults(providerRows, latitude, longitude, bloodGroup, component);
            lastUpdated = optionalText(providerData.lastUpdated ?? providerData.lastUpdate ?? providerData.updatedAt);
          } else if (Number(providerData.TOTAL ?? providerData.total) === 0) {
            results = [];
          } else {
            providerMessage = 'eRaktKosh returned an unexpected response.';
          }
        } catch (error) {
          console.error('Unable to parse eRaktKosh response', error.message);
          providerMessage = 'eRaktKosh returned an unexpected response.';
        }
      }
    } catch (error) {
      console.error('eRaktKosh blood availability request failed', error.name);
      if (error.name === 'AbortError') providerStatus = 504;
      providerMessage = 'Live blood-stock availability could not be verified right now.';
    } finally {
      clearTimeout(timeout);
    }
  }

  if (providerMessage) {
    return res.status(providerStatus === 504 ? 504 : 502).json({
      success: false,
      message: providerMessage,
      ...(providerStatus ? { providerStatus } : {}),
    });
  }

  return res.json({
    success: true,
    data: {
      source: providerName,
      query: {
        bloodGroup,
        component,
        units: Number.isFinite(units) && units > 0 ? units : 1,
        latitude,
        longitude,
      },
      results: results.slice(0, 10),
      lastUpdated,
      message: results.length
        ? 'Blood-bank information returned by eRaktKosh. Please confirm availability with the blood bank before travel.'
        : 'No verified blood-bank results were found for the requested blood group in the selected area.',
    },
  });
});

export default router;

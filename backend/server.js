require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3001;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const STRAVA_CLIENT_ID = process.env.STRAVA_CLIENT_ID;
const STRAVA_CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;
const STRAVA_WEBHOOK_VERIFY_TOKEN = process.env.STRAVA_WEBHOOK_VERIFY_TOKEN || 'bike-wattage-verify-xyz';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// ---------------------------------------------------------------------------
// Supabase client (optional — only initialised when env vars are present)
// ---------------------------------------------------------------------------
let supabase = null;
if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
  try {
    const { createClient } = require('@supabase/supabase-js');
    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  } catch (e) {
    console.warn('Failed to initialise Supabase client:', e.message);
  }
}

// ---------------------------------------------------------------------------
// Physics constants (must match frontend powerCalculator.ts / types.ts)
// ---------------------------------------------------------------------------
const G = 9.81;
const RHO = 1.225;
const EFFICIENCY = 0.976;
const MAX_SPEED_MS = 25; // cap GPS noise

const BIKE_PRESETS = {
  'rei-adv':    { weightKg: 22 * 0.453592, crr: 0.006 },
  'state-5055': { weightKg: 21 * 0.453592, crr: 0.010 },
};

const CDA = {
  'aggressive': 0.32,
  'sport':      0.40,
  'upright':    0.50,
};

const RIDER_KG = 175 * 0.453592; // hardcoded rider weight: 175 lbs

// ---------------------------------------------------------------------------
// Helper: haversine distance between two [lat, lon] points (metres)
// ---------------------------------------------------------------------------
function haversineDistance(a, b) {
  const R = 6371000;
  const lat1 = a[0] * Math.PI / 180;
  const lat2 = b[0] * Math.PI / 180;
  const dLat = (b[0] - a[0]) * Math.PI / 180;
  const dLon = (b[1] - a[1]) * Math.PI / 180;
  const sinDlat = Math.sin(dLat / 2);
  const sinDlon = Math.sin(dLon / 2);
  const aa = sinDlat * sinDlat + Math.cos(lat1) * Math.cos(lat2) * sinDlon * sinDlon;
  return R * 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
}

// ---------------------------------------------------------------------------
// Helper: rolling average of an array
// ---------------------------------------------------------------------------
function rollingAverage(arr, windowSize) {
  const result = new Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    const start = Math.max(0, i - Math.floor(windowSize / 2));
    const end = Math.min(arr.length, i + Math.ceil(windowSize / 2));
    let sum = 0;
    for (let j = start; j < end; j++) sum += arr[j];
    result[i] = sum / (end - start);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Helper: nth percentile of an array
// ---------------------------------------------------------------------------
function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = arr.slice().sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const low = Math.floor(idx);
  const high = Math.ceil(idx);
  if (low === high) return sorted[low];
  return sorted[low] + (sorted[high] - sorted[low]) * (idx - low);
}

// ---------------------------------------------------------------------------
// Server-side power calculation (port of frontend powerCalculator.ts)
//
// streams: { latlng: [[lat,lon],...], altitude: [m,...], time: [s,...], distance: [m,...] }
// bikePreset: 'rei-adv' | 'state-5055'
// ridingPosition: 'aggressive' | 'sport' | 'upright'
// Returns: { avgWatts, peakWatts, wPerKg } or null on error
// ---------------------------------------------------------------------------
function calculatePowerFromStreams(streams, bikePreset, ridingPosition) {
  try {
    const { latlng, altitude, time, distance } = streams;

    if (!latlng || latlng.length < 2) return null;

    const preset = BIKE_PRESETS[bikePreset] || BIKE_PRESETS['rei-adv'];
    const cda = CDA[ridingPosition] || CDA['sport'];
    const totalMassKg = RIDER_KG + preset.weightKg;
    const n = latlng.length;

    // Build raw speeds (m/s) and elevation deltas per segment
    const rawSpeeds = [];
    const rawElevDeltas = [];

    for (let i = 1; i < n; i++) {
      const dt = (time[i] ?? i) - (time[i - 1] ?? i - 1);
      if (dt <= 0) {
        rawSpeeds.push(0);
        rawElevDeltas.push(0);
        continue;
      }
      // Use distance stream for speed if available, fall back to haversine
      let distSeg;
      if (distance && distance[i] != null && distance[i - 1] != null) {
        distSeg = distance[i] - distance[i - 1];
      } else {
        distSeg = haversineDistance(latlng[i - 1], latlng[i]);
      }
      const speed = Math.min(distSeg / dt, MAX_SPEED_MS);
      rawSpeeds.push(speed);
      const elevDelta = (altitude[i] ?? 0) - (altitude[i - 1] ?? 0);
      rawElevDeltas.push(elevDelta);
    }

    // 5-second rolling average for speeds and elevation deltas
    // Approximate 5-sample window (1 Hz data assumed)
    const smoothedSpeeds = rollingAverage(rawSpeeds, 5);
    const smoothedElevDeltas = rollingAverage(rawElevDeltas, 5);

    // Calculate power at each segment
    const powers = [];
    for (let i = 0; i < smoothedSpeeds.length; i++) {
      const v = smoothedSpeeds[i];
      const dt = ((time[i + 1] ?? i + 1) - (time[i] ?? i)) || 1;
      const elevDelta = smoothedElevDeltas[i];

      // Segment distance from speed and time
      const segDist = v * dt;
      const grade = segDist > 0 ? elevDelta / segDist : 0;
      const sinGrade = Math.sin(Math.atan(grade));

      const pGravity = totalMassKg * G * sinGrade * v;
      const pRolling = totalMassKg * G * Math.cos(Math.atan(grade)) * preset.crr * v;
      const pAir = 0.5 * cda * RHO * v * v * v;

      const rawPower = (pGravity + pRolling + pAir) / EFFICIENCY;
      powers.push(Math.max(0, rawPower));
    }

    if (powers.length === 0) return null;

    // Average power: mean of all values including zeros
    const avgWatts = Math.round(powers.reduce((s, p) => s + p, 0) / powers.length);

    // Peak power: 30-second rolling average then 95th percentile
    const smoothed30 = rollingAverage(powers, 30);
    const peakWatts = Math.round(percentile(smoothed30, 95));

    const wPerKg = parseFloat((avgWatts / RIDER_KG).toFixed(2));

    return { avgWatts, peakWatts, wPerKg };
  } catch (err) {
    console.error('Power calculation error:', err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Supabase helper functions
// ---------------------------------------------------------------------------
async function getAthlete(athleteId) {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('athletes')
    .select('*')
    .eq('athlete_id', athleteId)
    .maybeSingle();
  if (error) {
    console.error('getAthlete error:', error.message);
    return null;
  }
  return data;
}

async function upsertAthlete(data) {
  if (!supabase) return null;
  const { data: result, error } = await supabase
    .from('athletes')
    .upsert(data, { onConflict: 'athlete_id' })
    .select()
    .single();
  if (error) {
    console.error('upsertAthlete error:', error.message);
    return null;
  }
  return result;
}

async function refreshStravaToken(athlete) {
  const nowSec = Math.floor(Date.now() / 1000);
  // Refresh if token expires within 5 minutes
  if (athlete.expires_at - 300 >= nowSec) {
    return athlete; // Token still valid
  }

  try {
    const resp = await axios.post('https://www.strava.com/oauth/token', {
      client_id: STRAVA_CLIENT_ID,
      client_secret: STRAVA_CLIENT_SECRET,
      refresh_token: athlete.refresh_token,
      grant_type: 'refresh_token'
    });

    const { access_token, refresh_token, expires_at } = resp.data;
    const updated = await upsertAthlete({
      athlete_id: athlete.athlete_id,
      access_token,
      refresh_token,
      expires_at,
      bike_preset: athlete.bike_preset,
      riding_position: athlete.riding_position
    });
    return updated || { ...athlete, access_token, refresh_token, expires_at };
  } catch (err) {
    console.error('Token refresh error:', err.response?.data || err.message);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.use(cors({
  origin: FRONTEND_URL,
  credentials: true
}));
app.use(express.json());

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    stravaConfigured: !!(STRAVA_CLIENT_ID && STRAVA_CLIENT_SECRET),
    supabaseConfigured: !!supabase
  });
});

// ---------------------------------------------------------------------------
// Step 1: Redirect user to Strava OAuth
// ---------------------------------------------------------------------------
app.get('/auth/strava', (req, res) => {
  const activityId = req.query.activity_id || '';

  if (!STRAVA_CLIENT_ID) {
    return res.status(500).json({ error: 'STRAVA_CLIENT_ID not configured' });
  }

  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  const redirectUri = `${protocol}://${req.get('host')}/auth/strava/callback`;
  const scope = 'activity:read_all,activity:write';
  const state = activityId ? encodeURIComponent(activityId) : '';

  const stravaAuthUrl = `https://www.strava.com/oauth/authorize?client_id=${STRAVA_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scope}&state=${state}`;

  res.redirect(stravaAuthUrl);
});

// ---------------------------------------------------------------------------
// Step 2: Handle OAuth callback from Strava
// ---------------------------------------------------------------------------
app.get('/auth/strava/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.redirect(`${FRONTEND_URL}/?strava_error=${encodeURIComponent(error)}`);
  }

  if (!code) {
    return res.redirect(`${FRONTEND_URL}/?strava_error=no_code`);
  }

  try {
    const tokenResponse = await axios.post('https://www.strava.com/oauth/token', {
      client_id: STRAVA_CLIENT_ID,
      client_secret: STRAVA_CLIENT_SECRET,
      code: code,
      grant_type: 'authorization_code'
    });

    const { access_token, refresh_token, expires_at, athlete } = tokenResponse.data;
    const athleteId = athlete?.id?.toString();
    const activityId = state ? decodeURIComponent(state) : '';

    // Store athlete in Supabase (with default preferences)
    if (supabase && athleteId) {
      await upsertAthlete({
        athlete_id: athleteId,
        access_token,
        refresh_token,
        expires_at,
        bike_preset: 'rei-adv',
        riding_position: 'sport'
      });
    }

    // Redirect back to frontend with token, athlete ID, and optional activity ID
    let redirectUrl = `${FRONTEND_URL}/?strava_token=${encodeURIComponent(access_token)}&athlete_id=${encodeURIComponent(athleteId)}&strava=connected`;
    if (activityId) {
      redirectUrl += `&activity_id=${encodeURIComponent(activityId)}`;
    }

    res.redirect(redirectUrl);
  } catch (err) {
    console.error('Token exchange error:', err.response?.data || err.message);
    res.redirect(`${FRONTEND_URL}/?strava_error=token_exchange_failed`);
  }
});

// ---------------------------------------------------------------------------
// One-time athlete registration using an existing access token
// GET /auth/register?token=ACCESS_TOKEN
// ---------------------------------------------------------------------------
app.get('/auth/register', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'token is required' });
  if (!supabase) return res.status(503).json({ error: 'Supabase not configured' });

  try {
    // Fetch athlete profile from Strava to get their ID and validate token
    const athleteResp = await axios.get('https://www.strava.com/api/v3/athlete', {
      headers: { Authorization: `Bearer ${token}` }
    });
    const athlete = athleteResp.data;
    const athleteId = athlete.id?.toString();

    if (!athleteId) return res.status(400).json({ error: 'Could not determine athlete ID from token' });

    // Save to Supabase with defaults (no refresh_token available from access token alone)
    const { data: result, error } = await supabase
      .from('athletes')
      .upsert({
        athlete_id: athleteId,
        access_token: token,
        refresh_token: 'pending',
        expires_at: Math.floor(Date.now() / 1000) + 21600, // 6 hours from now
        bike_preset: 'rei-adv',
        riding_position: 'sport'
      }, { onConflict: 'athlete_id' })
      .select()
      .single();

    if (error) {
      console.error('register upsert error:', error.message);
      return res.status(500).json({ error: error.message });
    }

    res.json({ success: true, athlete_id: athleteId, name: `${athlete.firstname} ${athlete.lastname}` });
  } catch (err) {
    console.error('register error:', err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

// ---------------------------------------------------------------------------
// Fetch activity streams from Strava (frontend-initiated)
// ---------------------------------------------------------------------------
app.get('/api/activity/:id', async (req, res) => {
  const { id } = req.params;
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }

  const token = authHeader.split(' ')[1];

  try {
    // Fetch activity details
    const activityResponse = await axios.get(`https://www.strava.com/api/v3/activities/${id}`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    const activity = activityResponse.data;

    // Fetch streams: latlng, altitude, time, distance
    const streamsResponse = await axios.get(
      `https://www.strava.com/api/v3/activities/${id}/streams`,
      {
        headers: { Authorization: `Bearer ${token}` },
        params: {
          keys: 'latlng,altitude,time,distance',
          key_by_type: true
        }
      }
    );

    const streams = streamsResponse.data;

    res.json({
      activity: {
        name: activity.name,
        distance: activity.distance,
        moving_time: activity.moving_time,
        total_elevation_gain: activity.total_elevation_gain,
        start_date: activity.start_date
      },
      streams: {
        latlng: streams.latlng?.data || [],
        altitude: streams.altitude?.data || [],
        time: streams.time?.data || [],
        distance: streams.distance?.data || []
      }
    });
  } catch (err) {
    console.error('Activity fetch error:', err.response?.data || err.message);
    const status = err.response?.status || 500;
    const message = err.response?.data?.message || err.message || 'Failed to fetch activity';
    res.status(status).json({ error: message });
  }
});

// ---------------------------------------------------------------------------
// Webhook: GET — Strava hub challenge verification
// ---------------------------------------------------------------------------
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === STRAVA_WEBHOOK_VERIFY_TOKEN) {
    console.log('Webhook verified by Strava');
    return res.json({ 'hub.challenge': challenge });
  }

  res.status(403).json({ error: 'Verification failed' });
});

// ---------------------------------------------------------------------------
// Webhook: POST — Strava activity event handler
// ---------------------------------------------------------------------------
const RIDE_TYPES = new Set([
  'Ride', 'VirtualRide', 'MountainBikeRide', 'GravelRide', 'EBikeRide'
]);

app.post('/webhook', async (req, res) => {
  // Acknowledge immediately per Strava requirements
  res.json({ received: true });

  const event = req.body;
  console.log(`Webhook received: object_type=${event.object_type} aspect_type=${event.aspect_type} object_id=${event.object_id} owner_id=${event.owner_id}`);

  // Only handle new activity events
  if (event.object_type !== 'activity' || event.aspect_type !== 'create') {
    console.log(`Webhook: ignoring event (object_type=${event.object_type}, aspect_type=${event.aspect_type})`);
    return;
  }

  const activityId = event.object_id;
  const athleteId = event.owner_id?.toString();

  if (!activityId || !athleteId) {
    console.warn(`Webhook: missing activityId or athleteId`);
    return;
  }
  if (!supabase) {
    console.warn('Webhook received but Supabase not configured — skipping auto-sync');
    return;
  }

  try {
    // Fetch athlete record from Supabase
    let athlete = await getAthlete(athleteId);
    if (!athlete) {
      console.log(`Webhook: no athlete record for ${athleteId} in Supabase, skipping`);
      return;
    }
    console.log(`Webhook: found athlete ${athleteId}, bike_preset=${athlete.bike_preset}, riding_position=${athlete.riding_position}`);

    // Refresh token if needed
    athlete = await refreshStravaToken(athlete);
    const token = athlete.access_token;

    // Strava sometimes fires the webhook before the activity is fully processed.
    // Wait a few seconds to let GPS/stream data become available.
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Fetch activity details
    const activityResp = await axios.get(
      `https://www.strava.com/api/v3/activities/${activityId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const activity = activityResp.data;
    console.log(`Webhook: activity type=${activity.type} sport_type=${activity.sport_type}`);

    // Check both deprecated 'type' and current 'sport_type' fields
    const activityType = activity.sport_type || activity.type;
    if (!RIDE_TYPES.has(activityType)) {
      console.log(`Webhook: skipping non-ride activity type '${activityType}'`);
      return;
    }

    // Skip if already processed
    if (activity.description && activity.description.includes('⚡ Power Analysis')) {
      console.log(`Webhook: activity ${activityId} already has power analysis, skipping`);
      return;
    }

    // Fetch GPS streams
    const streamsResp = await axios.get(
      `https://www.strava.com/api/v3/activities/${activityId}/streams`,
      {
        headers: { Authorization: `Bearer ${token}` },
        params: { keys: 'latlng,altitude,time,distance', key_by_type: true }
      }
    );
    const rawStreams = streamsResp.data;
    const streams = {
      latlng:   rawStreams.latlng?.data   || [],
      altitude: rawStreams.altitude?.data || [],
      time:     rawStreams.time?.data     || [],
      distance: rawStreams.distance?.data || []
    };
    console.log(`Webhook: streams fetched — latlng points: ${streams.latlng.length}, time points: ${streams.time.length}`);

    // Calculate power
    const bikePreset = athlete.bike_preset || 'rei-adv';
    const ridingPosition = athlete.riding_position || 'sport';
    const result = calculatePowerFromStreams(streams, bikePreset, ridingPosition);

    if (!result) {
      console.log(`Webhook: power calculation returned null for activity ${activityId} (insufficient GPS data?)`);
      return;
    }

    const { avgWatts, peakWatts, wPerKg } = result;

    // Build the power analysis description block
    const powerBlock = [
      '⚡ Power Analysis (Cycling Power Analyzer)',
      `Average Power: ${avgWatts} W`,
      `Peak Power (95th %ile): ${peakWatts} W`,
      `Power-to-Weight: ${wPerKg} W/kg`,
      'Calculated using physics-based modeling — https://ryanjames1729.github.io/bike-wattage-calculator/'
    ].join('\n');

    // Append to existing description
    const existingDesc = activity.description || '';
    const newDescription = existingDesc
      ? `${existingDesc}\n\n${powerBlock}`
      : powerBlock;

    // Update activity description via Strava API
    await axios.put(
      `https://www.strava.com/api/v3/activities/${activityId}`,
      { description: newDescription },
      { headers: { Authorization: `Bearer ${token}` } }
    );

    console.log(`Webhook: updated activity ${activityId} — avg ${avgWatts}W, peak ${peakWatts}W`);
  } catch (err) {
    console.error(`Webhook processing error for activity ${activityId}:`, err.response?.data || err.message);
  }
});

// ---------------------------------------------------------------------------
// One-time helper: register this webhook with Strava
// ---------------------------------------------------------------------------
app.get('/webhook/register', async (req, res) => {
  if (!STRAVA_CLIENT_ID || !STRAVA_CLIENT_SECRET) {
    return res.status(500).json({ error: 'Strava credentials not configured' });
  }

  // Use x-forwarded-proto on Vercel (req.protocol is always 'http' behind their proxy)
  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  const callbackUrl = `${protocol}://${req.get('host')}/webhook`;

  try {
    const resp = await axios.post(
      'https://www.strava.com/api/v3/push_subscriptions',
      {
        client_id: STRAVA_CLIENT_ID,
        client_secret: STRAVA_CLIENT_SECRET,
        callback_url: callbackUrl,
        verify_token: STRAVA_WEBHOOK_VERIFY_TOKEN
      }
    );
    res.json({ success: true, subscription: resp.data });
  } catch (err) {
    console.error('Webhook registration error:', err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

// ---------------------------------------------------------------------------
// Manual trigger: process a specific activity through the power analyzer
// GET /webhook/process?activity_id=123&athlete_id=456
// Optionally pass &token=ACCESS_TOKEN to bypass Supabase lookup
// ---------------------------------------------------------------------------
app.get('/webhook/process', async (req, res) => {
  const { activity_id: activityId, athlete_id: athleteId, token: directToken } = req.query;

  if (!activityId) {
    return res.status(400).json({ error: 'activity_id is required' });
  }

  try {
    let token;
    let bikePreset = 'rei-adv';
    let ridingPosition = 'sport';

    if (directToken) {
      // Bypass Supabase — use the token directly
      token = directToken;
    } else {
      if (!athleteId) return res.status(400).json({ error: 'athlete_id or token is required' });
      if (!supabase) return res.status(503).json({ error: 'Supabase not configured' });

      let athlete = await getAthlete(athleteId);
      if (!athlete) {
        return res.status(404).json({ error: `No athlete record for ${athleteId}` });
      }
      athlete = await refreshStravaToken(athlete);
      token = athlete.access_token;
      bikePreset = athlete.bike_preset || 'rei-adv';
      ridingPosition = athlete.riding_position || 'sport';
    }

    const activityResp = await axios.get(
      `https://www.strava.com/api/v3/activities/${activityId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const activity = activityResp.data;

    const activityType = activity.sport_type || activity.type;
    if (!RIDE_TYPES.has(activityType)) {
      return res.status(400).json({ error: `Not a ride activity (type: ${activityType})` });
    }

    if (activity.description && activity.description.includes('⚡ Power Analysis')) {
      return res.json({ skipped: true, reason: 'Already has power analysis' });
    }

    const streamsResp = await axios.get(
      `https://www.strava.com/api/v3/activities/${activityId}/streams`,
      {
        headers: { Authorization: `Bearer ${token}` },
        params: { keys: 'latlng,altitude,time,distance', key_by_type: true }
      }
    );
    const rawStreams = streamsResp.data;
    const streams = {
      latlng:   rawStreams.latlng?.data   || [],
      altitude: rawStreams.altitude?.data || [],
      time:     rawStreams.time?.data     || [],
      distance: rawStreams.distance?.data || []
    };

    const result = calculatePowerFromStreams(streams, bikePreset, ridingPosition);

    if (!result) {
      return res.status(422).json({ error: 'Power calculation failed (insufficient GPS data)' });
    }

    const { avgWatts, peakWatts, wPerKg } = result;
    const powerBlock = [
      '⚡ Power Analysis (Cycling Power Analyzer)',
      `Average Power: ${avgWatts} W`,
      `Peak Power (95th %ile): ${peakWatts} W`,
      `Power-to-Weight: ${wPerKg} W/kg`,
      'Calculated using physics-based modeling — https://ryanjames1729.github.io/bike-wattage-calculator/'
    ].join('\n');

    const existingDesc = activity.description || '';
    const newDescription = existingDesc ? `${existingDesc}\n\n${powerBlock}` : powerBlock;

    await axios.put(
      `https://www.strava.com/api/v3/activities/${activityId}`,
      { description: newDescription },
      { headers: { Authorization: `Bearer ${token}` } }
    );

    res.json({ success: true, avgWatts, peakWatts, wPerKg });
  } catch (err) {
    console.error('Manual process error:', err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

// ---------------------------------------------------------------------------
// Athlete preferences endpoints
// ---------------------------------------------------------------------------
app.get('/api/preferences/:athleteId', async (req, res) => {
  const { athleteId } = req.params;
  if (!supabase) {
    return res.status(503).json({ error: 'Supabase not configured' });
  }
  const athlete = await getAthlete(athleteId);
  if (!athlete) {
    return res.status(404).json({ error: 'Athlete not found' });
  }
  res.json({
    bike_preset: athlete.bike_preset || 'rei-adv',
    riding_position: athlete.riding_position || 'sport'
  });
});

app.post('/api/preferences/:athleteId', async (req, res) => {
  const { athleteId } = req.params;
  const { bike_preset, riding_position } = req.body;

  if (!supabase) {
    return res.status(503).json({ error: 'Supabase not configured' });
  }

  const athlete = await getAthlete(athleteId);
  if (!athlete) {
    return res.status(404).json({ error: 'Athlete not found' });
  }

  const updated = await upsertAthlete({
    ...athlete,
    bike_preset: bike_preset || athlete.bike_preset,
    riding_position: riding_position || athlete.riding_position
  });

  if (!updated) {
    return res.status(500).json({ error: 'Failed to update preferences' });
  }

  res.json({
    bike_preset: updated.bike_preset,
    riding_position: updated.riding_position
  });
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
  if (!STRAVA_CLIENT_ID || !STRAVA_CLIENT_SECRET) console.warn('⚠️  Strava credentials missing');
  if (!supabase) console.warn('⚠️  Supabase not configured — webhook persistence disabled');
});

module.exports = app;

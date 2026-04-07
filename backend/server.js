require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3001;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const STRAVA_CLIENT_ID = process.env.STRAVA_CLIENT_ID;
const STRAVA_CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;

app.use(cors({
  origin: FRONTEND_URL,
  credentials: true
}));
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', stravaConfigured: !!(STRAVA_CLIENT_ID && STRAVA_CLIENT_SECRET) });
});

// Step 1: Redirect user to Strava OAuth
app.get('/auth/strava', (req, res) => {
  const activityId = req.query.activity_id || '';

  if (!STRAVA_CLIENT_ID) {
    return res.status(500).json({ error: 'STRAVA_CLIENT_ID not configured' });
  }

  const redirectUri = `${req.protocol}://${req.get('host')}/auth/strava/callback`;
  const scope = 'activity:read_all';
  const state = activityId ? encodeURIComponent(activityId) : '';

  const stravaAuthUrl = `https://www.strava.com/oauth/authorize?client_id=${STRAVA_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scope}&state=${state}`;

  res.redirect(stravaAuthUrl);
});

// Step 2: Handle OAuth callback from Strava
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

    const { access_token } = tokenResponse.data;
    const activityId = state ? decodeURIComponent(state) : '';

    // Redirect back to frontend root with token and activity id as query params.
    // Using root path (/?...) so it works on both localhost and GitHub Pages.
    let redirectUrl = `${FRONTEND_URL}/?strava_token=${encodeURIComponent(access_token)}`;
    if (activityId) {
      redirectUrl += `&activity_id=${encodeURIComponent(activityId)}`;
    }

    res.redirect(redirectUrl);
  } catch (err) {
    console.error('Token exchange error:', err.response?.data || err.message);
    res.redirect(`${FRONTEND_URL}/?strava_error=token_exchange_failed`);
  }
});

// Fetch activity streams from Strava
app.get('/api/activity/:id', async (req, res) => {
  const { id } = req.params;
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }

  const token = authHeader.split(' ')[1];

  try {
    // Fetch activity details first
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

app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
  if (!STRAVA_CLIENT_ID || !STRAVA_CLIENT_SECRET) {
    console.warn('WARNING: STRAVA_CLIENT_ID or STRAVA_CLIENT_SECRET not set. Copy .env.example to .env and fill in your credentials.');
  }
});

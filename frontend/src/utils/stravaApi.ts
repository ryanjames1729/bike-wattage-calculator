import { DataPoint, ActivityMeta } from '../types';

// In dev, empty string routes through Vite proxy to localhost:3001.
// In production (GitHub Pages), set VITE_BACKEND_URL to your deployed backend URL.
const BACKEND_BASE = import.meta.env.VITE_BACKEND_URL || '';

/**
 * Extract numeric activity ID from a Strava URL.
 * Handles: https://www.strava.com/activities/12345678
 */
export function extractActivityId(url: string): string | null {
  const match = url.match(/strava\.com\/activities\/(\d+)/i);
  return match ? match[1] : null;
}

/**
 * Check if a string is a valid Strava activity URL.
 */
export function isStravaUrl(input: string): boolean {
  return /strava\.com\/activities\/\d+/i.test(input);
}

/**
 * Redirect browser to backend Strava OAuth endpoint.
 */
export function initiateStravaOAuth(activityId: string): void {
  window.location.href = `${BACKEND_BASE}/auth/strava?activity_id=${encodeURIComponent(activityId)}`;
}

interface StreamData {
  latlng: [number, number][];
  altitude: number[];
  time: number[];
  distance: number[];
}

interface ActivityResponse {
  activity: ActivityMeta;
  streams: StreamData;
}

/**
 * Fetch activity streams from our backend proxy.
 */
export async function fetchActivity(
  activityId: string,
  token: string
): Promise<{ points: DataPoint[]; meta: ActivityMeta }> {
  const response = await fetch(`${BACKEND_BASE}/api/activity/${activityId}`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP ${response.status}: Failed to fetch activity`);
  }

  const data: ActivityResponse = await response.json();
  const { streams, activity } = data;

  // Validate streams
  if (!streams.latlng || streams.latlng.length === 0) {
    throw new Error('Activity has no GPS data');
  }

  // Build DataPoint array from streams
  const points: DataPoint[] = [];
  const count = streams.latlng.length;

  for (let i = 0; i < count; i++) {
    const latlon = streams.latlng[i];
    if (!latlon || latlon.length < 2) continue;

    points.push({
      lat: latlon[0],
      lon: latlon[1],
      elevation: streams.altitude?.[i] ?? 0,
      time: streams.time?.[i] ?? i,
      distance: streams.distance?.[i] ?? 0
    });
  }

  if (points.length < 2) {
    throw new Error('Not enough GPS data points to calculate power');
  }

  return { points, meta: activity };
}

/**
 * Store OAuth token in sessionStorage.
 */
export function storeToken(token: string): void {
  sessionStorage.setItem('strava_token', token);
}

/**
 * Retrieve stored OAuth token.
 */
export function getStoredToken(): string | null {
  return sessionStorage.getItem('strava_token');
}

/**
 * Clear stored OAuth token.
 */
export function clearToken(): void {
  sessionStorage.removeItem('strava_token');
}

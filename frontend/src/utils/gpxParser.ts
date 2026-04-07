import { DataPoint } from '../types';

/**
 * Haversine formula – returns distance in metres between two lat/lon points.
 */
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000; // Earth radius in metres
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Parse a GPX file (as string) into an array of DataPoints.
 * Handles standard GPX 1.1 trkpt elements.
 */
export function parseGpx(gpxText: string): DataPoint[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(gpxText, 'application/xml');

  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    throw new Error('Invalid GPX file: could not parse XML');
  }

  const trkpts = doc.querySelectorAll('trkpt');
  if (trkpts.length === 0) {
    throw new Error('No track points found in GPX file');
  }

  const points: DataPoint[] = [];
  let startTime: number | null = null;
  let cumulativeDistance = 0;

  trkpts.forEach((pt, index) => {
    const lat = parseFloat(pt.getAttribute('lat') || '0');
    const lon = parseFloat(pt.getAttribute('lon') || '0');

    const eleEl = pt.querySelector('ele');
    const timeEl = pt.querySelector('time');

    const elevation = eleEl ? parseFloat(eleEl.textContent || '0') : 0;

    let timeSec = 0;
    if (timeEl && timeEl.textContent) {
      const ts = new Date(timeEl.textContent).getTime() / 1000;
      if (startTime === null) startTime = ts;
      timeSec = ts - startTime;
    } else {
      // No time data – assume 1 second per point
      timeSec = index;
    }

    if (index > 0 && points.length > 0) {
      const prev = points[points.length - 1];
      const segDist = haversineDistance(prev.lat, prev.lon, lat, lon);
      cumulativeDistance += segDist;
    }

    if (!isNaN(lat) && !isNaN(lon)) {
      points.push({ lat, lon, elevation, time: timeSec, distance: cumulativeDistance });
    }
  });

  if (points.length < 2) {
    throw new Error('GPX file must contain at least 2 track points');
  }

  return points;
}

/**
 * Read a File object and return its text content.
 */
export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as string);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

import { DataPoint, PowerPoint, AnalysisResults, BiometricsState, BikeState, RIDING_POSITIONS, TERRAIN_TYPES } from '../types';

const G = 9.81;          // gravitational acceleration m/s²
const RHO = 1.225;       // air density kg/m³ at sea level
const EFFICIENCY = 0.976; // drivetrain efficiency (2.4% loss)
const MAX_SPEED_MS = 25;  // ~90 km/h — hard cap to reject GPS teleport artifacts

/**
 * Resolve CdA from riding position key.
 */
function getCdA(position: BiometricsState['ridingPosition']): number {
  const found = RIDING_POSITIONS.find(p => p.value === position);
  return found ? found.cda : 0.40;
}

/**
 * Resolve Crr from terrain type key.
 */
function getCrr(terrain: BikeState['terrainType']): number {
  const found = TERRAIN_TYPES.find(t => t.value === terrain);
  return found ? found.crr : 0.004;
}

/**
 * Convert weight value + unit to kg.
 */
export function toKg(value: number, unit: 'kg' | 'lbs'): number {
  return unit === 'lbs' ? value * 0.453592 : value;
}

/**
 * Apply a rolling average over a window of `windowSize` samples.
 */
function rollingAverage(values: number[], windowSize: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - windowSize + 1);
    const slice = values.slice(start, i + 1);
    const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
    result.push(avg);
  }
  return result;
}

/**
 * Nth percentile of an array (sorted ascending).
 */
function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (idx - lower);
}

/**
 * Calculate elevation gain (sum of all positive elevation changes).
 */
function calcElevationGain(points: DataPoint[]): number {
  let gain = 0;
  for (let i = 1; i < points.length; i++) {
    const delta = points[i].elevation - points[i - 1].elevation;
    if (delta > 0) gain += delta;
  }
  return gain;
}

/**
 * Main power calculation function.
 * Uses cycling physics model for each data point.
 *
 * GPS fix: raw 1-second speed is noisy (positional errors create fake
 * high-speed bursts). We cap speed at MAX_SPEED_MS then apply a rolling
 * average over a 5-second window before computing power. This eliminates
 * the v³ amplification that inflated air-drag power by ~15x on noisy data.
 */
export function calculatePower(
  points: DataPoint[],
  biometrics: BiometricsState,
  bike: BikeState
): AnalysisResults {
  const riderKg = toKg(biometrics.weightValue, biometrics.weightUnit);
  const bikeKg = toKg(bike.weightValue, bike.weightUnit);
  const mTotal = riderKg + bikeKg;

  const CdA = getCdA(biometrics.ridingPosition);
  const Crr = getCrr(bike.terrainType);

  // --- Pass 1: compute per-segment raw speed and elevation delta ---
  interface Segment {
    timeSeconds: number;
    distance: number;
    rawSpeed: number;    // m/s, capped at MAX_SPEED_MS
    elevDelta: number;   // metres
    ds: number;          // horizontal segment distance in metres
  }

  const segments: Segment[] = [];

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];

    const dt = curr.time - prev.time;    // seconds
    const ds = curr.distance - prev.distance; // metres

    if (dt <= 0 || ds < 0) continue;

    const rawSpeed = Math.min(ds / dt, MAX_SPEED_MS);
    const elevDelta = curr.elevation - prev.elevation;

    segments.push({
      timeSeconds: curr.time,
      distance: curr.distance,
      rawSpeed,
      elevDelta,
      ds,
    });
  }

  // --- Pass 2: smooth speed over a 5-second rolling window ---
  // Estimate window size from median dt
  const dts: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const dt = points[i].time - points[i - 1].time;
    if (dt > 0) dts.push(dt);
  }
  dts.sort((a, b) => a - b);
  const medianDt = dts.length > 0 ? dts[Math.floor(dts.length / 2)] : 1;

  const speedSmoothWindow = Math.max(1, Math.round(5 / medianDt));
  const rawSpeeds = segments.map(s => s.rawSpeed);
  const smoothedSpeeds = rollingAverage(rawSpeeds, speedSmoothWindow);

  // Also smooth elevation deltas over the same window to reduce GPS elevation noise
  const rawElevDeltas = segments.map(s => s.elevDelta);
  const smoothedElevDeltas = rollingAverage(rawElevDeltas, speedSmoothWindow);

  // --- Pass 3: calculate power using smoothed speed and elevation ---
  const rawPowers: number[] = [];
  const powerPoints: PowerPoint[] = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const v = smoothedSpeeds[i];
    const elevDelta = smoothedElevDeltas[i];

    const ds = seg.ds > 0 ? seg.ds : v; // fallback if ds is tiny
    const theta = Math.atan2(elevDelta, ds);

    const pGravity = mTotal * G * v * Math.sin(theta);
    const pRolling = Crr * mTotal * G * v * Math.cos(theta);
    const pAir = 0.5 * RHO * CdA * Math.pow(v, 3);

    const pRaw = (pGravity + pRolling + pAir) / EFFICIENCY;

    // Clamp to 0 (no negative power — coasting)
    const pClamped = Math.max(0, pRaw);
    rawPowers.push(pClamped);

    powerPoints.push({
      timeSeconds: seg.timeSeconds,
      power: pClamped,
      smoothedPower: 0,
      speed: v,
      distance: seg.distance,
    });
  }

  // --- Pass 4: 30-second smoothing for the chart ---
  const powerSmoothWindow = Math.max(1, Math.round(30 / medianDt));
  const smoothed = rollingAverage(rawPowers, powerSmoothWindow);

  for (let i = 0; i < powerPoints.length; i++) {
    powerPoints[i].smoothedPower = smoothed[i];
  }

  // --- Averages and stats ---
  // Use ALL values (including zeros from coasting) for the true average.
  // Excluding zeros inflates the figure by ignoring recovery / descent time.
  const averageWatts = rawPowers.length > 0
    ? rawPowers.reduce((a, b) => a + b, 0) / rawPowers.length
    : 0;

  // Peak watts: 95th percentile of smoothed power (avoids residual spikes)
  const peakWatts = percentile(smoothed, 95);

  const duration = points[points.length - 1].time - points[0].time;
  const totalDistance = points[points.length - 1].distance;
  const elevationGain = calcElevationGain(points);
  const avgSpeed = duration > 0 ? totalDistance / duration : 0;
  const wPerKg = riderKg > 0 ? averageWatts / riderKg : 0;

  return {
    averageWatts: Math.round(averageWatts),
    peakWatts: Math.round(peakWatts),
    powerPoints,
    duration,
    totalDistance,
    elevationGain,
    avgSpeed,
    wPerKg: parseFloat(wPerKg.toFixed(2))
  };
}

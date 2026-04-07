import { DataPoint, PowerPoint, AnalysisResults, BiometricsState, BikeState, RIDING_POSITIONS, TERRAIN_TYPES } from '../types';

const G = 9.81;          // gravitational acceleration m/s²
const RHO = 1.225;       // air density kg/m³ at sea level
const EFFICIENCY = 0.976; // drivetrain efficiency (2.4% loss)

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

  const rawPowers: number[] = [];
  const powerPoints: PowerPoint[] = [];

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];

    const dt = curr.time - prev.time;          // seconds
    const ds = curr.distance - prev.distance;  // metres

    // Skip bad segments
    if (dt <= 0 || ds < 0) continue;

    // Speed in m/s
    const v = ds / dt;

    // Gradient angle
    const elevDelta = curr.elevation - prev.elevation;
    const theta = Math.atan2(elevDelta, ds);

    // Power components
    const pGravity = mTotal * G * v * Math.sin(theta);
    const pRolling = Crr * mTotal * G * v * Math.cos(theta);
    const pAir = 0.5 * RHO * CdA * Math.pow(v, 3);

    const pRaw = (pGravity + pRolling + pAir) / EFFICIENCY;

    // Clamp to 0 (no negative power – coasting)
    const pClamped = Math.max(0, pRaw);
    rawPowers.push(pClamped);

    powerPoints.push({
      timeSeconds: curr.time,
      power: pClamped,
      smoothedPower: 0, // filled in after rolling average
      speed: v,
      distance: curr.distance
    });
  }

  // 30-second rolling average: estimate window based on median dt
  // Find median dt
  const dts: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const dt = points[i].time - points[i - 1].time;
    if (dt > 0) dts.push(dt);
  }
  dts.sort((a, b) => a - b);
  const medianDt = dts.length > 0 ? dts[Math.floor(dts.length / 2)] : 1;
  const windowSize = Math.max(1, Math.round(30 / medianDt));

  const smoothed = rollingAverage(rawPowers, windowSize);

  // Apply smoothed values
  for (let i = 0; i < powerPoints.length; i++) {
    powerPoints[i].smoothedPower = smoothed[i];
  }

  // Average watts: mean of non-zero power values
  const nonZero = rawPowers.filter(p => p > 0);
  const averageWatts = nonZero.length > 0
    ? nonZero.reduce((a, b) => a + b, 0) / nonZero.length
    : 0;

  // Peak watts: 95th percentile of smoothed power (avoids GPS artifacts)
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

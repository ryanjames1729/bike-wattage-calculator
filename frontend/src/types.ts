// A single GPS data point from either GPX or Strava
export interface DataPoint {
  lat: number;
  lon: number;
  elevation: number;   // metres
  time: number;        // seconds since start
  distance: number;    // metres from start
}

// Rider biometrics form state
export interface BiometricsState {
  weightValue: number;
  weightUnit: 'kg' | 'lbs';
  ridingPosition: 'aggressive' | 'sport' | 'upright';
}

// Bike specs form state
export interface BikeState {
  weightValue: number;
  weightUnit: 'kg' | 'lbs';
  terrainType: 'road' | 'gravel' | 'mountain';
}

// Calculated power result for a single data point
export interface PowerPoint {
  timeSeconds: number;
  power: number;        // watts, clamped >= 0
  smoothedPower: number;
  speed: number;        // m/s
  distance: number;     // metres
}

// Final results returned by the power calculator
export interface AnalysisResults {
  averageWatts: number;
  peakWatts: number;         // 95th percentile
  powerPoints: PowerPoint[];
  duration: number;          // seconds
  totalDistance: number;     // metres
  elevationGain: number;     // metres
  avgSpeed: number;          // m/s
  wPerKg: number;
}

// Source of ride data
export type DataSource = 'strava' | 'gpx';

export interface ActivityMeta {
  name?: string;
  distance?: number;
  moving_time?: number;
  total_elevation_gain?: number;
  start_date?: string;
}

// App steps
export type AppStep = 'ride-input' | 'profile' | 'bike' | 'results' | 'loading' | 'callback';

// Riding position options with CdA values
export const RIDING_POSITIONS = [
  { value: 'aggressive', label: 'Aggressive / Race', cda: 0.32 },
  { value: 'sport',      label: 'Sport / Endurance',  cda: 0.40 },
  { value: 'upright',    label: 'Upright / Commuter', cda: 0.50 }
] as const;

// Terrain / tire options with Crr values
export const TERRAIN_TYPES = [
  { value: 'road',     label: 'Road (Smooth Tires)',    crr: 0.004 },
  { value: 'gravel',   label: 'Gravel / Mixed',         crr: 0.006 },
  { value: 'mountain', label: 'Mountain / Knobby',      crr: 0.010 }
] as const;

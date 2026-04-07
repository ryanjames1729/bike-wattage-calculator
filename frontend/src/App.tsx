import React, { useState, useEffect, useCallback } from 'react';
import { Activity, ChevronRight, ChevronLeft, AlertCircle } from 'lucide-react';
import RideInput from './components/RideInput';
import BiometricsForm from './components/BiometricsForm';
import BikeForm from './components/BikeForm';
import ResultsDisplay from './components/ResultsDisplay';
import { DataPoint, BiometricsState, BikeState, AnalysisResults, ActivityMeta, AppStep } from './types';
import { fetchActivity, storeToken, getStoredToken } from './utils/stravaApi';
import { calculatePower } from './utils/powerCalculator';

const DEFAULT_BIOMETRICS: BiometricsState = {
  weightValue: 75,
  weightUnit: 'kg',
  ridingPosition: 'sport'
};

const DEFAULT_BIKE: BikeState = {
  weightValue: 8,
  weightUnit: 'kg',
  terrainType: 'road'
};

type LoadingStage = 'fetching' | 'calculating' | null;

export default function App() {
  const [step, setStep] = useState<AppStep>('ride-input');
  const [dataPoints, setDataPoints] = useState<DataPoint[]>([]);
  const [activityMeta, setActivityMeta] = useState<ActivityMeta | undefined>();
  const [gpxFilename, setGpxFilename] = useState('');
  const [biometrics, setBiometrics] = useState<BiometricsState>(DEFAULT_BIOMETRICS);
  const [bike, setBike] = useState<BikeState>(DEFAULT_BIKE);
  const [results, setResults] = useState<AnalysisResults | null>(null);
  const [error, setError] = useState('');
  const [loadingStage, setLoadingStage] = useState<LoadingStage>(null);

  // Handle Strava OAuth callback params in the URL.
  // The backend redirects to /?strava_token=...&activity_id=... so this works
  // on both localhost and GitHub Pages (no /callback path needed).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('strava_token');
    const activityId = params.get('activity_id');
    const err = params.get('strava_error');

    if (!token && !err) return; // Normal page load, nothing to handle

    // Clean the URL immediately so params don't persist on refresh
    window.history.replaceState({}, '', window.location.pathname);

    if (err) {
      setError(`Strava authorisation failed: ${err}. Please try again.`);
      setStep('ride-input');
      return;
    }

    if (token) {
      storeToken(token);
      if (activityId) {
        handleFetchStravaActivity(activityId, token);
      } else {
        setStep('ride-input');
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFetchStravaActivity = useCallback(async (activityId: string, token?: string) => {
    const useToken = token || getStoredToken();
    if (!useToken) {
      setError('No Strava token found. Please reconnect.');
      setStep('ride-input');
      return;
    }

    setError('');
    setLoadingStage('fetching');
    setStep('loading');

    try {
      const { points, meta } = await fetchActivity(activityId, useToken);
      setDataPoints(points);
      setActivityMeta(meta);
      setGpxFilename('');
      setLoadingStage(null);
      setStep('profile');
    } catch (err) {
      setLoadingStage(null);
      setError(err instanceof Error ? err.message : 'Failed to fetch activity from Strava');
      setStep('ride-input');
    }
  }, []);

  const handleGpxLoaded = useCallback((points: DataPoint[], filename: string) => {
    setDataPoints(points);
    setGpxFilename(filename);
    setActivityMeta(undefined);
    setError('');
    setStep('profile');
  }, []);

  const handleStravaConnect = useCallback((activityId: string) => {
    handleFetchStravaActivity(activityId);
  }, [handleFetchStravaActivity]);

  const handleCalculate = async () => {
    if (dataPoints.length < 2) {
      setError('No ride data loaded');
      return;
    }

    setLoadingStage('calculating');
    setStep('loading');

    // Small delay to allow UI to update before heavy calculation
    await new Promise(resolve => setTimeout(resolve, 50));

    try {
      const calcResults = calculatePower(dataPoints, biometrics, bike);
      setResults(calcResults);
      setLoadingStage(null);
      setStep('results');
    } catch (err) {
      setLoadingStage(null);
      setError(err instanceof Error ? err.message : 'Calculation failed');
      setStep('bike');
    }
  };

  const handleReset = () => {
    setStep('ride-input');
    setDataPoints([]);
    setActivityMeta(undefined);
    setGpxFilename('');
    setResults(null);
    setError('');
    setLoadingStage(null);
    setBiometrics(DEFAULT_BIOMETRICS);
    setBike(DEFAULT_BIKE);
  };

  // Step definitions for progress indicator
  const STEPS = [
    { key: 'ride-input', label: 'Ride Data' },
    { key: 'profile',    label: 'Your Profile' },
    { key: 'bike',       label: 'Bike Specs' },
    { key: 'results',    label: 'Results' }
  ];

  const currentStepIndex = STEPS.findIndex(s => s.key === step);
  const showProgress = step !== 'loading';

  const dataLabel = activityMeta?.name
    ? activityMeta.name
    : gpxFilename
    ? gpxFilename
    : null;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-orange-500/20 flex items-center justify-center">
              <Activity size={20} className="text-orange-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-100 leading-tight">Cycling Power Analyzer</h1>
              <p className="text-xs text-slate-500 leading-tight">Physics-based power estimation</p>
            </div>
          </div>

          {step !== 'ride-input' && step !== 'loading' && (
            <button
              onClick={handleReset}
              className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
            >
              Start over
            </button>
          )}
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8">
        {/* Progress Steps */}
        {showProgress && (
          <div className="flex items-center justify-center gap-0 mb-10">
            {STEPS.map((s, i) => {
              const isActive = s.key === step;
              const isDone = currentStepIndex > i;
              return (
                <React.Fragment key={s.key}>
                  <div className="flex flex-col items-center">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all
                      ${isActive ? 'bg-orange-500 text-white ring-4 ring-orange-500/30' :
                        isDone  ? 'bg-green-500 text-white' :
                                  'bg-slate-700 text-slate-500'}`}
                    >
                      {isDone ? '✓' : i + 1}
                    </div>
                    <span className={`text-xs mt-1 font-medium whitespace-nowrap
                      ${isActive ? 'text-orange-400' :
                        isDone  ? 'text-green-400' :
                                  'text-slate-600'}`}
                    >
                      {s.label}
                    </span>
                  </div>
                  {i < STEPS.length - 1 && (
                    <div className={`h-px w-12 mx-1 mb-5 transition-all
                      ${currentStepIndex > i ? 'bg-green-500' : 'bg-slate-700'}`}
                    />
                  )}
                </React.Fragment>
              );
            })}
          </div>
        )}

        {/* Error Banner */}
        {error && (
          <div className="mb-6 flex items-start gap-3 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400">
            <AlertCircle size={18} className="mt-0.5 shrink-0" />
            <div>
              <p className="font-medium text-sm">Something went wrong</p>
              <p className="text-xs mt-0.5 text-red-400/80">{error}</p>
            </div>
            <button onClick={() => setError('')} className="ml-auto text-red-400/60 hover:text-red-400 text-lg leading-none">×</button>
          </div>
        )}

        {/* Loading Screen */}
        {step === 'loading' && (
          <div className="flex flex-col items-center justify-center py-32 gap-6">
            <div className="relative">
              <div className="w-16 h-16 border-4 border-slate-700 rounded-full" />
              <div className="absolute inset-0 w-16 h-16 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
            </div>
            <div className="text-center">
              <p className="text-slate-200 font-semibold text-lg">
                {loadingStage === 'fetching' ? 'Fetching ride data…' :
                 loadingStage === 'calculating' ? 'Calculating power…' :
                 'Processing…'}
              </p>
              <p className="text-slate-500 text-sm mt-1">
                {loadingStage === 'fetching' ? 'Connecting to Strava API' :
                 loadingStage === 'calculating' ? 'Applying cycling physics model' :
                 'Please wait'}
              </p>
            </div>
          </div>
        )}

        {/* Step 1: Ride Input */}
        {step === 'ride-input' && (
          <div className="bg-slate-800/40 border border-slate-700 rounded-2xl p-6 sm:p-8">
            <div className="mb-6">
              <h2 className="text-xl font-bold text-slate-100">Step 1 — Load Your Ride</h2>
              <p className="text-slate-400 text-sm mt-1">
                Connect with Strava to analyse from URL, or export GPX from any platform.
              </p>
            </div>
            <RideInput
              onStravaConnect={handleStravaConnect}
              onGpxLoaded={handleGpxLoaded}
            />
          </div>
        )}

        {/* Step 2: Profile */}
        {step === 'profile' && (
          <div className="space-y-6">
            {dataLabel && (
              <div className="bg-green-500/10 border border-green-500/30 rounded-xl px-4 py-3 text-green-400 text-sm flex items-center gap-2">
                <span className="text-green-500">✓</span>
                <span>Loaded: <span className="font-medium">{dataLabel}</span>
                  {dataPoints.length > 0 && ` · ${dataPoints.length.toLocaleString()} data points`}
                </span>
              </div>
            )}

            <div className="bg-slate-800/40 border border-slate-700 rounded-2xl p-6 sm:p-8">
              <div className="mb-6">
                <h2 className="text-xl font-bold text-slate-100">Step 2 — Your Profile</h2>
                <p className="text-slate-400 text-sm mt-1">Tell us about yourself so we can calculate realistic power figures.</p>
              </div>
              <BiometricsForm state={biometrics} onChange={setBiometrics} />
            </div>

            <div className="flex justify-between">
              <button
                onClick={() => setStep('ride-input')}
                className="flex items-center gap-2 px-5 py-3 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-xl transition-colors font-medium"
              >
                <ChevronLeft size={16} />
                Back
              </button>
              <button
                onClick={() => setStep('bike')}
                className="flex items-center gap-2 px-6 py-3 bg-orange-500 hover:bg-orange-600 text-white rounded-xl transition-colors font-semibold"
              >
                Next: Bike Specs
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Bike */}
        {step === 'bike' && (
          <div className="space-y-6">
            <div className="bg-slate-800/40 border border-slate-700 rounded-2xl p-6 sm:p-8">
              <div className="mb-6">
                <h2 className="text-xl font-bold text-slate-100">Step 3 — Bike Specs</h2>
                <p className="text-slate-400 text-sm mt-1">These affect rolling resistance and total system weight.</p>
              </div>
              <BikeForm state={bike} onChange={setBike} />
            </div>

            {/* Summary before calculate */}
            <div className="bg-slate-800/40 border border-slate-700 rounded-2xl px-5 py-4 text-sm space-y-1">
              <p className="text-slate-400 font-medium mb-2">Summary</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-slate-500">
                <span>Rider weight</span>
                <span className="text-slate-300">
                  {biometrics.weightValue} {biometrics.weightUnit}
                  {biometrics.weightUnit === 'lbs' && ` (${(biometrics.weightValue * 0.453592).toFixed(1)} kg)`}
                </span>
                <span>Riding position</span>
                <span className="text-slate-300 capitalize">{biometrics.ridingPosition}</span>
                <span>Bike weight</span>
                <span className="text-slate-300">
                  {bike.weightValue} {bike.weightUnit}
                  {bike.weightUnit === 'lbs' && ` (${(bike.weightValue * 0.453592).toFixed(1)} kg)`}
                </span>
                <span>Terrain</span>
                <span className="text-slate-300 capitalize">{bike.terrainType}</span>
                <span>Data points</span>
                <span className="text-slate-300">{dataPoints.length.toLocaleString()}</span>
              </div>
            </div>

            <div className="flex justify-between">
              <button
                onClick={() => setStep('profile')}
                className="flex items-center gap-2 px-5 py-3 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-xl transition-colors font-medium"
              >
                <ChevronLeft size={16} />
                Back
              </button>
              <button
                onClick={handleCalculate}
                className="flex items-center gap-2 px-8 py-3 bg-orange-500 hover:bg-orange-600 text-white rounded-xl transition-colors font-semibold text-lg"
              >
                <Activity size={18} />
                Calculate Power
              </button>
            </div>
          </div>
        )}

        {/* Step 4: Results */}
        {step === 'results' && results && (
          <ResultsDisplay
            results={results}
            meta={activityMeta}
            onReset={handleReset}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800 mt-16 py-6 text-center text-xs text-slate-600">
        <p>Cycling Power Analyzer · Physics-based estimation · Not a replacement for a power meter</p>
      </footer>
    </div>
  );
}

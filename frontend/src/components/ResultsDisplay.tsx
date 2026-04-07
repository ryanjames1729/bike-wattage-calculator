import React, { useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts';
import { Zap, TrendingUp, Clock, MapPin, Mountain, Gauge, RotateCcw } from 'lucide-react';
import { AnalysisResults, ActivityMeta } from '../types';

interface ResultsDisplayProps {
  results: AnalysisResults;
  meta?: ActivityMeta;
  riderName?: string;
  onReset: () => void;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s}s`;
}

function formatDistance(metres: number): string {
  if (metres >= 1000) return `${(metres / 1000).toFixed(2)} km`;
  return `${Math.round(metres)} m`;
}

function formatSpeed(ms: number): string {
  const kph = ms * 3.6;
  return `${kph.toFixed(1)} km/h`;
}

function getWPerKgLabel(wkg: number): { label: string; color: string } {
  if (wkg < 1.5) return { label: 'Untrained', color: 'text-slate-400' };
  if (wkg < 2.5) return { label: 'Recreational', color: 'text-blue-400' };
  if (wkg < 3.5) return { label: 'Trained', color: 'text-green-400' };
  if (wkg < 4.5) return { label: 'Competitive', color: 'text-yellow-400' };
  if (wkg < 5.5) return { label: 'Elite', color: 'text-orange-400' };
  return { label: 'Pro / World Class', color: 'text-red-400' };
}

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}

function StatCard({ icon, label, value, sub, accent = 'text-orange-400' }: StatCardProps) {
  return (
    <div className="bg-slate-800/60 border border-slate-700 rounded-2xl p-5 flex flex-col gap-2">
      <div className="flex items-center gap-2 text-slate-400 text-sm">
        {icon}
        <span>{label}</span>
      </div>
      <div className={`text-3xl font-bold ${accent}`}>{value}</div>
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

// Downsample chart data for performance
function downsample<T>(arr: T[], maxPoints: number): T[] {
  if (arr.length <= maxPoints) return arr;
  const step = Math.ceil(arr.length / maxPoints);
  return arr.filter((_, i) => i % step === 0);
}

export default function ResultsDisplay({ results, meta, onReset }: ResultsDisplayProps) {
  const { averageWatts, peakWatts, powerPoints, duration, totalDistance, elevationGain, avgSpeed, wPerKg } = results;

  const wkgInfo = getWPerKgLabel(wPerKg);

  // Build chart data
  const chartData = useMemo(() => {
    const raw = powerPoints.map(pp => ({
      time: parseFloat((pp.timeSeconds / 60).toFixed(1)),
      power: Math.round(pp.smoothedPower),
      speed: parseFloat((pp.speed * 3.6).toFixed(1))
    }));
    return downsample(raw, 800);
  }, [powerPoints]);

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm shadow-xl">
          <p className="text-slate-400 mb-1">{label} min</p>
          <p className="text-orange-400 font-semibold">{payload[0]?.value} W</p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-100">Analysis Results</h2>
          {meta?.name && (
            <p className="text-slate-400 mt-1">{meta.name}</p>
          )}
        </div>
        <button
          onClick={onReset}
          className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-xl transition-colors text-sm font-medium"
        >
          <RotateCcw size={14} />
          Reset
        </button>
      </div>

      {/* Primary Power Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-gradient-to-br from-orange-500/20 to-orange-600/10 border border-orange-500/30 rounded-2xl p-6 flex flex-col gap-2">
          <div className="flex items-center gap-2 text-orange-400 text-sm font-medium">
            <Zap size={16} />
            Average Power
          </div>
          <div className="text-5xl font-black text-orange-400">{averageWatts}</div>
          <div className="text-slate-400 text-sm">watts</div>
        </div>

        <div className="bg-gradient-to-br from-red-500/20 to-red-600/10 border border-red-500/30 rounded-2xl p-6 flex flex-col gap-2">
          <div className="flex items-center gap-2 text-red-400 text-sm font-medium">
            <TrendingUp size={16} />
            Peak Power (95th %ile)
          </div>
          <div className="text-5xl font-black text-red-400">{peakWatts}</div>
          <div className="text-slate-400 text-sm">watts</div>
        </div>

        <div className="bg-gradient-to-br from-green-500/20 to-green-600/10 border border-green-500/30 rounded-2xl p-6 flex flex-col gap-2">
          <div className="flex items-center gap-2 text-green-400 text-sm font-medium">
            <Gauge size={16} />
            Power to Weight
          </div>
          <div className="text-5xl font-black text-green-400">{wPerKg}</div>
          <div className={`text-sm font-medium ${wkgInfo.color}`}>{wkgInfo.label}</div>
          <div className="text-slate-400 text-xs">W/kg</div>
        </div>
      </div>

      {/* Secondary Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          icon={<Clock size={14} />}
          label="Duration"
          value={formatDuration(duration)}
          accent="text-blue-400"
        />
        <StatCard
          icon={<MapPin size={14} />}
          label="Distance"
          value={formatDistance(totalDistance)}
          accent="text-cyan-400"
        />
        <StatCard
          icon={<Mountain size={14} />}
          label="Elevation Gain"
          value={`${Math.round(elevationGain)} m`}
          accent="text-yellow-400"
        />
        <StatCard
          icon={<Gauge size={14} />}
          label="Avg Speed"
          value={formatSpeed(avgSpeed)}
          accent="text-purple-400"
        />
      </div>

      {/* Power Chart */}
      <div className="bg-slate-800/60 border border-slate-700 rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-slate-100 font-semibold">Power Over Time</h3>
          <span className="text-xs text-slate-500">30s rolling average · smoothed</span>
        </div>

        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis
                dataKey="time"
                stroke="#64748b"
                tick={{ fill: '#64748b', fontSize: 12 }}
                label={{ value: 'Time (min)', position: 'insideBottom', offset: -2, fill: '#64748b', fontSize: 12 }}
                height={40}
              />
              <YAxis
                stroke="#64748b"
                tick={{ fill: '#64748b', fontSize: 12 }}
                label={{ value: 'Power (W)', angle: -90, position: 'insideLeft', offset: 10, fill: '#64748b', fontSize: 12 }}
                width={55}
              />
              <Tooltip content={<CustomTooltip />} />
              <ReferenceLine
                y={averageWatts}
                stroke="#f97316"
                strokeDasharray="6 3"
                strokeWidth={1.5}
                label={{ value: `Avg ${averageWatts}W`, position: 'right', fill: '#f97316', fontSize: 11 }}
              />
              <Line
                type="monotone"
                dataKey="power"
                stroke="#f97316"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: '#f97316' }}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center h-64 text-slate-500">
            No chart data available
          </div>
        )}
      </div>

      {/* Methodology Note */}
      <div className="text-xs text-slate-600 bg-slate-800/40 rounded-xl px-4 py-3 space-y-1">
        <p className="font-medium text-slate-500">About this calculation</p>
        <p>Power is estimated using cycling physics (gravity + rolling resistance + aerodynamic drag) from GPS speed and elevation data. Results are estimates only — a power meter is needed for precise measurements. Peak power is the 95th percentile of smoothed values to reduce GPS noise.</p>
      </div>
    </div>
  );
}

import React from 'react';
import { ChevronDown } from 'lucide-react';
import { BikeState, TERRAIN_TYPES } from '../types';

interface BikeFormProps {
  state: BikeState;
  onChange: (state: BikeState) => void;
}

// Inline bike SVG icon
function BikeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-purple-400">
      <circle cx="5.5" cy="17.5" r="3.5" />
      <circle cx="18.5" cy="17.5" r="3.5" />
      <path d="M15 6a1 1 0 0 0-1-1h-1l-5 8.5" />
      <path d="M12 6h2l4 8.5M5.5 17.5l4-6.5M18.5 17.5L15 10" />
    </svg>
  );
}

export default function BikeForm({ state, onChange }: BikeFormProps) {
  const update = (patch: Partial<BikeState>) => onChange({ ...state, ...patch });

  const handleWeightUnitToggle = () => {
    const newUnit = state.weightUnit === 'kg' ? 'lbs' : 'kg';
    const newValue = newUnit === 'lbs'
      ? parseFloat((state.weightValue * 2.20462).toFixed(1))
      : parseFloat((state.weightValue / 2.20462).toFixed(1));
    update({ weightUnit: newUnit, weightValue: newValue });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 mb-1">
        <div className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center">
          <BikeIcon />
        </div>
        <h3 className="text-lg font-semibold text-slate-100">Bike Specs</h3>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        {/* Bike Weight */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-slate-300">
            Bike Weight
          </label>
          <div className="flex gap-2">
            <input
              type="number"
              min={1}
              max={50}
              step={0.1}
              value={state.weightValue}
              onChange={e => update({ weightValue: parseFloat(e.target.value) || 0 })}
              className="flex-1 bg-slate-800 border border-slate-600 rounded-xl px-4 py-3 text-slate-100 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition-colors"
            />
            <button
              type="button"
              onClick={handleWeightUnitToggle}
              className="px-4 py-3 bg-slate-700 hover:bg-slate-600 border border-slate-600 rounded-xl text-slate-300 font-medium transition-colors min-w-[64px]"
            >
              {state.weightUnit}
            </button>
          </div>
          <p className="text-xs text-slate-500">
            {state.weightUnit === 'lbs'
              ? `≈ ${(state.weightValue * 0.453592).toFixed(1)} kg`
              : `≈ ${(state.weightValue * 2.20462).toFixed(1)} lbs`}
          </p>
        </div>

        {/* Terrain / Tire Type */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-slate-300">
            Terrain / Tire Type
          </label>
          <div className="relative">
            <select
              value={state.terrainType}
              onChange={e => update({ terrainType: e.target.value as BikeState['terrainType'] })}
              className="w-full appearance-none bg-slate-800 border border-slate-600 rounded-xl px-4 py-3 text-slate-100 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition-colors pr-10"
            >
              {TERRAIN_TYPES.map(t => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          </div>
          <p className="text-xs text-slate-500">
            Crr: {TERRAIN_TYPES.find(t => t.value === state.terrainType)?.crr}
            {' · '}
            {state.terrainType === 'road' && 'Clincher or tubular slicks'}
            {state.terrainType === 'gravel' && 'Semi-slick or gravel tyres'}
            {state.terrainType === 'mountain' && 'Knobby MTB tyres'}
          </p>
        </div>
      </div>
    </div>
  );
}

import React from 'react';
import { User, ChevronDown } from 'lucide-react';
import { BiometricsState, RIDING_POSITIONS } from '../types';

interface BiometricsFormProps {
  state: BiometricsState;
  onChange: (state: BiometricsState) => void;
}

export default function BiometricsForm({ state, onChange }: BiometricsFormProps) {
  const update = (patch: Partial<BiometricsState>) => onChange({ ...state, ...patch });

  const handleWeightUnitToggle = () => {
    const newUnit = state.weightUnit === 'kg' ? 'lbs' : 'kg';
    // Convert current value to new unit for display continuity
    const newValue = newUnit === 'lbs'
      ? parseFloat((state.weightValue * 2.20462).toFixed(1))
      : parseFloat((state.weightValue / 2.20462).toFixed(1));
    update({ weightUnit: newUnit, weightValue: newValue });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 mb-1">
        <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center">
          <User size={16} className="text-green-400" />
        </div>
        <h3 className="text-lg font-semibold text-slate-100">Your Profile</h3>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        {/* Rider Weight */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-slate-300">
            Rider Weight
          </label>
          <div className="flex gap-2">
            <input
              type="number"
              min={20}
              max={300}
              step={0.1}
              value={state.weightValue}
              onChange={e => update({ weightValue: parseFloat(e.target.value) || 0 })}
              className="flex-1 bg-slate-800 border border-slate-600 rounded-xl px-4 py-3 text-slate-100 focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500 transition-colors"
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

        {/* Riding Position */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-slate-300">
            Riding Position
          </label>
          <div className="relative">
            <select
              value={state.ridingPosition}
              onChange={e => update({ ridingPosition: e.target.value as BiometricsState['ridingPosition'] })}
              className="w-full appearance-none bg-slate-800 border border-slate-600 rounded-xl px-4 py-3 text-slate-100 focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500 transition-colors pr-10"
            >
              {RIDING_POSITIONS.map(pos => (
                <option key={pos.value} value={pos.value}>
                  {pos.label}
                </option>
              ))}
            </select>
            <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          </div>
          <p className="text-xs text-slate-500">
            CdA: {RIDING_POSITIONS.find(p => p.value === state.ridingPosition)?.cda} m²
            {' · '}
            {state.ridingPosition === 'aggressive' && 'Tucked, drops or aero bars'}
            {state.ridingPosition === 'sport' && 'Hoods, moderate lean'}
            {state.ridingPosition === 'upright' && 'Tops, commuter or MTB'}
          </p>
        </div>
      </div>
    </div>
  );
}

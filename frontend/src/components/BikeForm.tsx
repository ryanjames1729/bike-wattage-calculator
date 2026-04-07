import React from 'react';
import { BikeState, BIKE_PRESETS } from '../types';

function BikeIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5.5" cy="17.5" r="3.5" />
      <circle cx="18.5" cy="17.5" r="3.5" />
      <path d="M15 6a1 1 0 0 0-1-1h-1l-5 8.5" />
      <path d="M12 6h2l4 8.5M5.5 17.5l4-6.5M18.5 17.5L15 10" />
    </svg>
  );
}

interface BikeFormProps {
  state: BikeState;
  onChange: (state: BikeState) => void;
}

export default function BikeForm({ state, onChange }: BikeFormProps) {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 mb-1">
        <div className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center text-purple-400">
          <BikeIcon />
        </div>
        <h3 className="text-lg font-semibold text-slate-100">Select Your Bike</h3>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {BIKE_PRESETS.map(preset => {
          const isSelected = state.bikePreset === preset.value;
          return (
            <button
              key={preset.value}
              type="button"
              onClick={() =>
                onChange({
                  bikePreset: preset.value as BikeState['bikePreset'],
                  weightValue: preset.weightValue,
                  weightUnit: preset.weightUnit,
                  terrainType: preset.terrainType,
                })
              }
              className={`text-left p-5 rounded-xl border-2 transition-all ${
                isSelected
                  ? 'border-purple-500 bg-purple-500/10'
                  : 'border-slate-600 bg-slate-800/40 hover:border-slate-500'
              }`}
            >
              <div className={`font-semibold text-base mb-1 ${isSelected ? 'text-purple-300' : 'text-slate-200'}`}>
                {preset.label}
              </div>
              <div className="text-sm text-slate-400">{preset.description}</div>
              <div className="mt-3 text-xs text-slate-500 space-y-0.5">
                <div>Weight: {preset.weightValue} {preset.weightUnit}</div>
                <div>Crr: {preset.terrainType === 'gravel' ? '0.006' : '0.010'}</div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

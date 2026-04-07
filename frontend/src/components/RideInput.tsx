import React, { useState, useRef, useCallback } from 'react';
import { Link, Upload, AlertCircle, ExternalLink } from 'lucide-react';
import { isStravaUrl, extractActivityId, initiateStravaOAuth, getStoredToken } from '../utils/stravaApi';
import { parseGpx, readFileAsText } from '../utils/gpxParser';
import { DataPoint } from '../types';

interface RideInputProps {
  onStravaConnect: (activityId: string) => void;
  onGpxLoaded: (points: DataPoint[], filename: string) => void;
}

export default function RideInput({ onStravaConnect, onGpxLoaded }: RideInputProps) {
  const [urlInput, setUrlInput] = useState('');
  const [urlError, setUrlError] = useState('');
  const [gpxError, setGpxError] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessingGpx, setIsProcessingGpx] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setUrlError('');

    const trimmed = urlInput.trim();
    if (!trimmed) {
      setUrlError('Please enter a Strava activity URL');
      return;
    }

    if (!isStravaUrl(trimmed)) {
      setUrlError('That doesn\'t look like a Strava activity URL. Expected format: https://www.strava.com/activities/12345678');
      return;
    }

    const activityId = extractActivityId(trimmed);
    if (!activityId) {
      setUrlError('Could not extract activity ID from URL');
      return;
    }

    // Check if we already have a token
    const existingToken = getStoredToken();
    if (existingToken) {
      onStravaConnect(activityId);
    } else {
      // Kick off OAuth flow
      initiateStravaOAuth(activityId);
    }
  };

  const processGpxFile = useCallback(async (file: File) => {
    setGpxError('');

    if (!file.name.toLowerCase().endsWith('.gpx')) {
      setGpxError('Please upload a .gpx file');
      return;
    }

    if (file.size > 50 * 1024 * 1024) {
      setGpxError('File is too large (max 50 MB)');
      return;
    }

    setIsProcessingGpx(true);
    try {
      const text = await readFileAsText(file);
      const points = parseGpx(text);
      onGpxLoaded(points, file.name);
    } catch (err) {
      setGpxError(err instanceof Error ? err.message : 'Failed to parse GPX file');
    } finally {
      setIsProcessingGpx(false);
    }
  }, [onGpxLoaded]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processGpxFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processGpxFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => setIsDragging(false);

  return (
    <div className="space-y-8">
      {/* Strava URL Input */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-full bg-orange-500/20 flex items-center justify-center">
            <Link size={16} className="text-orange-400" />
          </div>
          <h3 className="text-lg font-semibold text-slate-100">Paste Strava Activity URL</h3>
        </div>

        <form onSubmit={handleUrlSubmit} className="space-y-3">
          <div className="flex gap-3">
            <input
              type="text"
              value={urlInput}
              onChange={e => { setUrlInput(e.target.value); setUrlError(''); }}
              placeholder="https://www.strava.com/activities/12345678"
              className="flex-1 bg-slate-800 border border-slate-600 rounded-xl px-4 py-3 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 transition-colors"
            />
            <button
              type="submit"
              className="px-6 py-3 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-xl transition-colors whitespace-nowrap flex items-center gap-2"
            >
              <ExternalLink size={16} />
              Connect
            </button>
          </div>

          {urlError && (
            <div className="flex items-start gap-2 text-red-400 text-sm bg-red-400/10 rounded-lg px-3 py-2">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span>{urlError}</span>
            </div>
          )}
        </form>

        <p className="mt-2 text-xs text-slate-500">
          You'll be redirected to Strava to authorise read access. We never see your password.
        </p>
      </div>

      {/* Divider */}
      <div className="flex items-center gap-4">
        <div className="flex-1 h-px bg-slate-700" />
        <span className="text-slate-500 text-sm font-medium">OR</span>
        <div className="flex-1 h-px bg-slate-700" />
      </div>

      {/* GPX Upload */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center">
            <Upload size={16} className="text-blue-400" />
          </div>
          <h3 className="text-lg font-semibold text-slate-100">Upload GPX File</h3>
        </div>

        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
          className={`relative cursor-pointer border-2 border-dashed rounded-xl p-10 text-center transition-all ${
            isDragging
              ? 'border-orange-500 bg-orange-500/5'
              : 'border-slate-600 hover:border-slate-500 hover:bg-slate-800/50'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".gpx"
            onChange={handleFileChange}
            className="hidden"
          />

          {isProcessingGpx ? (
            <div className="space-y-2">
              <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-slate-400 text-sm">Parsing GPX file…</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="w-12 h-12 rounded-full bg-slate-700 flex items-center justify-center mx-auto">
                <Upload size={24} className="text-slate-400" />
              </div>
              <div>
                <p className="text-slate-300 font-medium">Drop your GPX file here</p>
                <p className="text-slate-500 text-sm mt-1">or click to browse</p>
              </div>
              <p className="text-xs text-slate-600">Supports GPX 1.1 • Max 50 MB</p>
            </div>
          )}
        </div>

        {gpxError && (
          <div className="mt-3 flex items-start gap-2 text-red-400 text-sm bg-red-400/10 rounded-lg px-3 py-2">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span>{gpxError}</span>
          </div>
        )}

        <p className="mt-2 text-xs text-slate-500">
          Export GPX from Strava, Garmin Connect, Wahoo, Komoot, or any GPS platform.
        </p>
      </div>
    </div>
  );
}

import React, { useState } from 'react';
import { useTelescopeStore } from '../../store/useTelescopeStore';
import { Telescope, Wrench, X, Calculator } from 'lucide-react';
import type { TelescopeProfile } from '../../types';

export const CustomTelescopeModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { addCustomProfile } = useTelescopeStore();
  
  const [name, setName] = useState('My Custom Scope');
  const [type, setType] = useState<'dobsonian' | 'refractor' | 'sct' | 'newtonian' | 'binoculars'>('newtonian');
  const [aperture, setAperture] = useState(130);
  const [focalLength, setFocalLength] = useState(650);

  // ── Mount + Orientation (Phase 55) ── Previously guessed from the optical
  // design (`type === 'dobsonian' ? 'Alt-Az' : 'Equatorial'`), which forced
  // EVERY custom refractor and pair of binoculars onto an Equatorial mount —
  // wrong for the common case (binoculars are hand-held/Alt-Az; small
  // refractors are frequently Alt-Az too). TYPE_DEFAULTS still seeds a
  // sensible starting value when the Optical Design changes, but the user
  // now owns the final call via the two dropdowns below.
  const TYPE_DEFAULTS: Record<typeof type, { mountType: 'Alt-Az' | 'Equatorial'; viewOrientation: 'inverted' | 'mirrored' }> = {
    dobsonian: { mountType: 'Alt-Az', viewOrientation: 'inverted' },
    newtonian: { mountType: 'Equatorial', viewOrientation: 'inverted' },
    refractor: { mountType: 'Alt-Az', viewOrientation: 'mirrored' },
    sct: { mountType: 'Equatorial', viewOrientation: 'mirrored' },
    binoculars: { mountType: 'Alt-Az', viewOrientation: 'mirrored' },
  };
  const [mountType, setMountType] = useState<'Alt-Az' | 'Equatorial'>(TYPE_DEFAULTS.newtonian.mountType);
  const [viewOrientation, setViewOrientation] = useState<'inverted' | 'mirrored'>(TYPE_DEFAULTS.newtonian.viewOrientation);

  const handleTypeChange = (newType: typeof type) => {
    setType(newType);
    setMountType(TYPE_DEFAULTS[newType].mountType);
    setViewOrientation(TYPE_DEFAULTS[newType].viewOrientation);
  };

  // Derived physics
  const focalRatio = aperture > 0 ? (focalLength / aperture) : 0;
  const maxMagnification = aperture * 2;

  // ── Validation (Phase 55) ── Guards the same three things a real optical
  // system can't tolerate: non-positive aperture/focal length (division by
  // zero or negative magnification downstream) and an f-ratio outside what
  // any real telescope built or sold, [1.0, 30.0] — catches typos like a
  // transposed aperture/focal-length pair before they reach the store.
  const isApertureValid = aperture > 0;
  const isFocalLengthValid = focalLength > 0;
  const isFocalRatioValid = focalRatio >= 1.0 && focalRatio <= 30.0;
  const isValid = isApertureValid && isFocalLengthValid && isFocalRatioValid;

  const TYPE_LABELS: Record<typeof type, TelescopeProfile['type']> = {
    dobsonian: 'Dobsonian',
    refractor: 'Refractor',
    sct: 'SCT',
    newtonian: 'Newtonian EQ',
    binoculars: 'Binoculars',
  };

  const handleSave = () => {
    if (!isValid) return;

    const newProfile: TelescopeProfile = {
      id: `custom_${Date.now()}`,
      name,
      type: TYPE_LABELS[type],
      aperture,
      focalLength,
      focalRatio: Number(focalRatio.toFixed(1)), // authoritative value is re-derived in useTelescopeStore.addCustomProfile
      centralObstruction: type === 'refractor' || type === 'binoculars' ? 0 : 15,
      viewOrientation,
      hasGoTo: false,
      mountType,
    };

    addCustomProfile(newProfile);
    onClose();

  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full shadow-2xl overflow-hidden flex flex-col font-sans">
        
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-800 to-slate-900 p-5 border-b border-slate-700 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="bg-amber-500/20 border border-amber-500/40 p-2.5 rounded-xl">
              <Wrench className="w-6 h-6 text-amber-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold bg-gradient-to-r from-amber-400 to-orange-400 bg-clip-text text-transparent uppercase tracking-widest">
                Equipment Garage
              </h2>
              <p className="text-[10px] text-slate-400 uppercase tracking-widest font-mono">Build Custom Telescope</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-700 transition-colors text-slate-400 hover:text-white shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 flex flex-col gap-5 overflow-y-auto max-h-[70vh]">
          
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Profile Name</label>
            <input 
              type="text" 
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bg-slate-950 border border-slate-700 rounded-lg px-4 py-2.5 text-sm font-bold text-white focus:outline-none focus:border-amber-500 transition-colors"
              placeholder="e.g. My 130EQ"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Optical Design</label>
            <select
              value={type}
              onChange={(e) => handleTypeChange(e.target.value as typeof type)}
              className="bg-slate-950 border border-slate-700 rounded-lg px-4 py-2.5 text-sm font-bold text-white focus:outline-none focus:border-amber-500 transition-colors cursor-pointer appearance-none"
            >
              <option value="dobsonian">Dobsonian (Reflector)</option>
              <option value="newtonian">Newtonian EQ (Reflector)</option>
              <option value="refractor">Refractor</option>
              <option value="sct">Schmidt-Cassegrain (SCT)</option>
              <option value="binoculars">Binoculars</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Mount Type</label>
              <select
                value={mountType}
                onChange={(e) => setMountType(e.target.value as 'Alt-Az' | 'Equatorial')}
                className="bg-slate-950 border border-slate-700 rounded-lg px-4 py-2.5 text-sm font-bold text-white focus:outline-none focus:border-amber-500 transition-colors cursor-pointer appearance-none"
              >
                <option value="Alt-Az">Alt-Az</option>
                <option value="Equatorial">Equatorial</option>
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Orientation</label>
              <select
                value={viewOrientation}
                onChange={(e) => setViewOrientation(e.target.value as 'inverted' | 'mirrored')}
                className="bg-slate-950 border border-slate-700 rounded-lg px-4 py-2.5 text-sm font-bold text-white focus:outline-none focus:border-amber-500 transition-colors cursor-pointer appearance-none"
              >
                <option value="inverted">Inverted (180°)</option>
                <option value="mirrored">Mirrored (left-right)</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Aperture (mm)</label>
              <input 
                type="number" 
                value={aperture}
                onChange={(e) => setAperture(Number(e.target.value))}
                min="50" max="1000"
                className="bg-slate-950 border border-slate-700 rounded-lg px-4 py-2.5 text-sm font-bold text-white focus:outline-none focus:border-amber-500 transition-colors font-mono"
              />
            </div>
            
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Focal Length (mm)</label>
              <input 
                type="number" 
                value={focalLength}
                onChange={(e) => setFocalLength(Number(e.target.value))}
                min="200" max="10000"
                className="bg-slate-950 border border-slate-700 rounded-lg px-4 py-2.5 text-sm font-bold text-white focus:outline-none focus:border-amber-500 transition-colors font-mono"
              />
            </div>
          </div>

          {/* Physics Preview */}
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 mt-2">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-cyan-400 mb-3 flex items-center gap-2">
              <Calculator className="w-3.5 h-3.5" /> Optical Physics Preview
            </h3>

            <div className="flex justify-between items-end border-b border-slate-700/50 pb-2 mb-2">
              <span className="text-xs text-slate-400">Focal Ratio (Speed)</span>
              <span className={`font-mono text-sm font-bold ${isFocalRatioValid ? 'text-slate-200' : 'text-red-400'}`}>
                f/{focalRatio.toFixed(1)}
              </span>
            </div>

            <div className="flex justify-between items-end">
              <span className="text-xs text-slate-400">Max Useful Magnification</span>
              <span className="font-mono text-sm font-bold text-slate-200">{maxMagnification}x</span>
            </div>
          </div>

          {!isValid && (
            <p className="text-xs text-red-400 -mt-2">
              {!isApertureValid ? 'Aperture must be greater than 0.'
                : !isFocalLengthValid ? 'Focal length must be greater than 0.'
                : `f/${focalRatio.toFixed(1)} is outside the buildable range (f/1.0–f/30.0) — check your aperture and focal length.`}
            </p>
          )}

        </div>

        {/* Footer Actions */}
        <div className="p-5 border-t border-slate-800 bg-slate-900/50">
          <button
            onClick={handleSave}
            disabled={!isValid}
            title={isValid ? undefined : 'Fix the highlighted values before saving.'}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold uppercase tracking-widest text-xs transition-colors shadow-lg shadow-amber-900/20 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-amber-600"
          >
            <Telescope className="w-4 h-4" /> Save to Garage
          </button>
        </div>

      </div>
    </div>
  );
};

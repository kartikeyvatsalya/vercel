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

  // Derived physics
  const focalRatio = aperture > 0 ? (focalLength / aperture) : 0;
  const maxMagnification = aperture * 2;

  const TYPE_LABELS: Record<typeof type, TelescopeProfile['type']> = {
    dobsonian: 'Dobsonian',
    refractor: 'Refractor',
    sct: 'SCT',
    newtonian: 'Newtonian EQ',
    binoculars: 'Binoculars',
  };

  const handleSave = () => {
    const newProfile: TelescopeProfile = {
      id: `custom_${Date.now()}`,
      name,
      type: TYPE_LABELS[type],
      aperture,
      focalLength,
      focalRatio: Number(focalRatio.toFixed(1)),
      centralObstruction: type === 'refractor' || type === 'binoculars' ? 0 : 15,
      isInvertedView: type === 'dobsonian' || type === 'newtonian',
      hasGoTo: false,
      mountType: type === 'dobsonian' ? 'Alt-Az' : 'Equatorial', // Simplification
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
              onChange={(e) => setType(e.target.value as any)}
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
              <span className="font-mono text-sm font-bold text-slate-200">f/{focalRatio.toFixed(1)}</span>
            </div>
            
            <div className="flex justify-between items-end">
              <span className="text-xs text-slate-400">Max Useful Magnification</span>
              <span className="font-mono text-sm font-bold text-slate-200">{maxMagnification}x</span>
            </div>
          </div>

        </div>

        {/* Footer Actions */}
        <div className="p-5 border-t border-slate-800 bg-slate-900/50">
          <button
            onClick={handleSave}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold uppercase tracking-widest text-xs transition-colors shadow-lg shadow-amber-900/20"
          >
            <Telescope className="w-4 h-4" /> Save to Garage
          </button>
        </div>

      </div>
    </div>
  );
};

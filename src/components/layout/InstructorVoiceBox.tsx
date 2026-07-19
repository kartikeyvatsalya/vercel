import React, { useState, useEffect, useRef } from 'react';
import type { InstructorResponse } from '../../types';
import { AlertTriangle, Info, CheckCircle2, Mic, X, ChevronUp, GripHorizontal } from 'lucide-react';

interface InstructorVoiceBoxProps {
  response: InstructorResponse | null;
}

export const InstructorVoiceBox: React.FC<InstructorVoiceBoxProps> = ({ response }) => {
  const [isMinimized, setIsMinimized] = useState(false);
  const prevSeverityRef = useRef<string | null>(null);

  // ── Dragging State ──
  const [position, setPosition] = useState({ x: 20, y: 20 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartPos = useRef({ x: 0, y: 0 });
  const boxStartPos = useRef({ x: 20, y: 20 });
  // True once the pointer has moved past a click's worth of travel during
  // the current drag — lets the minimized pill be BOTH draggable and
  // clickable (Phase 33): a genuine drag must not also expand it on release.
  const hasDraggedRef = useRef(false);

  // Auto-expand on critical hazards, even if user had minimized
  useEffect(() => {
    if (!response) return;
    if (response.severity === 'critical' && prevSeverityRef.current !== 'critical') {
      setIsMinimized(false);
    }
    prevSeverityRef.current = response.severity;
  }, [response]);

  // Dragging logic — shared math for mouse and touch. Touch doesn't need
  // window-level move/up listeners the way mouse does: once a touch begins
  // on an element, its move/end events keep targeting that same element for
  // the whole gesture (unlike mouse events, which retarget to whatever's
  // currently under the cursor), so the touch handlers below are wired
  // directly on the drag handles instead.
  const updateDragPosition = (clientX: number, clientY: number) => {
    const dx = clientX - dragStartPos.current.x;
    const dy = clientY - dragStartPos.current.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) hasDraggedRef.current = true;

    // Keep within window bounds (approximate sizing)
    const newX = Math.max(0, Math.min(window.innerWidth - 300, boxStartPos.current.x + dx));
    const newY = Math.max(0, Math.min(window.innerHeight - 100, boxStartPos.current.y + dy));

    setPosition({ x: newX, y: newY });
  };

  const beginDrag = (clientX: number, clientY: number) => {
    setIsDragging(true);
    hasDraggedRef.current = false;
    dragStartPos.current = { x: clientX, y: clientY };
    boxStartPos.current = { ...position };
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      updateDragPosition(e.clientX, e.clientY);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  const handleMouseDown = (e: React.MouseEvent) => {
    beginDrag(e.clientX, e.clientY);
  };

  // ── Touch drag (Phase 36) ── preventDefault on start/move stops Safari
  // from scrolling the page instead of moving the badge; it also suppresses
  // the browser's synthetic click that would otherwise fire after a tap, so
  // the minimized pill replicates its own tap-to-expand below instead of
  // relying on that click.
  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (!touch) return;
    e.preventDefault();
    beginDrag(touch.clientX, touch.clientY);
  };
  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging) return;
    const touch = e.touches[0];
    if (!touch) return;
    e.preventDefault();
    updateDragPosition(touch.clientX, touch.clientY);
  };
  const handleTouchEnd = () => setIsDragging(false);

  if (!response) return null;

  const getSeverityStyles = (severity: string) => {
    switch (severity) {
      case 'critical':
        return 'bg-red-950/90 border-red-500 text-red-100 shadow-[0_0_15px_rgba(239,68,68,0.5)] animate-pulse';
      case 'warning':
        return 'bg-amber-950/80 border-amber-500 text-amber-100 shadow-xl';
      case 'success':
        return 'bg-emerald-950/80 border-emerald-500 text-emerald-100 shadow-[0_0_10px_rgba(16,185,129,0.3)]';
      case 'info':
      default:
        return 'bg-slate-900/90 border-slate-600 text-slate-200 shadow-xl';
    }
  };

  const getIndicatorColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'bg-red-500';
      case 'warning': return 'bg-amber-500';
      case 'success': return 'bg-emerald-500';
      case 'info':
      default: return 'bg-blue-400';
    }
  };

  const getIcon = (severity: string) => {
    switch (severity) {
      case 'critical':
        return <AlertTriangle className="w-5 h-5 text-red-500" />;
      case 'warning':
        return <Info className="w-5 h-5 text-amber-500" />;
      case 'success':
        return <CheckCircle2 className="w-5 h-5 text-emerald-500" />;
      case 'info':
      default:
        return <Mic className="w-5 h-5 text-blue-400" />;
    }
  };

  // ── Minimized Pill ──
  // Phase 33: the pill shares the SAME drag handler as the expanded header,
  // so the box can be repositioned while minimized. A drag past the click
  // threshold suppresses the release-click so dragging never accidentally
  // re-expands it.
  if (isMinimized) {
    // preventDefault in handleTouchStart suppresses the browser's synthetic
    // click for touch, so a genuine tap (no drag) must expand here instead —
    // mirrors the onClick's hasDraggedRef check below, for touch.
    const handlePillTouchEnd = (e: React.TouchEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (!hasDraggedRef.current) setIsMinimized(false);
    };
    return (
      <div
        style={{ left: position.x, top: position.y, position: 'fixed', zIndex: 9999 }}
        className={`pointer-events-auto ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handlePillTouchEnd}
        onTouchCancel={handleTouchEnd}
        title="Drag to move · click to expand"
      >
        <button
          onClick={() => {
            if (hasDraggedRef.current) return; // was a drag, not a click
            setIsMinimized(false);
          }}
          className={`flex items-center gap-2 px-4 py-2 rounded-full backdrop-blur-md border transition-all duration-300 hover:scale-105 shadow-xl ${getSeverityStyles(response.severity)}`}
        >
          <div className="relative flex items-center">
            <div className={`w-2 h-2 rounded-full animate-ping absolute ${getIndicatorColor(response.severity)}`} />
            <div className={`w-2 h-2 rounded-full ${getIndicatorColor(response.severity)}`} />
          </div>
          <Mic className="w-3.5 h-3.5 opacity-80" />
          <span className="text-[10px] font-bold uppercase tracking-widest opacity-80">Instructor Live</span>
          <ChevronUp className="w-3.5 h-3.5 opacity-60" />
        </button>
      </div>
    );
  }

  // ── Full Floating Banner ──
  return (
    <div 
      style={{ left: position.x, top: position.y, position: 'fixed', zIndex: 9999 }}
      className={`pointer-events-auto w-[90vw] max-w-[500px] border-2 rounded-2xl backdrop-blur-md flex flex-col transition-colors duration-300 shadow-2xl ${getSeverityStyles(response.severity)}`}
      role="alert"
      aria-live="assertive"
    >
      {/* Draggable Header */}
      <div
        className="flex items-center justify-between p-2 border-b border-white/10 cursor-move bg-black/20 rounded-t-xl hover:bg-black/30 transition-colors"
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        <div className="flex items-center gap-2 text-[10px] uppercase font-mono tracking-widest opacity-60 ml-2">
          <GripHorizontal className="w-3 h-3" />
          <span>Instructor Panel</span>
        </div>

        <div className="flex items-center gap-3 mr-2">
          <span className="text-[10px] uppercase font-mono tracking-widest opacity-60">Live</span>
          <div className="relative flex items-center">
            <div className={`w-2 h-2 rounded-full animate-ping absolute ${getIndicatorColor(response.severity)}`} />
            <div className={`w-2 h-2 rounded-full ${getIndicatorColor(response.severity)}`} />
          </div>
          {/* Minimize button — disabled during critical hazards */}
          {response.severity !== 'critical' && (
            <button
              onClick={(e) => { e.stopPropagation(); setIsMinimized(true); }}
              onTouchStart={(e) => e.stopPropagation()} // don't let the header's drag swallow this tap
              className="p-1 rounded hover:bg-white/20 transition-colors opacity-80 hover:opacity-100 cursor-pointer"
              aria-label="Minimize instructor panel"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Content Body */}
      <div className="p-4 flex items-start gap-4">
        <div className="shrink-0 mt-1 bg-black/40 p-2 rounded-full border border-white/10">
          {getIcon(response.severity)}
        </div>
        
        <div className="flex-1 pr-2">
          <h4 className="font-bold text-sm tracking-wide uppercase mb-1 opacity-90">{response.title}</h4>
          <p className="text-base font-medium leading-relaxed drop-shadow-sm">{response.message.text}</p>
          {response.hint && (
            <p className="text-sm mt-2 italic opacity-75 border-t border-white/10 pt-2 flex items-center gap-2">
              <Info className="w-3 h-3" /> {response.hint}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

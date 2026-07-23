import React, { useRef, useState, useCallback, useEffect } from 'react';
import { OverlayType } from '../types';
import LivePlayer from './LivePlayer';

const CANVAS_W = 1920;
const CANVAS_H = 1080;

interface OverlayElement {
  type: OverlayType;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  imageUrl?: string;
  text?: string;
  fontSize?: number;
  fontColor?: string;
  opacity?: number;
}

interface OverlayPreviewProps {
  overlay: OverlayElement;
  onChange: (pos: { x: number; y: number }) => void;
  canvasWidth?: number;
  canvasHeight?: number;
  backgroundStreamUrl?: string;
  onBackgroundVideoMeta?: (meta: { width: number; height: number }) => void;
}

export default function OverlayPreview({
  overlay,
  onChange,
  canvasWidth = CANVAS_W,
  canvasHeight = CANVAS_H,
  backgroundStreamUrl,
  onBackgroundVideoMeta,
}: OverlayPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [containerRect, setContainerRect] = useState<DOMRect | null>(null);

  const updateRect = useCallback(() => {
    if (containerRef.current) {
      setContainerRect(containerRef.current.getBoundingClientRect());
    }
  }, []);

  useEffect(() => {
    updateRect();
    window.addEventListener('resize', updateRect);
    return () => window.removeEventListener('resize', updateRect);
  }, [updateRect]);

  const scale = containerRect ? containerRect.width / canvasWidth : 1;

  const toScreen = (val: number) => val * scale;
  const toCanvas = (val: number) => val / scale;

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    updateRect();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const elX = toScreen(overlay.x);
    const elY = toScreen(overlay.y);

    setDragOffset({ x: mouseX - elX, y: mouseY - elY });
    setDragging(true);
  };

  useEffect(() => {
    if (!dragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      let newX = toCanvas(e.clientX - rect.left - dragOffset.x);
      let newY = toCanvas(e.clientY - rect.top - dragOffset.y);

      newX = Math.max(0, Math.min(canvasWidth - overlay.width, newX));
      newY = Math.max(0, Math.min(canvasHeight - overlay.height, newY));

      onChange({ x: Math.round(newX), y: Math.round(newY) });
    };

    const handleMouseUp = () => setDragging(false);

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragging, dragOffset, overlay.width, overlay.height, onChange, toCanvas]);

  const handleCanvasClick = (e: React.MouseEvent) => {
    if (dragging) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    let newX = toCanvas(e.clientX - rect.left) - overlay.width / 2;
    let newY = toCanvas(e.clientY - rect.top) - overlay.height / 2;
    newX = Math.max(0, Math.min(canvasWidth - overlay.width, newX));
    newY = Math.max(0, Math.min(canvasHeight - overlay.height, newY));
    onChange({ x: Math.round(newX), y: Math.round(newY) });
  };

  const renderOverlayElement = () => {
    const style: React.CSSProperties = {
      position: 'absolute',
      left: toScreen(overlay.x),
      top: toScreen(overlay.y),
      width: toScreen(overlay.width),
      height: toScreen(overlay.height),
      cursor: dragging ? 'grabbing' : 'grab',
      userSelect: 'none',
    };

    if (overlay.type === 'LOGO' || overlay.type === 'WATERMARK') {
      return (
        <div
          onMouseDown={handleMouseDown}
          style={{
            ...style,
            opacity: overlay.type === 'WATERMARK' ? (overlay.opacity ?? 0.5) : 1,
            border: '2px dashed rgba(255,255,255,0.5)',
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            background: 'rgba(0,0,0,0.3)',
          }}
        >
          {overlay.imageUrl ? (
            <img
              src={overlay.imageUrl}
              alt="overlay"
              style={{ width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none' }}
              draggable={false}
            />
          ) : (
            <span style={{ color: '#888', fontSize: toScreen(20), whiteSpace: 'nowrap' }}>
              {overlay.type === 'LOGO' ? 'LOGO' : 'WM'}
            </span>
          )}
        </div>
      );
    }

    if (overlay.type === 'SCROLLING_TEXT') {
      const fontSize = toScreen(overlay.fontSize || 24);
      return (
        <div
          onMouseDown={handleMouseDown}
          style={{
            ...style,
            border: '1px dashed rgba(255,255,255,0.3)',
            display: 'flex',
            alignItems: 'center',
            overflow: 'hidden',
            background: 'rgba(0,0,0,0.4)',
            paddingLeft: toScreen(20),
          }}
        >
          <span style={{
            color: overlay.fontColor || 'white',
            fontSize,
            whiteSpace: 'nowrap',
            fontWeight: 600,
          }}>
            {overlay.text || 'Scrolling text...'}
          </span>
        </div>
      );
    }

    if (overlay.type === 'LIVE_BADGE') {
      const fontSize = toScreen(overlay.fontSize || 24);
      return (
        <div
          onMouseDown={handleMouseDown}
          style={{
            ...style,
            background: 'rgba(220,38,38,0.85)',
            borderRadius: toScreen(6),
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '2px dashed rgba(255,255,255,0.4)',
          }}
        >
          <span style={{ color: 'white', fontWeight: 700, fontSize, letterSpacing: 1 }}>
            LIVE
          </span>
        </div>
      );
    }

    if (overlay.type === 'CLOCK') {
      const fontSize = toScreen(overlay.fontSize || 24);
      return (
        <div
          onMouseDown={handleMouseDown}
          style={{
            ...style,
            background: 'rgba(0,0,0,0.5)',
            borderRadius: toScreen(6),
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '2px dashed rgba(255,255,255,0.4)',
          }}
        >
          <span style={{
            color: overlay.fontColor || 'white',
            fontWeight: 600,
            fontSize,
            fontFamily: 'monospace',
          }}>
            12:34:56
          </span>
        </div>
      );
    }

    return null;
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500 font-medium">Preview ({canvasWidth} x {canvasHeight})</span>
        <span className="text-xs text-gray-600 font-mono">
          x: {overlay.x} &nbsp; y: {overlay.y}
        </span>
      </div>
      <div
        ref={containerRef}
        onClick={handleCanvasClick}
        className="relative w-full bg-[#0a0a0a] border border-[#333] rounded-lg overflow-hidden"
        style={{ aspectRatio: `${canvasWidth} / ${canvasHeight}` }}
      >
        {backgroundStreamUrl ? (
          <div className="absolute inset-0 pointer-events-none">
            <LivePlayer
              src={backgroundStreamUrl}
              autoPlay
              controls={false}
              onVideoMeta={onBackgroundVideoMeta}
            />
          </div>
        ) : null}

        {/* Grid lines */}
        <div className="absolute inset-0 pointer-events-none" style={{
          backgroundImage: `
            linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)
          `,
          backgroundSize: `${toScreen(canvasWidth / 6)}px ${toScreen(canvasHeight / 6)}px`,
        }} />

        {/* Safe zone indicator */}
        <div className="absolute pointer-events-none border border-dashed border-yellow-500/15 rounded"
          style={{
            left: toScreen(96),
            top: toScreen(54),
            right: toScreen(96),
            bottom: toScreen(54),
          }}
        />

        {/* Center crosshair */}
        <div className="absolute pointer-events-none" style={{
          left: toScreen(canvasWidth / 2) - 1,
          top: toScreen(canvasHeight / 2 - 20),
          width: 1,
          height: toScreen(40),
          background: 'rgba(255,255,255,0.08)',
        }} />
        <div className="absolute pointer-events-none" style={{
          left: toScreen(canvasWidth / 2 - 20),
          top: toScreen(canvasHeight / 2) - 1,
          width: toScreen(40),
          height: 1,
          background: 'rgba(255,255,255,0.08)',
        }} />

        {/* The overlay element */}
        {renderOverlayElement()}

        {/* Label */}
        <div className="absolute bottom-1 left-2 pointer-events-none">
          <span className="text-[10px] text-gray-700">Click or drag to position</span>
        </div>
      </div>
    </div>
  );
}

export type { OverlayElement };
export { CANVAS_W, CANVAS_H };

"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { X, ZoomIn, ZoomOut, RotateCcw, Check, Sparkles, Move } from "lucide-react";
import { CuteButton } from "./CuteButton";

interface AvatarCropModalProps {
  isOpen: boolean;
  imageSrc: string | null;
  onClose: () => void;
  onCropComplete: (croppedBlob: Blob) => void;
}

export const AvatarCropModal: React.FC<AvatarCropModalProps> = ({
  isOpen,
  imageSrc,
  onClose,
  onCropComplete,
}) => {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [initialDistance, setInitialDistance] = useState<number | null>(null);
  const [imageNaturalSize, setImageNaturalSize] = useState({ width: 0, height: 0 });

  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const CROP_SIZE = 240; // Diameter of circular crop box in px

  // Reset state when opening a new image
  useEffect(() => {
    if (isOpen && imageSrc) {
      setScale(1);
      setPosition({ x: 0, y: 0 });
    }
  }, [isOpen, imageSrc]);

  // Handle natural image load
  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setImageNaturalSize({ width: img.naturalWidth, height: img.naturalHeight });
    // Fit smallest side to crop size
    const minDim = Math.min(img.naturalWidth, img.naturalHeight);
    const initialScale = minDim > 0 ? Math.max(1, (CROP_SIZE * 1.2) / minDim) : 1;
    setScale(initialScale);
    setPosition({ x: 0, y: 0 });
  };

  // Touch handlers for mobile pan & pinch-to-zoom
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      setIsDragging(true);
      setDragStart({
        x: e.touches[0].clientX - position.x,
        y: e.touches[0].clientY - position.y,
      });
    } else if (e.touches.length === 2) {
      setIsDragging(false);
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      setInitialDistance(dist);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 1 && isDragging) {
      setPosition({
        x: e.touches[0].clientX - dragStart.x,
        y: e.touches[0].clientY - dragStart.y,
      });
    } else if (e.touches.length === 2 && initialDistance !== null) {
      const currentDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const diff = currentDist - initialDistance;
      const newScale = Math.min(Math.max(0.5, scale + diff * 0.005), 4);
      setScale(newScale);
      setInitialDistance(currentDist);
    }
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
    setInitialDistance(null);
  };

  // Mouse handlers for desktop pan
  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setDragStart({
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setPosition({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Wheel zoom
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY * -0.0015;
    setScale((s) => Math.min(Math.max(0.4, s + delta), 4));
  };

  // Crop & export
  const handleCropConfirm = useCallback(() => {
    if (!imgRef.current) return;

    const img = imgRef.current;
    const canvas = document.createElement("canvas");
    const OUTPUT_SIZE = 400; // High-res avatar output 400x400
    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Background circle clip for anti-aliasing
    ctx.beginPath();
    ctx.arc(OUTPUT_SIZE / 2, OUTPUT_SIZE / 2, OUTPUT_SIZE / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();

    // Calculate mapping from screen CROP_SIZE to original image
    const rect = img.getBoundingClientRect();
    const ratio = OUTPUT_SIZE / CROP_SIZE;

    // Center offset of image relative to crop circle center
    const displayedWidth = rect.width;
    const displayedHeight = rect.height;

    // Image center relative to crop box center on screen
    const offsetX = position.x * ratio;
    const offsetY = position.y * ratio;

    const drawWidth = displayedWidth * ratio;
    const drawHeight = displayedHeight * ratio;

    const destX = OUTPUT_SIZE / 2 - drawWidth / 2 + offsetX;
    const destY = OUTPUT_SIZE / 2 - drawHeight / 2 + offsetY;

    ctx.drawImage(img, destX, destY, drawWidth, drawHeight);

    canvas.toBlob(
      (blob) => {
        if (blob) {
          onCropComplete(blob);
        }
      },
      "image/jpeg",
      0.92
    );
  }, [position, scale, onCropComplete]);

  if (!isOpen || !imageSrc) return null;

  return (
    <div className="fixed inset-0 z-[120] bg-black/85 backdrop-blur-md flex flex-col justify-between p-4 animate-fade-in select-none touch-none">
      {/* Header */}
      <div className="flex items-center justify-between text-white pt-2 px-2">
        <div className="flex items-center gap-1.5">
          <Sparkles size={18} className="text-primary-soft" />
          <h3 className="text-base font-bold">调整宝宝头像</h3>
        </div>
        <button
          onClick={onClose}
          className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors"
        >
          <X size={18} />
        </button>
      </div>

      {/* Guide text */}
      <div className="text-center">
        <span className="inline-flex items-center gap-1 text-xs text-white/80 bg-white/10 px-3 py-1 rounded-full backdrop-blur-sm">
          <Move size={12} />
          手指拖动调整位置 · 双指或滑块缩放大小
        </span>
      </div>

      {/* Interactive Crop Viewport Area */}
      <div
        ref={containerRef}
        className="relative w-full h-[320px] max-w-[360px] mx-auto overflow-hidden rounded-3xl flex items-center justify-center bg-black/40 cursor-grab active:cursor-grabbing"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onWheel={handleWheel}
      >
        {/* Moving Image */}
        <div
          className="absolute"
          style={{
            transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
            transition: isDragging ? "none" : "transform 0.05s ease-out",
          }}
        >
          <img
            ref={imgRef}
            src={imageSrc}
            alt="待裁剪头像"
            onLoad={handleImageLoad}
            className="max-w-none pointer-events-none"
            style={{
              maxHeight: "360px",
              maxWidth: "360px",
              objectFit: "contain",
            }}
          />
        </div>

        {/* Dark mask outside circular viewport */}
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
          <div
            className="rounded-full border-2 border-primary shadow-[0_0_0_9999px_rgba(0,0,0,0.65)] relative"
            style={{
              width: `${CROP_SIZE}px`,
              height: `${CROP_SIZE}px`,
            }}
          >
            {/* Crosshair guidelines */}
            <div className="absolute inset-0 border border-white/20 rounded-full" />
            <div className="absolute top-1/2 left-0 right-0 h-px bg-white/20 -translate-y-1/2" />
            <div className="absolute left-1/2 top-0 bottom-0 w-px bg-white/20 -translate-x-1/2" />
          </div>
        </div>
      </div>

      {/* Controls & Action Buttons */}
      <div className="space-y-4 max-w-sm mx-auto w-full pb-3">
        {/* Zoom Slider Control */}
        <div className="flex items-center gap-3 bg-white/10 px-4 py-2.5 rounded-2xl backdrop-blur-md">
          <button
            type="button"
            onClick={() => setScale((s) => Math.max(0.4, s - 0.15))}
            className="text-white/80 hover:text-white p-1"
            title="缩小"
          >
            <ZoomOut size={18} />
          </button>
          <input
            type="range"
            min={0.4}
            max={3.5}
            step={0.05}
            value={scale}
            onChange={(e) => setScale(parseFloat(e.target.value))}
            className="flex-1 accent-primary h-1.5 bg-white/20 rounded-lg cursor-pointer"
          />
          <button
            type="button"
            onClick={() => setScale((s) => Math.min(3.5, s + 0.15))}
            className="text-white/80 hover:text-white p-1"
            title="放大"
          >
            <ZoomIn size={18} />
          </button>
          <button
            type="button"
            onClick={() => {
              setScale(1);
              setPosition({ x: 0, y: 0 });
            }}
            className="text-white/60 hover:text-white pl-2 border-l border-white/20 text-xs flex items-center gap-0.5"
            title="重置"
          >
            <RotateCcw size={14} />
          </button>
        </div>

        {/* Confirm / Cancel Buttons */}
        <div className="flex gap-2.5">
          <CuteButton
            variant="secondary"
            size="lg"
            className="flex-1 bg-white/15 text-white border-white/20 hover:bg-white/25"
            onClick={onClose}
          >
            取消
          </CuteButton>
          <CuteButton
            variant="primary"
            size="lg"
            className="flex-1 shadow-elevated"
            onClick={handleCropConfirm}
          >
            <Check size={18} className="mr-1.5" />
            确定裁剪头像
          </CuteButton>
        </div>
      </div>
    </div>
  );
};

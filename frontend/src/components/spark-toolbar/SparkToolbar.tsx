/**
 * SPARK Toolbar — Bottom control bar with drawing tools, media controls, and FAB
 * Inspired by Material Design Expressive with pill-shaped container and accent FAB
 */

import React, { memo, useState } from "react";
import cn from "classnames";
import { DrawTool } from "../spark-canvas/SparkCanvas";
import { UseMediaStreamResult } from "../../hooks/use-media-stream-mux";
import "./spark-toolbar.scss";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SparkToolbarProps {
  // Connection
  connected: boolean;
  onConnect: () => void;
  onDisconnect: () => void;

  // Drawing tools
  activeTool: DrawTool;
  onToolChange: (tool: DrawTool) => void;
  penColor: string;
  onColorChange: (color: string) => void;
  penSize: number;
  onSizeChange: (size: number) => void;
  onClearCanvas: () => void;

  // Mic
  muted: boolean;
  onToggleMute: () => void;

  // Video streams
  webcam: UseMediaStreamResult;
  screenCapture: UseMediaStreamResult;
  onChangeStream: (next?: UseMediaStreamResult) => () => Promise<void>;

  // Misc
  inputVolume: number;
  outputVolume: number;
}

// ─── Preset colors ─────────────────────────────────────────────────────────────

const PEN_COLORS = [
  { value: "#F3F0FF", label: "White" },
  { value: "#A78BFA", label: "Purple" },
  { value: "#FF8A65", label: "Coral" },
  { value: "#34D399", label: "Mint" },
  { value: "#60A5FA", label: "Blue" },
  { value: "#FBBF24", label: "Amber" },
  { value: "#F87171", label: "Red" },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

const ToolButton = memo(function ToolButton({
  icon,
  label,
  active,
  accent,
  onClick,
}: {
  icon: string;
  label: string;
  active?: boolean;
  accent?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={cn("spark-tool-btn", { "spark-tool-btn--active": active, "spark-tool-btn--accent": accent })}
      onClick={onClick}
      title={label}
      aria-label={label}
    >
      <span className="material-symbols-outlined">{icon}</span>
    </button>
  );
});

// ─── Toolbar ──────────────────────────────────────────────────────────────────

function SparkToolbar({
  connected,
  onConnect,
  onDisconnect,
  activeTool,
  onToolChange,
  penColor,
  onColorChange,
  penSize,
  onSizeChange,
  onClearCanvas,
  muted,
  onToggleMute,
  webcam,
  screenCapture,
  onChangeStream,
  inputVolume,
  outputVolume,
}: SparkToolbarProps) {
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showSizePicker, setShowSizePicker] = useState(false);

  return (
    <div className="spark-toolbar">
      {/* Drawing tools group */}
      <div className="spark-toolbar__group spark-toolbar__group--tools">
        <ToolButton
          icon="edit"
          label="Pen"
          active={activeTool === "pen"}
          onClick={() => { onToolChange("pen"); setShowColorPicker(false); setShowSizePicker(false); }}
        />
        <ToolButton
          icon="ink_eraser"
          label="Eraser"
          active={activeTool === "eraser"}
          onClick={() => { onToolChange("eraser"); setShowColorPicker(false); setShowSizePicker(false); }}
        />

        {/* Color picker toggle */}
        <div className="spark-toolbar__color-wrap">
          <button
            className={cn("spark-tool-btn spark-tool-btn--color", { "spark-tool-btn--active": showColorPicker })}
            onClick={() => { setShowColorPicker((v) => !v); setShowSizePicker(false); }}
            title="Pen color"
            aria-label="Pick pen color"
          >
            <span
              className="spark-tool-btn__color-dot"
              style={{ background: penColor }}
            />
          </button>
          {showColorPicker && (
            <div className="spark-color-picker">
              {PEN_COLORS.map((c) => (
                <button
                  key={c.value}
                  className={cn("spark-color-swatch", { "spark-color-swatch--active": penColor === c.value })}
                  style={{ background: c.value }}
                  onClick={() => { onColorChange(c.value); setShowColorPicker(false); }}
                  title={c.label}
                  aria-label={c.label}
                />
              ))}
            </div>
          )}
        </div>

        {/* Size picker toggle */}
        <div className="spark-toolbar__size-wrap">
          <button
            className={cn("spark-tool-btn", { "spark-tool-btn--active": showSizePicker })}
            onClick={() => { setShowSizePicker((v) => !v); setShowColorPicker(false); }}
            title="Brush size"
            aria-label="Brush size"
          >
            <span className="material-symbols-outlined">line_weight</span>
          </button>
          {showSizePicker && (
            <div className="spark-size-picker">
              <span className="spark-size-picker__label">Size: {penSize}px</span>
              <input
                type="range"
                min={1}
                max={24}
                value={penSize}
                onChange={(e) => onSizeChange(Number(e.target.value))}
                className="spark-size-picker__slider"
              />
            </div>
          )}
        </div>

        <ToolButton icon="delete_sweep" label="Clear canvas" onClick={() => { onClearCanvas(); setShowColorPicker(false); setShowSizePicker(false); }} />
      </div>

      {/* Divider */}
      <div className="spark-toolbar__divider" />

      {/* Media controls group */}
      <div className={cn("spark-toolbar__group spark-toolbar__group--media", { "spark-toolbar__group--disabled": !connected })}>
        <ToolButton
          icon={muted ? "mic_off" : "mic"}
          label={muted ? "Unmute" : "Mute"}
          active={!muted}
          onClick={onToggleMute}
        />
        <ToolButton
          icon={webcam.isStreaming ? "videocam_off" : "videocam"}
          label={webcam.isStreaming ? "Stop camera" : "Start camera"}
          active={webcam.isStreaming}
          onClick={webcam.isStreaming ? onChangeStream() : onChangeStream(webcam)}
        />
        <ToolButton
          icon={screenCapture.isStreaming ? "cancel_presentation" : "present_to_all"}
          label={screenCapture.isStreaming ? "Stop sharing" : "Share screen"}
          active={screenCapture.isStreaming}
          onClick={screenCapture.isStreaming ? onChangeStream() : onChangeStream(screenCapture)}
        />
      </div>

      {/* Divider */}
      <div className="spark-toolbar__divider" />

      {/* Connect FAB */}
      <button
        className={cn("spark-fab", {
          "spark-fab--connected": connected,
          "spark-fab--disconnected": !connected,
        })}
        onClick={connected ? onDisconnect : onConnect}
        aria-label={connected ? "Disconnect from SPARK" : "Connect to SPARK"}
      >
        <span className="material-symbols-outlined spark-fab__icon">
          {connected ? "stop_circle" : "play_circle"}
        </span>
        <span className="spark-fab__label">{connected ? "End Session" : "Start SPARK"}</span>
      </button>

      {/* Volume indicator */}
      {connected && (
        <div className="spark-toolbar__volume">
          <div className="spark-volume-bar">
            <div
              className="spark-volume-bar__fill spark-volume-bar__fill--in"
              style={{ height: `${Math.min(100, inputVolume * 100)}%` }}
            />
          </div>
          <div className="spark-volume-bar">
            <div
              className="spark-volume-bar__fill spark-volume-bar__fill--out"
              style={{ height: `${Math.min(100, outputVolume * 100)}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(SparkToolbar);

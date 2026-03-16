/**
 * SPARK Presence — Animated AI avatar blob
 * Pulses when speaking, breathes when idle, warms up during struggle.
 */

import React, { useEffect, useRef } from "react";
import "./spark-presence.scss";

export interface SparkPresenceProps {
  volume: number;        // 0-1, AI output volume
  connected: boolean;
  isSilent: boolean;     // student silence detected
  isStalling: boolean;   // student stalling detected
  sessionTopic?: string;
  sessionSubject?: string;
}

function SparkPresence({
  volume,
  connected,
  isSilent,
  isStalling,
  sessionTopic,
  sessionSubject,
}: SparkPresenceProps) {
  const blobRef = useRef<SVGPathElement>(null);
  const frameRef = useRef<number>(0);
  const phaseRef = useRef(0);

  // Determine emotional state
  const state = !connected
    ? "offline"
    : volume > 0.05
    ? "speaking"
    : isSilent || isStalling
    ? "attentive"
    : "idle";

  // Animate the organic blob using SVG path morphing
  useEffect(() => {
    if (!blobRef.current) return;

    const animate = () => {
      phaseRef.current += state === "speaking" ? 0.06 + volume * 0.1 : 0.018;
      const t = phaseRef.current;

      // Generate organic blob path using parametric equations
      const cx = 60;
      const cy = 60;
      const baseR = state === "speaking" ? 28 + volume * 14 : 30;
      const wobble = state === "speaking" ? 10 + volume * 8 : 4;

      // 8-point blob
      const points: [number, number][] = [];
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2;
        const noiseOffset = i * 0.8;
        const r =
          baseR +
          Math.sin(t * 1.3 + noiseOffset) * (wobble * 0.6) +
          Math.sin(t * 0.7 + noiseOffset * 1.5) * (wobble * 0.4);
        points.push([cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]);
      }

      // Build smooth SVG path through points
      const path = smoothPath(points);
      if (blobRef.current) {
        blobRef.current.setAttribute("d", path);
      }

      frameRef.current = requestAnimationFrame(animate);
    };

    frameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameRef.current);
  }, [state, volume]);

  return (
    <div className={`spark-presence spark-presence--${state}`}>
      <div className="spark-presence__glow" />
      <svg
        className="spark-presence__svg"
        viewBox="0 0 120 120"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <radialGradient id="blobGrad" cx="40%" cy="35%" r="65%">
            <stop offset="0%" stopColor="var(--blob-highlight, #C4B5FD)" />
            <stop offset="50%" stopColor="var(--blob-primary, #7C3AED)" />
            <stop offset="100%" stopColor="var(--blob-shadow, #4C1D95)" />
          </radialGradient>
          <filter id="blobBlur" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="1.5" />
          </filter>
        </defs>

        {/* Outer glow blob */}
        <path
          ref={blobRef}
          fill="url(#blobGrad)"
          opacity={connected ? 0.95 : 0.3}
        />

        {/* Spark icon in center */}
        {connected && (
          <text
            x="60"
            y="68"
            textAnchor="middle"
            fontSize="22"
            className="spark-presence__icon"
          >
            {state === "speaking" ? "✦" : state === "attentive" ? "◉" : "✦"}
          </text>
        )}
        {!connected && (
          <text x="60" y="68" textAnchor="middle" fontSize="20" opacity="0.4">
            ✦
          </text>
        )}
      </svg>

      {/* Status label */}
      <div className="spark-presence__label">
        {!connected && <span className="spark-presence__status">Connect to start</span>}
        {connected && state === "speaking" && (
          <span className="spark-presence__status spark-presence__status--speaking">
            SPARK is speaking...
          </span>
        )}
        {connected && state === "attentive" && (
          <span className="spark-presence__status spark-presence__status--attentive">
            SPARK is watching...
          </span>
        )}
        {connected && state === "idle" && (
          <span className="spark-presence__status spark-presence__status--idle">
            SPARK is ready
          </span>
        )}
      </div>

      {/* Session context badge */}
      {sessionTopic && (
        <div className="spark-presence__session">
          <span className="spark-presence__session-subject">{sessionSubject ?? "Study"}</span>
          <span className="spark-presence__session-topic">{sessionTopic}</span>
        </div>
      )}
    </div>
  );
}

/** Build a smooth closed SVG path through an array of points */
function smoothPath(points: [number, number][]): string {
  const n = points.length;
  let d = `M ${points[0][0].toFixed(2)} ${points[0][1].toFixed(2)}`;

  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];

    const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6;

    d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
  }

  return d + " Z";
}

export default SparkPresence;

/**
 * SPARK Proactive Monitor Hook
 * Detects student silence/stalls and signals SPARK to initiate a check-in.
 * Also tracks drawing activity to detect circular behavior (repeated erasing).
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface ProactiveMonitorState {
  isSilent: boolean;          // student has been silent >20s
  silenceDuration: number;    // ms of current silence
  isStalling: boolean;        // drawing stall detected
  lastActivityTime: number;
  resetSilenceTimer: () => void;
  recordDrawActivity: () => void;
  recordEraseActivity: () => void;
}

const SILENCE_THRESHOLD_MS = 20_000;   // 20 seconds
const STALL_THRESHOLD_MS = 15_000;     // 15 seconds of drawing inactivity
const ERASE_LOOP_THRESHOLD = 5;        // 5+ erases in short window = stalling

export function useProactiveMonitor(
  connected: boolean,
  onSilenceDetected: () => void,
  onStallDetected: () => void,
): ProactiveMonitorState {
  const [isSilent, setIsSilent] = useState(false);
  const [isStalling, setIsStalling] = useState(false);
  const [silenceDuration, setSilenceDuration] = useState(0);
  const [lastActivityTime, setLastActivityTime] = useState(Date.now());

  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stallTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const eraseCountRef = useRef(0);
  const eraseWindowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const silenceCallbackFiredRef = useRef(false);
  const stallCallbackFiredRef = useRef(false);

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
  }, []);

  const clearStallTimer = useCallback(() => {
    if (stallTimerRef.current) {
      clearTimeout(stallTimerRef.current);
      stallTimerRef.current = null;
    }
  }, []);

  const startSilenceTimer = useCallback(() => {
    clearSilenceTimer();
    silenceCallbackFiredRef.current = false;
    const startTime = Date.now();

    durationIntervalRef.current = setInterval(() => {
      setSilenceDuration(Date.now() - startTime);
    }, 1000);

    silenceTimerRef.current = setTimeout(() => {
      setIsSilent(true);
      if (!silenceCallbackFiredRef.current) {
        silenceCallbackFiredRef.current = true;
        onSilenceDetected();
      }
    }, SILENCE_THRESHOLD_MS);
  }, [clearSilenceTimer, onSilenceDetected]);

  const startStallTimer = useCallback(() => {
    clearStallTimer();
    stallCallbackFiredRef.current = false;
    stallTimerRef.current = setTimeout(() => {
      setIsStalling(true);
      if (!stallCallbackFiredRef.current) {
        stallCallbackFiredRef.current = true;
        onStallDetected();
      }
    }, STALL_THRESHOLD_MS);
  }, [clearStallTimer, onStallDetected]);

  const resetSilenceTimer = useCallback(() => {
    setIsSilent(false);
    setSilenceDuration(0);
    setLastActivityTime(Date.now());
    if (connected) startSilenceTimer();
    else clearSilenceTimer();
  }, [connected, startSilenceTimer, clearSilenceTimer]);

  const recordDrawActivity = useCallback(() => {
    setIsStalling(false);
    setLastActivityTime(Date.now());
    if (connected) startStallTimer();
    else clearStallTimer();
  }, [connected, startStallTimer, clearStallTimer]);

  const recordEraseActivity = useCallback(() => {
    eraseCountRef.current += 1;
    recordDrawActivity();

    if (eraseWindowTimerRef.current) clearTimeout(eraseWindowTimerRef.current);
    eraseWindowTimerRef.current = setTimeout(() => {
      eraseCountRef.current = 0;
    }, 10_000);

    if (eraseCountRef.current >= ERASE_LOOP_THRESHOLD) {
      eraseCountRef.current = 0;
      setIsStalling(true);
      if (!stallCallbackFiredRef.current) {
        stallCallbackFiredRef.current = true;
        onStallDetected();
      }
    }
  }, [recordDrawActivity, onStallDetected]);

  // Start/stop timers based on connection state
  useEffect(() => {
    if (connected) {
      startSilenceTimer();
      startStallTimer();
    } else {
      clearSilenceTimer();
      clearStallTimer();
      setIsSilent(false);
      setIsStalling(false);
      setSilenceDuration(0);
    }
    return () => {
      clearSilenceTimer();
      clearStallTimer();
    };
  }, [connected, startSilenceTimer, startStallTimer, clearSilenceTimer, clearStallTimer]);

  return {
    isSilent,
    silenceDuration,
    isStalling,
    lastActivityTime,
    resetSilenceTimer,
    recordDrawActivity,
    recordEraseActivity,
  };
}

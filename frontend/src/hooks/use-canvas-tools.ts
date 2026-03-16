/**
 * SPARK Canvas Tools Hook
 * Listens to ADK tool calls from the backend and translates them
 * into canvas commands (highlights, hint cards, celebrations, session context,
 * handwriting text, formula drawing, canvas clearing).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { MultimodalLiveClient } from "../utils/multimodal-live-client";
import { ToolCall } from "../multimodal-live-types";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HighlightArea {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  message: string;
  createdAt: number;
  expiresAt: number;
}

export interface HintCard {
  id: string;
  title: string;
  content: string;
  cardType: "hint" | "formula" | "concept" | "example" | "warning" | "celebration";
  createdAt: number;
}

export interface CelebrationState {
  active: boolean;
  message: string;
  intensity: "small" | "medium" | "large";
  triggeredAt: number;
}

export interface SessionContext {
  topic: string;
  subject: string;
  difficulty: "beginner" | "intermediate" | "advanced";
  objectives: string;
}

/** A piece of handwriting or formula SPARK draws on the canvas */
export interface SparkDrawing {
  id: string;
  type: "write" | "formula";
  text: string;
  x: number;       // normalized 0-1
  y: number;       // normalized 0-1
  fontSize: number;
  color: string;
  style: string;
  createdAt: number;
}

export interface CanvasToolsState {
  highlights: HighlightArea[];
  hintCards: HintCard[];
  celebration: CelebrationState | null;
  sessionContext: SessionContext | null;
  sparkDrawings: SparkDrawing[];
  clearSparkDrawingsSignal: number;   // bumped to signal SparkCanvas to clear its layer
  clearStudentSignal: number;         // bumped to signal SparkCanvas to clear student layer
  clearHighlight: (id: string) => void;
  clearHintCard: (id: string) => void;
  clearAllHighlights: () => void;
  clearCelebration: () => void;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

const HIGHLIGHT_TTL_MS = 8000;
const CARD_TTL_MS = 30000;

export function useCanvasTools(client: MultimodalLiveClient): CanvasToolsState {
  const [highlights, setHighlights] = useState<HighlightArea[]>([]);
  const [hintCards, setHintCards] = useState<HintCard[]>([]);
  const [celebration, setCelebration] = useState<CelebrationState | null>(null);
  const [sessionContext, setSessionContext] = useState<SessionContext | null>(null);
  const [sparkDrawings, setSparkDrawings] = useState<SparkDrawing[]>([]);
  const [clearSparkDrawingsSignal, setClearSparkDrawingsSignal] = useState(0);
  const [clearStudentSignal, setClearStudentSignal] = useState(0);
  const highlightTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const handleToolCall = useCallback((toolCall: ToolCall) => {
    for (const fc of toolCall.functionCalls) {
      const args = fc.args as Record<string, any>;
      const now = Date.now();

      switch (fc.name) {
        case "highlight_canvas_area": {
          const id = `hl-${now}-${Math.random().toString(36).slice(2, 7)}`;
          const highlight: HighlightArea = {
            id,
            x: Number(args.x ?? 0.1),
            y: Number(args.y ?? 0.1),
            width: Number(args.width ?? 0.3),
            height: Number(args.height ?? 0.2),
            color: String(args.color ?? "rgba(139, 92, 246, 0.3)"),
            message: String(args.message ?? ""),
            createdAt: now,
            expiresAt: now + HIGHLIGHT_TTL_MS,
          };
          setHighlights((prev) => [...prev.slice(-4), highlight]);
          const timer = setTimeout(() => {
            setHighlights((prev) => prev.filter((h) => h.id !== id));
            highlightTimers.current.delete(id);
          }, HIGHLIGHT_TTL_MS);
          highlightTimers.current.set(id, timer);
          break;
        }

        case "show_hint_card": {
          const id = `card-${now}-${Math.random().toString(36).slice(2, 7)}`;
          const card: HintCard = {
            id,
            title: String(args.title ?? "Hint"),
            content: String(args.content ?? ""),
            cardType: (args.card_type as HintCard["cardType"]) ?? "hint",
            createdAt: now,
          };
          setHintCards((prev) => [...prev.slice(-2), card]);
          setTimeout(() => {
            setHintCards((prev) => prev.filter((c) => c.id !== id));
          }, CARD_TTL_MS);
          break;
        }

        case "celebrate_achievement": {
          const state: CelebrationState = {
            active: true,
            message: String(args.message ?? "Amazing work!"),
            intensity: (args.intensity as CelebrationState["intensity"]) ?? "medium",
            triggeredAt: now,
          };
          setCelebration(state);
          const duration = state.intensity === "large" ? 4000 : state.intensity === "medium" ? 2800 : 1800;
          setTimeout(() => setCelebration(null), duration);
          break;
        }

        case "set_session_context": {
          setSessionContext({
            topic: String(args.topic ?? ""),
            subject: String(args.subject ?? "General"),
            difficulty: (args.difficulty as SessionContext["difficulty"]) ?? "intermediate",
            objectives: String(args.objectives ?? ""),
          });
          break;
        }

        case "write_on_canvas": {
          const id = `draw-${now}-${Math.random().toString(36).slice(2, 7)}`;
          const drawing: SparkDrawing = {
            id,
            type: "write",
            text: String(args.text ?? ""),
            x: Number(args.x ?? 0.05),
            y: Number(args.y ?? 0.15),
            fontSize: Number(args.font_size ?? 28),
            color: String(args.color ?? "#A78BFA"),
            style: String(args.style ?? "handwriting"),
            createdAt: now,
          };
          setSparkDrawings((prev) => [...prev, drawing]);
          break;
        }

        case "draw_formula": {
          const id = `formula-${now}-${Math.random().toString(36).slice(2, 7)}`;
          const drawing: SparkDrawing = {
            id,
            type: "formula",
            text: String(args.formula ?? ""),
            x: Number(args.x ?? 0.05),
            y: Number(args.y ?? 0.3),
            fontSize: Number(args.font_size ?? 36),
            color: String(args.color ?? "#60A5FA"),
            style: "formula",
            createdAt: now,
          };
          setSparkDrawings((prev) => [...prev, drawing]);
          break;
        }

        case "clear_spark_canvas": {
          setSparkDrawings([]);
          setHighlights([]);
          highlightTimers.current.forEach((t) => clearTimeout(t));
          highlightTimers.current.clear();
          setClearSparkDrawingsSignal((n) => n + 1);
          break;
        }

        case "clear_student_canvas": {
          setClearStudentSignal((n) => n + 1);
          break;
        }

        default:
          break;
      }
    }
  }, []);

  useEffect(() => {
    client.on("toolcall", handleToolCall);
    return () => { client.off("toolcall", handleToolCall); };
  }, [client, handleToolCall]);

  useEffect(() => {
    return () => { highlightTimers.current.forEach((t) => clearTimeout(t)); };
  }, []);

  const clearHighlight = useCallback((id: string) => {
    const t = highlightTimers.current.get(id);
    if (t) { clearTimeout(t); highlightTimers.current.delete(id); }
    setHighlights((prev) => prev.filter((h) => h.id !== id));
  }, []);

  const clearHintCard = useCallback((id: string) => {
    setHintCards((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const clearAllHighlights = useCallback(() => {
    highlightTimers.current.forEach((t) => clearTimeout(t));
    highlightTimers.current.clear();
    setHighlights([]);
  }, []);

  const clearCelebration = useCallback(() => setCelebration(null), []);

  return {
    highlights,
    hintCards,
    celebration,
    sessionContext,
    sparkDrawings,
    clearSparkDrawingsSignal,
    clearStudentSignal,
    clearHighlight,
    clearHintCard,
    clearAllHighlights,
    clearCelebration,
  };
}

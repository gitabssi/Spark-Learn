/**
 * SPARK Canvas — 3-Layer Interactive Canvas System
 *
 * Layer 1 (bottom): Student drawing canvas — freehand pen/eraser
 * Layer 2 (middle): SPARK drawing canvas — AI handwriting & formulas (animated)
 * Layer 3 (top):    DOM overlay — highlight boxes, hint cards, celebrations
 */

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  CanvasToolsState,
  HighlightArea,
  HintCard,
  SparkDrawing,
} from "../../hooks/use-canvas-tools";
import "./spark-canvas.scss";

// ─── Types ────────────────────────────────────────────────────────────────────

export type DrawTool = "pen" | "eraser" | "highlight";

// ─── Demo drawing types ───────────────────────────────────────────────────────

export interface DemoDrawItem {
  type: "line" | "text";
  // line
  x1?: number; y1?: number; x2?: number; y2?: number;
  // text
  text?: string; x?: number; y?: number; fontSize?: number;
  // shared
  color?: string;
  duration?: number; // ms to animate
}

export interface SparkCanvasProps {
  canvasTools: CanvasToolsState;
  activeTool: DrawTool;
  penColor: string;
  penSize: number;
  onDrawActivity?: () => void;
  onEraseActivity?: () => void;
  className?: string;
}

export interface SparkCanvasRef {
  clearStudentCanvas: () => void;
  getStudentCanvasData: () => string;
  captureFrame: () => string | null;
  drawStudentContent: (items: DemoDrawItem[]) => Promise<void>;
}

// ─── Handwriting font helpers ─────────────────────────────────────────────────

const HANDWRITING_FONT = "Caveat, 'Comic Sans MS', cursive";
const LINE_HEIGHT_RATIO = 1.35;

/** Render one SparkDrawing onto a canvas context, up to `charLimit` characters */
function renderDrawing(
  ctx: CanvasRenderingContext2D,
  drawing: SparkDrawing,
  canvasW: number,
  canvasH: number,
  charLimit: number,
) {
  const x = drawing.x * canvasW;
  const y = drawing.y * canvasH;
  const size = drawing.fontSize;
  const lineH = size * LINE_HEIGHT_RATIO;

  ctx.save();
  ctx.font = `${drawing.type === "formula" ? "bold" : "normal"} ${size}px ${HANDWRITING_FONT}`;
  ctx.fillStyle = drawing.color;
  ctx.textBaseline = "top";

  // Add subtle shadow for handwriting depth
  ctx.shadowColor = "rgba(0,0,0,0.25)";
  ctx.shadowBlur = 2;
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 1;

  const fullText = drawing.text.replace(/\\n/g, "\n");
  const lines = fullText.split("\n");
  let charsLeft = charLimit;

  for (let li = 0; li < lines.length && charsLeft > 0; li++) {
    const line = lines[li];
    const visibleLine = line.slice(0, charsLeft);
    ctx.fillText(visibleLine, x, y + li * lineH);
    charsLeft -= line.length;
    if (charsLeft > 0) charsLeft--; // consume the \n
  }

  ctx.restore();
}

// ─── Hint Card Component ──────────────────────────────────────────────────────

const cardTypeConfig: Record<string, { icon: string; accent: string }> = {
  hint:        { icon: "lightbulb",   accent: "#A78BFA" },
  formula:     { icon: "functions",   accent: "#60A5FA" },
  concept:     { icon: "psychology",  accent: "#34D399" },
  example:     { icon: "science",     accent: "#FBBF24" },
  warning:     { icon: "warning",     accent: "#F87171" },
  celebration: { icon: "celebration", accent: "#FF8A65" },
};

function FloatingHintCard({
  card,
  onClose,
  index,
}: {
  card: HintCard;
  onClose: () => void;
  index: number;
}) {
  const cfg = cardTypeConfig[card.cardType] ?? cardTypeConfig.hint;
  const style = {
    "--card-accent": cfg.accent,
    "--card-delay": `${index * 60}ms`,
    top: `${16 + index * 12}px`,
    right: `${16 + index * 8}px`,
  } as React.CSSProperties;

  return (
    <div className={`spark-hint-card spark-hint-card--${card.cardType}`} style={style}>
      <div className="spark-hint-card__header">
        <span className="material-symbols-outlined spark-hint-card__icon">{cfg.icon}</span>
        <span className="spark-hint-card__title">{card.title}</span>
        <button className="spark-hint-card__close" onClick={onClose} aria-label="Dismiss">
          <span className="material-symbols-outlined">close</span>
        </button>
      </div>
      <div className="spark-hint-card__content">{card.content}</div>
    </div>
  );
}

// ─── Celebration Overlay ──────────────────────────────────────────────────────

function CelebrationOverlay({ message, intensity }: { message: string; intensity: "small" | "medium" | "large" }) {
  const count = intensity === "large" ? 40 : intensity === "medium" ? 24 : 12;
  const particles = Array.from({ length: count }, (_, i) => ({
    id: i,
    left: `${Math.random() * 100}%`,
    delay: `${Math.random() * 0.6}s`,
    color: ["#A78BFA", "#FF8A65", "#34D399", "#60A5FA", "#FBBF24"][i % 5],
  }));
  return (
    <div className={`spark-celebration spark-celebration--${intensity}`}>
      <div className="spark-celebration__message">{message}</div>
      <div className="spark-celebration__particles">
        {particles.map((p) => (
          <div key={p.id} className="spark-celebration__particle"
            style={{ left: p.left, animationDelay: p.delay, background: p.color }} />
        ))}
      </div>
    </div>
  );
}

// ─── Highlight Overlay ────────────────────────────────────────────────────────

function HighlightOverlay({ highlight, canvasWidth, canvasHeight }: {
  highlight: HighlightArea;
  canvasWidth: number;
  canvasHeight: number;
}) {
  return (
    <div className="spark-highlight" style={{
      left:   `${highlight.x * canvasWidth}px`,
      top:    `${highlight.y * canvasHeight}px`,
      width:  `${highlight.width * canvasWidth}px`,
      height: `${highlight.height * canvasHeight}px`,
      background: highlight.color,
    }}>
      {highlight.message && <div className="spark-highlight__label">{highlight.message}</div>}
    </div>
  );
}

// ─── Demo: human-like drawing helpers ─────────────────────────────────────────

async function demoAnimateLine(ctx: CanvasRenderingContext2D, item: DemoDrawItem, W: number, H: number) {
  const x1 = item.x1! * W, y1 = item.y1! * H;
  const x2 = item.x2! * W, y2 = item.y2! * H;
  const duration = item.duration ?? 800;
  const steps = Math.max(12, Math.floor(duration / 18));
  const stepDelay = duration / steps;
  const jitter = 1.8;

  ctx.strokeStyle = item.color ?? "#F3F0FF";
  ctx.lineWidth = 2.8;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  let prevX = x1 + (Math.random() - 0.5) * jitter;
  let prevY = y1 + (Math.random() - 0.5) * jitter;
  ctx.beginPath();
  ctx.moveTo(prevX, prevY);

  for (let i = 1; i <= steps; i++) {
    await new Promise<void>((r) => setTimeout(r, stepDelay));
    const t = i / steps;
    // ease-in-out for natural deceleration
    const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const nx = x1 + (x2 - x1) * eased + (Math.random() - 0.5) * jitter;
    const ny = y1 + (y2 - y1) * eased + (Math.random() - 0.5) * jitter;
    ctx.lineTo(nx, ny);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(nx, ny);
    prevX = nx; prevY = ny;
  }
}

async function demoAnimateText(ctx: CanvasRenderingContext2D, item: DemoDrawItem, W: number, H: number) {
  const text = item.text ?? "";
  const x = item.x! * W;
  const y = item.y! * H;
  const fontSize = item.fontSize ?? 22;
  const totalDuration = item.duration ?? text.length * 55;
  const charDelay = totalDuration / Math.max(1, text.length);

  ctx.font = `600 ${fontSize}px ${HANDWRITING_FONT}`;
  ctx.fillStyle = item.color ?? "#F3F0FF";
  ctx.textBaseline = "top";

  let xOffset = 0;
  for (const char of text) {
    ctx.save();
    // slight per-character rotation for human feel
    const rot = (Math.random() - 0.5) * 0.06;
    ctx.translate(x + xOffset + fontSize * 0.3, y + fontSize * 0.5);
    ctx.rotate(rot);
    ctx.translate(-(x + xOffset + fontSize * 0.3), -(y + fontSize * 0.5));
    ctx.font = `600 ${fontSize}px ${HANDWRITING_FONT}`;
    ctx.fillStyle = item.color ?? "#F3F0FF";
    ctx.textBaseline = "top";
    ctx.fillText(char, x + xOffset, y);
    ctx.restore();
    xOffset += ctx.measureText(char).width;
    await new Promise<void>((r) =>
      setTimeout(r, charDelay * (0.7 + Math.random() * 0.6))
    );
  }
}

// ─── Main SparkCanvas Component ───────────────────────────────────────────────

const SparkCanvas = forwardRef<SparkCanvasRef, SparkCanvasProps>(
  ({ canvasTools, activeTool, penColor, penSize, onDrawActivity, onEraseActivity, className }, ref) => {
    const studentCanvasRef = useRef<HTMLCanvasElement>(null);
    const sparkCanvasRef   = useRef<HTMLCanvasElement>(null);
    const containerRef     = useRef<HTMLDivElement>(null);
    const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });

    // Drawing state
    const isDrawingRef  = useRef(false);
    const lastPointRef  = useRef<{ x: number; y: number } | null>(null);

    // SPARK handwriting animation state (using refs to avoid re-renders)
    const animStateRef  = useRef<{ id: string; revealedChars: number; total: number }[]>([]);
    const animTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

    // ── Public API ────────────────────────────────────────────────────────────
    useImperativeHandle(ref, () => ({
      clearStudentCanvas: () => {
        const canvas = studentCanvasRef.current;
        if (canvas) canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
      },
      getStudentCanvasData: () => studentCanvasRef.current?.toDataURL("image/png") ?? "",
      drawStudentContent: async (items: DemoDrawItem[]) => {
        const canvas = studentCanvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d")!;
        for (const item of items) {
          if (item.type === "line") {
            await demoAnimateLine(ctx, item, canvas.width, canvas.height);
          } else if (item.type === "text") {
            await demoAnimateText(ctx, item, canvas.width, canvas.height);
          }
        }
      },
      captureFrame: () => {
        // Composite student + spark layers for AI vision
        const sc = studentCanvasRef.current;
        const sk = sparkCanvasRef.current;
        if (!sc) return null;
        const tmp = document.createElement("canvas");
        tmp.width = sc.width; tmp.height = sc.height;
        const ctx = tmp.getContext("2d")!;
        ctx.drawImage(sc, 0, 0);
        if (sk) ctx.drawImage(sk, 0, 0);
        return tmp.toDataURL("image/jpeg", 0.7).split(",")[1];
      },
    }));

    // ── Resize observer ───────────────────────────────────────────────────────
    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;
      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { width, height } = entry.contentRect;
          setCanvasSize({ width, height });
        }
      });
      observer.observe(container);
      return () => observer.disconnect();
    }, []);

    // Resize canvases (preserve student drawing)
    useEffect(() => {
      const sc = studentCanvasRef.current;
      if (sc) {
        const imgData = sc.getContext("2d")?.getImageData(0, 0, sc.width, sc.height);
        sc.width = canvasSize.width; sc.height = canvasSize.height;
        if (imgData) sc.getContext("2d")?.putImageData(imgData, 0, 0);
      }
      const sk = sparkCanvasRef.current;
      if (sk) { sk.width = canvasSize.width; sk.height = canvasSize.height; }
      // Re-render SPARK drawings after resize
      redrawSparkCanvas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [canvasSize]);

    // ── SPARK handwriting animation ───────────────────────────────────────────

    const redrawSparkCanvas = useCallback(() => {
      const canvas = sparkCanvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d")!;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const drawings = canvasTools.sparkDrawings;
      for (const d of drawings) {
        const anim = animStateRef.current.find((a) => a.id === d.id);
        const charLimit = anim ? anim.revealedChars : d.text.length;
        renderDrawing(ctx, d, canvas.width, canvas.height, charLimit);
      }
    }, [canvasTools.sparkDrawings]);

    // When sparkDrawings changes, start/continue animation
    useEffect(() => {
      const drawings = canvasTools.sparkDrawings;

      // Add new drawings to anim state
      for (const d of drawings) {
        if (!animStateRef.current.find((a) => a.id === d.id)) {
          animStateRef.current.push({ id: d.id, revealedChars: 0, total: d.text.replace(/\\n/g, "\n").length });
        }
      }

      // Remove stale anim entries
      animStateRef.current = animStateRef.current.filter((a) =>
        drawings.some((d) => d.id === a.id)
      );

      // Kick off animation if not already running
      if (!animTimerRef.current) {
        startAnimation();
      }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [canvasTools.sparkDrawings]);

    const startAnimation = useCallback(() => {
      const tick = () => {
        let anyIncomplete = false;
        for (const anim of animStateRef.current) {
          if (anim.revealedChars < anim.total) {
            // Advance 2 chars per tick for natural writing speed
            anim.revealedChars = Math.min(anim.total, anim.revealedChars + 2);
            anyIncomplete = true;
          }
        }
        redrawSparkCanvas();
        if (anyIncomplete) {
          animTimerRef.current = setTimeout(tick, 35); // ~28 chars/sec
        } else {
          animTimerRef.current = null;
        }
      };
      animTimerRef.current = setTimeout(tick, 35);
    }, [redrawSparkCanvas]);

    // Handle clear_spark_canvas signal
    useEffect(() => {
      if (canvasTools.clearSparkDrawingsSignal === 0) return;
      animStateRef.current = [];
      if (animTimerRef.current) { clearTimeout(animTimerRef.current); animTimerRef.current = null; }
      const canvas = sparkCanvasRef.current;
      if (canvas) canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    }, [canvasTools.clearSparkDrawingsSignal]);

    // Handle clear_student_canvas signal
    useEffect(() => {
      if (canvasTools.clearStudentSignal === 0) return;
      const canvas = studentCanvasRef.current;
      if (canvas) canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    }, [canvasTools.clearStudentSignal]);

    // Cleanup on unmount
    useEffect(() => () => {
      if (animTimerRef.current) clearTimeout(animTimerRef.current);
    }, []);

    // ── Student drawing ───────────────────────────────────────────────────────

    const getCanvasPoint = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
      const rect = studentCanvasRef.current!.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }, []);

    const startDraw = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      isDrawingRef.current = true;
      lastPointRef.current = getCanvasPoint(e);
      studentCanvasRef.current?.getContext("2d")?.beginPath();
    }, [getCanvasPoint]);

    const draw = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!isDrawingRef.current || !studentCanvasRef.current) return;
      const ctx = studentCanvasRef.current.getContext("2d")!;
      const point = getCanvasPoint(e);
      const last  = lastPointRef.current ?? point;

      if (activeTool === "eraser") {
        ctx.save();
        ctx.globalCompositeOperation = "destination-out";
        ctx.lineWidth = penSize * 3;
        ctx.lineCap = ctx.lineJoin = "round";
        ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(point.x, point.y); ctx.stroke();
        ctx.restore();
        onEraseActivity?.();
      } else {
        ctx.globalCompositeOperation = "source-over";
        ctx.strokeStyle = penColor;
        ctx.lineWidth = penSize;
        ctx.lineCap = ctx.lineJoin = "round";
        ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(point.x, point.y); ctx.stroke();
        onDrawActivity?.();
      }
      lastPointRef.current = point;
    }, [activeTool, penColor, penSize, getCanvasPoint, onDrawActivity, onEraseActivity]);

    const endDraw = useCallback(() => {
      isDrawingRef.current = false;
      lastPointRef.current = null;
    }, []);

    // ── Render ────────────────────────────────────────────────────────────────

    return (
      <div className={`spark-canvas-container ${className ?? ""}`} ref={containerRef}>

        {/* Layer 1: Student drawing */}
        <canvas
          ref={studentCanvasRef}
          className={`spark-canvas-layer spark-canvas-layer--student spark-canvas-cursor--${activeTool}`}
          width={canvasSize.width}
          height={canvasSize.height}
          onPointerDown={startDraw}
          onPointerMove={draw}
          onPointerUp={endDraw}
          onPointerLeave={endDraw}
        />

        {/* Layer 2: SPARK handwriting / formula canvas */}
        <canvas
          ref={sparkCanvasRef}
          className="spark-canvas-layer spark-canvas-layer--spark-drawing"
          width={canvasSize.width}
          height={canvasSize.height}
        />

        {/* Layer 3a: Highlight boxes */}
        <div className="spark-canvas-layer spark-canvas-layer--highlights">
          {canvasTools.highlights.map((h) => (
            <HighlightOverlay key={h.id} highlight={h}
              canvasWidth={canvasSize.width} canvasHeight={canvasSize.height} />
          ))}
        </div>

        {/* Layer 3b: Floating cards + celebration */}
        <div className="spark-canvas-layer spark-canvas-layer--assets">
          {canvasTools.hintCards.map((card, i) => (
            <FloatingHintCard key={card.id} card={card} index={i}
              onClose={() => canvasTools.clearHintCard(card.id)} />
          ))}
          {canvasTools.celebration && (
            <CelebrationOverlay message={canvasTools.celebration.message}
              intensity={canvasTools.celebration.intensity} />
          )}
        </div>

        {/* Empty state hint */}
        {canvasTools.sparkDrawings.length === 0 && canvasTools.hintCards.length === 0 && !canvasTools.celebration && (
          <div className="spark-canvas-empty-hint">
            <span className="material-symbols-outlined">draw</span>
            <p>Start drawing — SPARK is watching and ready to help!</p>
          </div>
        )}
      </div>
    );
  },
);

SparkCanvas.displayName = "SparkCanvas";
export default SparkCanvas;

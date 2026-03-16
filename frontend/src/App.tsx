/**
 * SPARK — AI Tutoring System
 * Main application layout: Header | Canvas + Presence | Toolbar
 */

import { useCallback, useEffect, useRef, useState } from "react";
import "./App.scss";
import { LiveAPIProvider, useLiveAPIContext } from "./contexts/LiveAPIContext";
import SparkCanvas, { DrawTool, SparkCanvasRef } from "./components/spark-canvas/SparkCanvas";
import SparkPresence from "./components/spark-presence/SparkPresence";
import SparkToolbar from "./components/spark-toolbar/SparkToolbar";
import { useCanvasTools } from "./hooks/use-canvas-tools";
import { useProactiveMonitor } from "./hooks/use-proactive-monitor";
import { AudioRecorder } from "./utils/audio-recorder";
import { useWebcam } from "./hooks/use-webcam";
import { useScreenCapture } from "./hooks/use-screen-capture";
import { UseMediaStreamResult } from "./hooks/use-media-stream-mux";
import TranscriptionPreview from "./components/transcription-preview/TranscriptionPreview";
import { useDemoAgent } from "./hooks/use-demo-agent";

// In Vite dev mode (port 3000), proxy handles /ws → backend:8000
// In production (served by backend), connect directly to same host
const defaultUri = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/`;

// ─── Inner app (needs LiveAPIContext) ─────────────────────────────────────────

function SparkApp({ userId }: { userId: string }) {
  const { connected, client, connect, disconnect, volume } = useLiveAPIContext();

  const canvasRef = useRef<SparkCanvasRef>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const renderCanvasRef = useRef<HTMLCanvasElement>(null);
  const [audioRecorder] = useState(() => new AudioRecorder());

  // Drawing state
  const [activeTool, setActiveTool] = useState<DrawTool>("pen");
  const [penColor, setPenColor] = useState("#F3F0FF");
  const [penSize, setPenSize] = useState(3);

  // Mic state
  const [muted, setMuted] = useState(false);
  const [inputVolume, setInputVolume] = useState(0);

  // Video streams
  const webcam = useWebcam();
  const screenCapture = useScreenCapture();
  const [activeVideoStream, setActiveVideoStream] = useState<MediaStream | null>(null);
  const videoStreams = [webcam, screenCapture];

  // Canvas tool listener (processes AI tool calls → visual effects)
  const canvasTools = useCanvasTools(client);

  const onSilence = useCallback(() => {
    if (connected) client.send([{ text: "__proactive_silence_checkin__" }]);
  }, [connected, client]);

  const onStall = useCallback(() => {
    if (connected) client.send([{ text: "__proactive_stall_checkin__" }]);
  }, [connected, client]);

  // Demo agent (passes setMuted so it can silence the real mic during playback)
  const { startDemo, isDemoRunning } = useDemoAgent(client, connected, connect, canvasRef, setMuted);

  // Proactive monitor (silence / stall detection)
  const proactiveMonitor = useProactiveMonitor(connected, onSilence, onStall);
  const { resetSilenceTimer, recordDrawActivity, recordEraseActivity, isSilent, isStalling } = proactiveMonitor;

  // ─── Audio recording ──────────────────────────────────────────────────────
  useEffect(() => {
    const onData = (base64: string) => {
      client.sendRealtimeInput([{ mimeType: "audio/pcm;rate=16000", data: base64 }]);
      resetSilenceTimer();
    };
    const onVolume = (v: number) => setInputVolume(v);

    if (connected && !muted) {
      audioRecorder.on("data", onData).on("volume", onVolume).start();
    } else {
      audioRecorder.stop();
      setInputVolume(0);
    }

    return () => {
      audioRecorder.off("data", onData).off("volume", onVolume);
    };
  }, [connected, muted, client, audioRecorder, resetSilenceTimer]);

  // ─── Video streaming ──────────────────────────────────────────────────────
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = activeVideoStream;
    }

    let timeoutId = -1;

    function sendVideoFrame() {
      const video = videoRef.current;
      const canvas = renderCanvasRef.current;
      if (!video || !canvas) return;

      const ctx = canvas.getContext("2d")!;
      canvas.width = video.videoWidth * 0.25;
      canvas.height = video.videoHeight * 0.25;
      if (canvas.width + canvas.height > 0) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const base64 = canvas.toDataURL("image/jpeg", 0.8);
        const data = base64.slice(base64.indexOf(",") + 1);
        client.sendRealtimeInput([{ mimeType: "image/jpeg", data }]);
      }
      if (connected) {
        timeoutId = window.setTimeout(sendVideoFrame, 2000);
      }
    }

    if (connected && activeVideoStream) {
      requestAnimationFrame(sendVideoFrame);
    }

    return () => clearTimeout(timeoutId);
  }, [connected, activeVideoStream, client]);

  // ─── Periodic canvas frame to AI vision ──────────────────────────────────
  useEffect(() => {
    if (!connected) return;
    const interval = setInterval(() => {
      const data = canvasRef.current?.captureFrame();
      if (data) {
        client.sendRealtimeInput([{ mimeType: "image/jpeg", data }]);
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [connected, client]);

  // ─── Stream switcher ──────────────────────────────────────────────────────
  const changeStreams = (next?: UseMediaStreamResult) => async () => {
    if (next) {
      const stream = await next.start();
      setActiveVideoStream(stream);
    } else {
      setActiveVideoStream(null);
    }
    videoStreams.filter((s) => s !== next).forEach((s) => s.stop());
  };

  return (
    <div className="spark-app">
      {/* Hidden canvases */}
      <canvas ref={renderCanvasRef} style={{ display: "none" }} />
      <video ref={videoRef} autoPlay playsInline style={{ display: "none" }} />

      {/* ── Header ── */}
      <header className="spark-header">
        <div className="spark-header__brand">
          <span className="spark-header__logo">✦</span>
          <span className="spark-header__name">SPARK</span>
          {canvasTools.sessionContext && (
            <div className="spark-header__session">
              <span className="spark-header__subject">
                {canvasTools.sessionContext.subject}
              </span>
              <span className="spark-header__topic">
                {canvasTools.sessionContext.topic}
              </span>
              <span
                className={`spark-header__difficulty spark-header__difficulty--${canvasTools.sessionContext.difficulty}`}
              >
                {canvasTools.sessionContext.difficulty}
              </span>
            </div>
          )}
        </div>
        <div className="spark-header__right">
          {connected && (
            <div className="spark-header__status">
              <span className="spark-header__status-dot" />
              Live Session
            </div>
          )}
          <div className="spark-header__user">
            <span className="material-symbols-outlined">person</span>
            {userId}
          </div>
        </div>
      </header>

      {/* ── Main area ── */}
      <main className="spark-main">
        {/* Canvas area */}
        <div className="spark-canvas-area">
          <SparkCanvas
            ref={canvasRef}
            canvasTools={canvasTools}
            activeTool={activeTool}
            penColor={penColor}
            penSize={penSize}
            onDrawActivity={recordDrawActivity}
            onEraseActivity={recordEraseActivity}
            className="spark-main-canvas"
          />

          {/* Demo button — only shown when idle and not yet connected */}
          {!connected && !isDemoRunning && (
            <div className="spark-demo-overlay">
              <button className="spark-demo-btn" onClick={startDemo}>
                <span className="spark-demo-btn__icon">🎬</span>
                <span className="spark-demo-btn__text">Watch Live Demo</span>
                <span className="spark-demo-btn__sub">See SPARK tutor a student in real time · ~3 min</span>
              </button>
            </div>
          )}
        </div>

        {/* SPARK presence sidebar */}
        <aside className="spark-sidebar">
          <SparkPresence
            volume={volume}
            connected={connected}
            isSilent={isSilent}
            isStalling={isStalling}
            sessionTopic={canvasTools.sessionContext?.topic}
            sessionSubject={canvasTools.sessionContext?.subject}
          />
          <div className="spark-transcription-wrap">
            <TranscriptionPreview open={true} />
          </div>
        </aside>
      </main>

      {/* ── Bottom toolbar ── */}
      <footer className="spark-footer">
        <SparkToolbar
          connected={connected}
          onConnect={connect}
          onDisconnect={disconnect}
          activeTool={activeTool}
          onToolChange={setActiveTool}
          penColor={penColor}
          onColorChange={setPenColor}
          penSize={penSize}
          onSizeChange={setPenSize}
          onClearCanvas={() => canvasRef.current?.clearStudentCanvas()}
          muted={muted}
          onToggleMute={() => setMuted((m) => !m)}
          webcam={webcam}
          screenCapture={screenCapture}
          onChangeStream={changeStreams}
          inputVolume={inputVolume}
          outputVolume={volume}
        />
      </footer>
    </div>
  );
}

// ─── Root wrapper ──────────────────────────────────────────────────────────────

function App() {
  const [serverUrl] = useState(defaultUri);
  const [userId] = useState("student");

  return (
    <LiveAPIProvider url={serverUrl} userId={userId}>
      <SparkApp userId={userId} />
    </LiveAPIProvider>
  );
}

export default App;

/**
 * SPARK Demo Agent — Two-Voice Gemini Live Architecture
 *
 * Student voice : Leda   (via /ws/student — Gemini Live TTS)
 * Tutor  voice  : Callirrhoe (via /ws      — SPARK ADK agent)
 *
 * Strict turn-taking:
 *   • Student speaks → waits for all audio to play out
 *   • SPARK responds → waits for turncomplete
 *   • No overlap, no interruptions
 *
 * Total runtime: ~2.5–3 minutes.
 */

import { useCallback, useRef, useState } from "react";
import { MultimodalLiveClient } from "../utils/multimodal-live-client";
import { AudioStreamer } from "../utils/audio-streamer";
import { SparkCanvasRef } from "../components/spark-canvas/SparkCanvas";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ─── Wait for a client event with timeout ────────────────────────────────────

function waitForEvent(
  client: MultimodalLiveClient,
  event: "turncomplete" | "setupcomplete",
  timeoutMs = 25_000,
): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      client.off(event, handler);
      resolve();
    }, timeoutMs);
    const handler = () => {
      clearTimeout(timer);
      client.off(event, handler);
      resolve();
    };
    client.on(event, handler);
  });
}

// ─── Demo agent hook ──────────────────────────────────────────────────────────

export function useDemoAgent(
  client: MultimodalLiveClient,
  connected: boolean,
  connect: () => void,
  canvasRef: React.RefObject<SparkCanvasRef>,
  setMuted: (m: boolean) => void,
) {
  const [isDemoRunning, setIsDemoRunning] = useState(false);
  const runningRef = useRef(false);

  const startDemo = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setIsDemoRunning(true);
    setMuted(true); // silence the real mic during demo

    // ── Set up student voice (Leda) via /ws/student ──────────────────────────
    const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const studentUrl = `${wsProtocol}//${window.location.host}/ws/student`;
    const studentClient = new MultimodalLiveClient({
      url: studentUrl,
      userId: "demo-student",
    });

    // AudioContext at 24 kHz (matches Gemini Live output)
    const audioCtx = new AudioContext({ sampleRate: 24000 });
    const studentStreamer = new AudioStreamer(audioCtx);

    // Route student audio → streamer
    const onStudentAudio = (data: ArrayBuffer) => {
      studentStreamer.addPCM16(new Uint8Array(data));
    };
    studentClient.on("audio", onStudentAudio);

    /**
     * speakAsStudent — sends a line to the student Gemini Live session,
     * streams the Leda audio, and resolves only after all audio has played.
     * Never throws — if the student WS is unavailable, resolves immediately.
     */
    const speakAsStudent = (text: string): Promise<void> => {
      // If the student WebSocket is gone, skip TTS and continue the demo
      if (!studentClient.ws || studentClient.ws.readyState !== WebSocket.OPEN) {
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        let resolved = false;
        const done = () => {
          if (!resolved) {
            resolved = true;
            resolve();
          }
        };

        const timeout = setTimeout(done, 25_000);

        const onTurnComplete = () => {
          studentClient.off("turncomplete", onTurnComplete);
          // Flush remaining buffer; onComplete fires when playback finishes
          studentStreamer.complete();
        };

        studentStreamer.onComplete = () => {
          clearTimeout(timeout);
          done();
        };

        studentClient.on("turncomplete", onTurnComplete);
        try {
          studentClient.send([{ text }]);
        } catch (e) {
          // WebSocket closed between the check and the send — skip TTS
          clearTimeout(timeout);
          studentClient.off("turncomplete", onTurnComplete);
          resolve();
        }
      });
    };

    try {
      // ── 0. Connect student client ──────────────────────────────────────────
      await studentClient.connect();
      await waitForEvent(studentClient, "setupcomplete", 12_000);
      await studentStreamer.resume();

      // ── 1. Connect SPARK ───────────────────────────────────────────────────
      if (!connected) {
        connect();
        await waitForEvent(client, "setupcomplete", 15_000);
        await sleep(1800);
      }

      // Wait for SPARK's opening greeting
      await waitForEvent(client, "turncomplete", 28_000);
      await sleep(600);

      const draw = canvasRef.current?.drawStudentContent;
      if (!draw) return;

      // ── 2. Student introduction ────────────────────────────────────────────
      await speakAsStudent(
        "Um... hi SPARK? My name is Alex. I have my math homework and I'm really really stuck. Can you help me?",
      );
      client.send([
        {
          text: "Um... hi SPARK? My name is Alex. I have my math homework and I'm really really stuck. Can you help me?",
        },
      ]);
      await waitForEvent(client, "turncomplete", 28_000);
      await sleep(700);

      // ── 3. Draw the triangle FIRST (silent, thinking) ─────────────────────
      // Student draws quietly while SPARK watches — then explains what they drew

      await draw([{ type: "line", x1: 0.08, y1: 0.68, x2: 0.44, y2: 0.68, duration: 1000 }]);
      await sleep(350);
      await draw([{ type: "line", x1: 0.44, y1: 0.68, x2: 0.44, y2: 0.24, duration: 1000 }]);
      await sleep(250);
      await draw([{ type: "line", x1: 0.08, y1: 0.68, x2: 0.44, y2: 0.24, duration: 1200 }]);
      await sleep(300);

      // Right-angle marker
      await draw([
        { type: "line", x1: 0.44, y1: 0.62, x2: 0.38, y2: 0.62, duration: 200 },
        { type: "line", x1: 0.38, y1: 0.62, x2: 0.38, y2: 0.68, duration: 200 },
      ]);
      await sleep(400);

      // Labels
      await draw([{ type: "text", text: "a = 3", x: 0.22, y: 0.71, fontSize: 20, duration: 380 }]);
      await sleep(150);
      await draw([{ type: "text", text: "b = 4", x: 0.46, y: 0.44, fontSize: 20, duration: 380 }]);
      await sleep(150);
      await draw([{ type: "text", text: "c = ?", x: 0.17, y: 0.36, fontSize: 20, duration: 380 }]);
      await sleep(500);

      // NOW the student speaks about what they drew
      await speakAsStudent(
        "Ok so... I drew this right triangle. The sides are a equals 3 and b equals 4, and I have to find c. My teacher said something about a squared plus b squared equals c squared but... I don't really get what that means.",
      );
      client.send([
        {
          text: "The sides are a equals 3 and b equals 4. I have to find c. My teacher said a² plus b² equals c² but I don't really understand what that means or how to use it.",
        },
      ]);
      await waitForEvent(client, "turncomplete", 32_000);
      await sleep(900);

      // ── 5. Classic mistake ─────────────────────────────────────────────────
      await speakAsStudent(
        "Ohh wait... do I just like... add them? So c equals 3 plus 4 equals 7?",
      );
      await draw([
        {
          type: "text",
          text: "c = 3+4 = 7 ?",
          x: 0.54,
          y: 0.44,
          fontSize: 19,
          color: "#F3F0FF",
          duration: 650,
        },
      ]);
      await sleep(400);
      client.send([{ text: "Oh wait... is c just 3 plus 4? So c equals 7?" }]);
      await waitForEvent(client, "turncomplete", 28_000);
      await sleep(1000);

      // ── 6. Breakthrough ───────────────────────────────────────────────────
      await speakAsStudent(
        "Ohhh... so I have to multiply each number by itself first? Like... 3 times 3?",
      );
      await sleep(400);

      await draw([
        { type: "text", text: "3² = 9", x: 0.54, y: 0.26, fontSize: 20, color: "#34D399", duration: 420 },
      ]);
      await sleep(500);
      await speakAsStudent("That's 9. And 4 times 4...");
      await draw([
        { type: "text", text: "4² = 16", x: 0.54, y: 0.37, fontSize: 20, color: "#34D399", duration: 420 },
      ]);
      await sleep(400);
      await speakAsStudent("That's 16. So now I add them... 9 plus 16 is...");
      await draw([
        {
          type: "text",
          text: "9 + 16 = 25",
          x: 0.54,
          y: 0.50,
          fontSize: 20,
          color: "#FBBF24",
          duration: 520,
        },
      ]);
      await sleep(350);

      await speakAsStudent(
        "25! So c squared is 25! And the square root of 25 is... 5! C equals 5! I GOT IT!",
      );
      await draw([
        {
          type: "text",
          text: "c = √25 = 5 ✓",
          x: 0.52,
          y: 0.62,
          fontSize: 22,
          color: "#FF8A65",
          duration: 650,
        },
      ]);
      await sleep(500);

      client.send([
        {
          text: "Oh! I have to SQUARE the sides first! So 3² is 9, 4² is 16, and 9 plus 16 equals 25! So c squared is 25, which means c is the square root of 25, which is 5! I actually got it!",
        },
      ]);
      await waitForEvent(client, "turncomplete", 30_000);
      await sleep(1200);

      // ── 7. Ask SPARK to write the formula ────────────────────────────────
      await speakAsStudent(
        "SPARK can you please write the Pythagorean theorem formula on the canvas? Like big and clear so I can remember it?",
      );
      client.send([
        {
          text: "SPARK, can you write the Pythagorean theorem formula on the canvas for me? Nice and big so I can see it clearly!",
        },
      ]);
      await waitForEvent(client, "turncomplete", 30_000);
      await sleep(1000);

      // ── 8. The big question — what is SPARK ──────────────────────────────
      await speakAsStudent(
        "SPARK... can I ask you something? Like... what exactly ARE you? Because you watched me draw, you saw my mistake, you talked to me, AND you wrote on my canvas at the same time. No app has ever done that before.",
      );
      client.send([
        {
          text: "SPARK, what exactly are you? You watched me draw my triangle, you caught my mistake when I said c equals 7, you explained it step by step, and you wrote the formula right on my canvas while talking to me. No app has ever done that. What makes you different from just googling the answer?",
        },
      ]);
      await waitForEvent(client, "turncomplete", 35_000);
      await sleep(1000);

      // ── 9. Impact question ────────────────────────────────────────────────
      await speakAsStudent(
        "That's so cool. Do you think every kid could use something like this? Like kids who can't afford real tutors?",
      );
      client.send([
        {
          text: "Do you think every student could use something like this? Even kids who can't afford a real tutor?",
        },
      ]);
      await waitForEvent(client, "turncomplete", 30_000);
      await sleep(800);

      // ── 10. Closing ───────────────────────────────────────────────────────
      await speakAsStudent(
        "I really wish I had SPARK when I was struggling in class. This is honestly the coolest thing I've ever used. Thank you SPARK!",
      );
      client.send([
        {
          text: "I really wish I had SPARK when I was struggling in class. This is the coolest thing I've ever used for school. Thank you!",
        },
      ]);
      await waitForEvent(client, "turncomplete", 28_000);
    } catch (err) {
      console.error("[DemoAgent] error:", err);
    } finally {
      studentClient.off("audio", onStudentAudio);
      studentClient.disconnect();
      studentStreamer.stop();
      audioCtx.close();
      setMuted(false);
      runningRef.current = false;
      setIsDemoRunning(false);
    }
  }, [client, connected, connect, canvasRef, setMuted]);

  return { startDemo, isDemoRunning };
}

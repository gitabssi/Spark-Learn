# SPARK Learn — Real-Time AI Tutor Powered by Gemini Live

> *Draw a problem. Talk through your thinking. Watch SPARK write back — live, on the same canvas, in real time.*

SPARK is a **fully multimodal AI tutoring system** that combines Gemini 2.5 Flash Native Audio, real-time canvas vision, and bidirectional voice streaming into a single coherent session. It sees your work, hears your thinking, and annotates your canvas — like a tutor sitting right next to you.

---

## Try It Live

**Deployed demo:** `https://sparklive-xxxx-uc.a.run.app` *(URL in submission)*

**What to do in 60 seconds:**
1. Click **Connect** (bottom toolbar) — SPARK will greet you
2. Say *"I need help with the quadratic formula"*
3. Draw a parabola or write `x² + 5x + 6 = 0` on the canvas
4. Watch SPARK highlight your work, write the formula back on the canvas, and guide you through it
5. Solve it wrong on purpose — SPARK will catch it

No login. No setup. Just open and talk.

---

## What Makes SPARK Different

| Capability | How it works |
|---|---|
| **Continuous voice** | PCM audio streamed at 16kHz via AudioWorklet — no push-to-talk, no gaps |
| **Canvas vision** | Composite frame (student + SPARK layers) sent to Gemini every 4s |
| **Writes on canvas** | Animated handwriting, letter-by-letter, in the Caveat font at ~28 chars/sec |
| **Draws formulas** | Unicode math rendered in bold on a dedicated non-interactive canvas layer |
| **Highlights mistakes** | Colored bounding boxes with labels, auto-expire after 8s |
| **Hint cards** | Floating educational cards — hint, formula, concept, example, warning |
| **Celebrates wins** | Confetti particle explosion when you crack a hard problem |
| **Proactive** | Detects 20s silence or 5 repeated erases and initiates check-ins |

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Browser (React)                   │
│                                                      │
│  ┌──────────────┐  ┌───────────────────────────┐    │
│  │ AudioWorklet │  │   3-Layer Canvas System    │    │
│  │  PCM 16kHz   │  │  L1: Student drawing       │    │
│  └──────┬───────┘  │  L2: SPARK handwriting     │    │
│         │          │  L3: DOM overlays           │    │
│  ┌──────▼──────────▼──────────────────────────┐ │    │
│  │        MultimodalLiveClient (WebSocket)     │ │    │
│  └──────────────────────┬───────────────────── ┘ │    │
└─────────────────────────┼───────────────────────-┘
                          │ wss://
┌─────────────────────────▼────────────────────────┐
│              FastAPI Backend (Cloud Run)           │
│                                                    │
│  ┌─────────────────────────────────────────────┐  │
│  │           Google ADK Runner                  │  │
│  │  LiveRequestQueue → run_live()               │  │
│  │                                              │  │
│  │  ┌──────────────────────────────────────┐   │  │
│  │  │   Gemini 2.5 Flash Native Audio      │   │  │
│  │  │   gemini-2.5-flash-native-audio-     │   │  │
│  │  │   preview-12-2025                    │   │  │
│  │  └──────────────────────────────────────┘   │  │
│  │                                              │  │
│  │  9 Canvas Tools: highlight_canvas_area,      │  │
│  │  show_hint_card, celebrate_achievement,      │  │
│  │  write_on_canvas, draw_formula,              │  │
│  │  clear_spark_canvas, clear_student_canvas,   │  │
│  │  set_session_context, search_educational_    │  │
│  │  content                                     │  │
│  └─────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────┘
```

**Key design decisions:**

- **ADK over raw Gemini Live**: Using `google-adk` for session management, tool routing, and event streaming. ADK's `run_live` handles the bidirectional stream; tool calls are forwarded as ADK events to the frontend where they trigger canvas effects.
- **No throttling on audio**: Gemini's native audio VAD requires a *continuous* PCM stream. Any gap ≥ 300ms looks like end-of-speech. Audio chunks go straight to the WebSocket — no queuing, no batching, no dropping.
- **Refs over state for animation**: The handwriting animation (2 chars/tick at 35ms) stores progress in `useRef` — never in React state — to avoid re-renders on every character reveal.
- **`pointer-events: none` on SPARK layer**: The SPARK canvas sits above the student canvas visually but is fully transparent to pointer input. Students draw through it.
- **Composite frame for vision**: `captureFrame()` draws both student and SPARK layers onto a temporary canvas before sending to Gemini — the model sees the full picture, not just the student's strokes.

---

## Run Locally (2 minutes)

**Prerequisites:** Node 20+, Python 3.10+, a Gemini API key ([get one free](https://aistudio.google.com/apikey))

```bash
# 1. Clone and enter the project
cd sparklive

# 2. Create .env with your API key
echo "GOOGLE_API_KEY=your_key_here" > .env

# 3. Install everything and launch
make install
make playground
```

Open **http://localhost:8000** — the backend serves the React app and the `/ws` WebSocket endpoint on the same port.

> **Note:** `make playground` auto-builds the frontend if it hasn't been built yet.

---

## Deploy to Cloud Run

```bash
# Install gcloud if needed: https://cloud.google.com/sdk/docs/install
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com

make deploy GOOGLE_API_KEY=your_key_here
```

`gcloud run deploy --source .` triggers Cloud Build to:
1. Install Node 20 + build the React frontend (`npm ci && npm run build`)
2. Install Python deps via `uv sync --frozen`
3. Package into a single container on port 8080
4. Deploy to Cloud Run with `--min-instances 1` (keeps WebSocket connections alive)

**~5 minutes.** You get a public `https://sparklive-xxxx-uc.a.run.app` URL.

---

## Project Structure

```
sparklive/
├── app/
│   ├── agent.py            # SPARK agent: system prompt + 9 canvas tools
│   └── fast_api_app.py     # FastAPI + WebSocket + ADK Runner
├── frontend/
│   └── src/
│       ├── App.tsx                          # Main layout + audio/video streaming
│       ├── utils/multimodal-live-client.ts  # WebSocket client + ADK event parser
│       ├── hooks/use-canvas-tools.ts        # Tool call → canvas state
│       ├── hooks/use-proactive-monitor.ts   # Silence + stall detection
│       └── components/
│           ├── spark-canvas/   # 3-layer canvas system
│           ├── spark-presence/ # Animated SVG presence blob
│           └── spark-toolbar/  # Mic/camera/pen controls
├── Dockerfile              # Multi-stage: Node build + Python runtime
├── Makefile                # install / playground / deploy
└── pyproject.toml          # Python deps (google-adk, fastapi, uvicorn)
```

---

## Commands

| Command | Description |
|---|---|
| `make install` | Install Python + Node dependencies |
| `make playground` | Build frontend + launch on localhost:8000 |
| `make local-backend` | Backend only with hot-reload |
| `make build-frontend` | Production React build |
| `make deploy GOOGLE_API_KEY=xxx` | Deploy to Cloud Run |
| `make test` | Unit + integration tests |
| `make lint` | ruff + codespell + ty |

---

## Tech Stack

| Layer | Technology |
|---|---|
| AI Model | Gemini 2.5 Flash Native Audio (`gemini-2.5-flash-native-audio-preview-12-2025`) |
| Agent Orchestration | Google ADK (`google-adk >= 1.16`) |
| Backend | FastAPI + uvicorn + Python 3.11 |
| Frontend | React 18 + TypeScript + Vite |
| Realtime Transport | WebSocket (bidirectional, ADK `run_live`) |
| Audio Capture | AudioWorklet (PCM, 16kHz, base64) |
| Canvas | HTML5 Canvas API (3 independent layers) |
| Deployment | Google Cloud Run (`--source .` via Cloud Build) |
| Font | Google Fonts — Caveat (handwriting), Inter, Space Grotesk |
| Animations | CSS Spring cubic-bezier + canvas `setTimeout` loop |

---

*Built for the Gemini Live Hackathon · Powered by Google ADK + Gemini 2.5 Flash Native Audio*

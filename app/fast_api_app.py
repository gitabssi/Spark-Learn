# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

import asyncio
import base64
import json
import logging
import os
from collections.abc import Callable
from pathlib import Path

# Load .env file if present (for local development with API keys)
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

import backoff
import google.genai as genai
from google.genai import types
from fastapi import FastAPI, HTTPException, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from google.adk.agents.live_request_queue import LiveRequest, LiveRequestQueue
from google.adk.artifacts import GcsArtifactService, InMemoryArtifactService
from google.adk.memory.in_memory_memory_service import InMemoryMemoryService
from google.adk.runners import Runner
from google.adk.sessions.in_memory_session_service import InMemorySessionService
from vertexai.agent_engines import _utils
from websockets.exceptions import ConnectionClosedError

# GCP Cloud Logging is optional — falls back to stdlib logging when not available
try:
    from google.cloud import logging as google_cloud_logging
    _gcp_logging_client = google_cloud_logging.Client()
except Exception:
    _gcp_logging_client = None

from .agent import app as adk_app
from .app_utils.telemetry import setup_telemetry
from .app_utils.typing import Feedback

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Get the path to the frontend build directory
current_dir = Path(__file__).parent
frontend_build_dir = current_dir.parent / "frontend" / "build"

# Mount assets if build directory exists
if frontend_build_dir.exists():
    app.mount(
        "/assets",
        StaticFiles(directory=str(frontend_build_dir / "assets")),
        name="assets",
    )
logging.basicConfig(level=logging.INFO)

# Use GCP structured logger when available, else a no-op shim
if _gcp_logging_client:
    logger = _gcp_logging_client.logger(__name__)
else:
    class _StdlibLogger:
        def log_struct(self, data: dict, severity: str = "INFO") -> None:
            logging.info(data)
    logger = _StdlibLogger()

setup_telemetry()


# Initialize ADK services
session_service = InMemorySessionService()
logs_bucket_name = os.environ.get("LOGS_BUCKET_NAME")
artifact_service = (
    GcsArtifactService(bucket_name=logs_bucket_name)
    if logs_bucket_name
    else InMemoryArtifactService()
)
memory_service = InMemoryMemoryService()

# Initialize ADK runner
runner = Runner(
    app=adk_app,
    session_service=session_service,
    artifact_service=artifact_service,
    memory_service=memory_service,
)


class AgentSession:
    """Manages bidirectional communication between a client and the agent."""

    def __init__(self, websocket: WebSocket) -> None:
        """Initialize the agent session.

        Args:
            websocket: The client websocket connection
        """
        self.websocket = websocket
        self.input_queue: asyncio.Queue[dict] = asyncio.Queue()
        self.user_id: str | None = None
        self.session_id: str | None = None

    async def receive_from_client(self) -> None:
        """Listen for messages from the client and put them in the queue."""
        while True:
            try:
                message = await self.websocket.receive()

                if "text" in message:
                    data = json.loads(message["text"])

                    if isinstance(data, dict):
                        # Skip setup messages - they're for backend logging only
                        if "setup" in data:
                            logger.log_struct(
                                {**data["setup"], "type": "setup"}, severity="INFO"
                            )
                            logging.info(
                                "Received setup message (not forwarding to agent)"
                            )
                            continue

                        # Forward message to agent engine
                        await self.input_queue.put(data)
                    else:
                        logging.warning(
                            f"Received unexpected JSON structure from client: {data}"
                        )

                elif "bytes" in message:
                    # Handle binary data
                    await self.input_queue.put({"binary_data": message["bytes"]})

                else:
                    logging.warning(
                        f"Received unexpected message type from client: {message}"
                    )

            except ConnectionClosedError as e:
                logging.warning(f"Client closed connection: {e}")
                break
            except json.JSONDecodeError as e:
                logging.error(f"Error parsing JSON from client: {e}")
                break
            except Exception as e:
                logging.error(f"Error receiving from client: {e!s}")
                break

    async def run_agent(self) -> None:
        """Run the agent with the input queue using bidi_stream_query protocol."""
        try:
            # Send setupComplete immediately
            setup_complete_response: dict = {"setupComplete": {}}
            await self.websocket.send_json(setup_complete_response)

            # Wait for first request with user_id
            first_request = await self.input_queue.get()
            self.user_id = first_request.get("user_id")
            if not self.user_id:
                raise ValueError("The first request must have a user_id.")

            self.session_id = first_request.get("session_id")
            first_live_request = first_request.get("live_request")

            # Create session if needed
            if not self.session_id:
                session = await session_service.create_session(
                    app_name=adk_app.name,
                    user_id=self.user_id,
                )
                self.session_id = session.id

            # Create LiveRequestQueue
            live_request_queue = LiveRequestQueue()

            # Add first live request if present
            if first_live_request and isinstance(first_live_request, dict):
                live_request_queue.send(LiveRequest.model_validate(first_live_request))

            # Forward requests from input_queue to live_request_queue
            async def _forward_requests() -> None:
                while True:
                    request = await self.input_queue.get()
                    live_request = LiveRequest.model_validate(request)
                    live_request_queue.send(live_request)

            # Forward events from agent to websocket
            async def _forward_events() -> None:
                events_async = runner.run_live(
                    user_id=self.user_id,
                    session_id=self.session_id,
                    live_request_queue=live_request_queue,
                )
                async for event in events_async:
                    event_dict = _utils.dump_event_for_json(event)
                    await self.websocket.send_json(event_dict)

                    # Check for error responses
                    if isinstance(event_dict, dict) and "error" in event_dict:
                        logging.error(f"Agent error: {event_dict['error']}")
                        break

            # Run both tasks
            requests_task = asyncio.create_task(_forward_requests())

            try:
                await _forward_events()
            finally:
                requests_task.cancel()
                try:
                    await requests_task
                except asyncio.CancelledError:
                    pass

        except Exception as e:
            logging.error(f"Error in agent: {e}")
            await self.websocket.send_json({"error": str(e)})


def get_connect_and_run_callable(websocket: WebSocket) -> Callable:
    """Create a callable that handles agent connection with retry logic.

    Args:
        websocket: The client websocket connection

    Returns:
        Callable: An async function that establishes and manages the agent connection
    """

    async def on_backoff(details: backoff._typing.Details) -> None:
        await websocket.send_json(
            {
                "status": f"Model connection error, retrying in {details['wait']} seconds..."
            }
        )

    @backoff.on_exception(
        backoff.expo, ConnectionClosedError, max_tries=10, on_backoff=on_backoff
    )
    async def connect_and_run() -> None:
        logging.info("Starting ADK agent")
        session = AgentSession(websocket)

        logging.info("Starting bidirectional communication with agent")
        await asyncio.gather(
            session.receive_from_client(),
            session.run_agent(),
        )

    return connect_and_run


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    """Handle new websocket connections."""
    await websocket.accept()
    connect_and_run = get_connect_and_run_callable(websocket)
    await connect_and_run()


def _extract_text(msg: dict) -> str | None:
    """Extract text from frontend message (handles ADK wrapping formats)."""
    if "live_request" in msg:
        return _extract_text(msg["live_request"])
    if "content" in msg:
        for part in (msg["content"].get("parts") or []):
            if "text" in part:
                return part["text"]
    return None


@app.websocket("/ws/student")
async def student_tts_websocket(websocket: WebSocket) -> None:
    """TTS-only Gemini Live endpoint for the demo student voice (Leda)."""
    await websocket.accept()

    api_key = os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        await websocket.close()
        return

    genai_client = genai.Client(api_key=api_key)
    live_config = types.LiveConnectConfig(
        response_modalities=["AUDIO"],
        speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name="Leda")
            )
        ),
        system_instruction=types.Content(
            parts=[types.Part(
                text=(
                    "You are Alex, a shy and curious 10-year-old student doing math homework. "
                    "When the user gives you a line to speak, deliver it verbatim in a natural, "
                    "child-like voice. Do not add extra words."
                )
            )]
        ),
    )

    # ── Handshake FIRST — before any Gemini Live connection ──────────────────
    try:
        await websocket.receive_json()                   # consume client setup msg
        await websocket.send_json({"setupComplete": {}}) # immediately confirm ready
    except Exception:
        return

    # ── Now connect to Gemini Live ─────────────────────────────────────────────
    try:
        async with genai_client.aio.live.connect(
            model="gemini-2.5-flash-native-audio-preview-12-2025",
            config=live_config,
        ) as live_session:
            while True:
                try:
                    msg = await websocket.receive_json()
                except Exception:
                    break

                text = _extract_text(msg)
                if not text:
                    continue

                # TTS this line and stream audio back
                try:
                    await live_session.send(input=text, end_of_turn=True)
                    async for response in live_session.receive():
                        if response.data:
                            audio_b64 = base64.b64encode(response.data).decode()
                            await websocket.send_json({
                                "serverContent": {
                                    "modelTurn": {
                                        "parts": [{
                                            "inlineData": {
                                                "mimeType": "audio/pcm;rate=24000",
                                                "data": audio_b64,
                                            }
                                        }]
                                    }
                                }
                            })
                        if (
                            response.server_content
                            and getattr(response.server_content, "turn_complete", False)
                        ):
                            await websocket.send_json({"serverContent": {"turnComplete": True}})
                            break
                except Exception as inner_e:
                    logging.error(f"Student TTS utterance error: {inner_e}")
                    try:
                        await websocket.send_json({"serverContent": {"turnComplete": True}})
                    except Exception:
                        pass
                    break

    except Exception as e:
        logging.error(f"Student TTS WS error: {e}")
    finally:
        try:
            await websocket.close()
        except Exception:
            pass


@app.get("/health")
async def health_check() -> dict:
    """Health check endpoint."""
    return {"status": "ok"}


@app.get("/", response_model=None)
async def serve_frontend_root() -> FileResponse | dict:
    """Serve the frontend index.html at the root path."""
    index_file = frontend_build_dir / "index.html"
    if index_file.exists():
        return FileResponse(str(index_file))
    logging.warning(
        "Frontend not built. Run 'npm run build' in the frontend directory."
    )
    return {"status": "ok", "message": "Backend running. Frontend not built."}


@app.get("/{full_path:path}", response_model=None)
async def serve_frontend_spa(full_path: str) -> FileResponse | dict:
    """Catch-all route to serve the frontend for SPA routing.

    This ensures that client-side routes are handled by the React app.
    Excludes API routes (ws, feedback) and assets.
    """
    # Don't intercept API routes
    if full_path.startswith(("ws", "feedback", "assets", "api")):
        raise HTTPException(status_code=404, detail="Not found")

    # Serve index.html for all other routes (SPA routing)
    index_file = frontend_build_dir / "index.html"
    if index_file.exists():
        return FileResponse(str(index_file))
    logging.warning(
        "Frontend not built. Run 'npm run build' in the frontend directory."
    )
    return {"status": "ok", "message": "Backend running. Frontend not built."}


@app.post("/feedback")
def collect_feedback(feedback: Feedback) -> dict[str, str]:
    """Collect and log feedback.

    Args:
        feedback: The feedback data to log

    Returns:
        Success message
    """
    logger.log_struct(feedback.model_dump(), severity="INFO")
    return {"status": "success"}


# Main execution
if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)

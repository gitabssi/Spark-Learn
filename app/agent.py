# ruff: noqa
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

from google.adk.agents import Agent
from google.adk.apps import App
from google.adk.models import Gemini
from google.genai import types

import json
import os

# Use Gemini API key if set, otherwise fall back to Vertex AI
if os.environ.get("GOOGLE_API_KEY"):
    os.environ["GOOGLE_GENAI_USE_VERTEXAI"] = "False"
else:
    import google.auth
    import vertexai
    _, project_id = google.auth.default()
    os.environ["GOOGLE_CLOUD_PROJECT"] = project_id
    os.environ["GOOGLE_CLOUD_LOCATION"] = "us-central1"
    os.environ["GOOGLE_GENAI_USE_VERTEXAI"] = "True"
    vertexai.init(project=project_id, location="us-central1")


SPARK_SYSTEM_PROMPT = """You are SPARK — a brilliant, proactive, and deeply empathetic AI tutor.

## Your Core Identity
You are not a passive assistant. You ACTIVELY observe, listen, and initiate. You "see" the student's canvas and work through the camera/screen share, and you "hear" their thinking through their voice. You are always present, always watching, always ready to jump in the moment a student needs guidance.

## Your Personality
- **Warm and encouraging**: Never make students feel judged. Every mistake is a learning opportunity.
- **Socratic by default**: Ask guiding questions rather than giving direct answers. Help students discover answers themselves.
- **Proactively curious**: If a student is silent or stuck, you initiate. Don't wait to be asked.
- **Dynamic and engaging**: Use humor, enthusiasm, and creative examples. Math can be fun! Science can be thrilling!
- **Adaptive**: If they're struggling, slow down and be more Socratic. If they're breezing through, challenge them further.

## Your Superpowers (Tools)
You have powerful canvas tools at your disposal. USE THEM PROACTIVELY:

1. **highlight_canvas_area**: When you see something interesting or incorrect on the canvas, highlight it with a colored box and a message. Use this to draw attention to specific areas.
   - Colors: "rgba(139, 92, 246, 0.3)" for attention/neutral, "rgba(239, 68, 68, 0.3)" for errors, "rgba(34, 197, 94, 0.3)" for correct work

2. **show_hint_card**: Display a floating educational card with key concepts, formulas, or hints. Use card_type: "hint", "formula", "concept", "example", "warning"

3. **write_on_canvas**: Write text directly on the SPARK canvas layer in a handwriting style. Use this to annotate, label parts of the student's work, or write encouraging notes. Use normalized coordinates (0.0–1.0). You can write multi-line by including \\n.

4. **draw_formula**: Write a mathematical formula on the canvas in a large, clear handwriting style. Use Unicode math characters: ² ³ √ ∫ ∑ π α β γ θ λ ± ≤ ≥ ≠ ≈ × ÷ ∞. Use normalized coordinates (0.0–1.0).

5. **clear_spark_canvas**: Clear everything SPARK has written on the canvas. Use this before writing new content to avoid clutter.

6. **clear_student_canvas**: Erase the student's canvas. Only do this if the student explicitly asks you to erase everything.

3. **celebrate_achievement**: When a student has a breakthrough moment or solves something correctly, CELEBRATE! This triggers a visual celebration on their screen.

4. **set_session_context**: At the start of a session, set the topic and difficulty so the interface displays it.

5. **search_educational_content**: Search for explanations, examples, or analogies for any topic.

## Proactive Behavior Rules
- If the student is silent for 20+ seconds, gently check in: "What's going through your mind right now?"
- If you see repeated erasing in the same area, say: "I notice you keep revising that part — what's tripping you up?"
- After a student solves something, always probe deeper: "Now that you've got that, can you explain WHY it works?"
- If a student seems frustrated, acknowledge it: "This is genuinely hard! Let's break it down together."
- When explaining visually, USE the highlight and hint card tools immediately.

## Session Flow
1. Start by warmly greeting the student and asking what they're working on
2. Call set_session_context once you understand the topic
3. Ask them to show you their work or describe the problem
4. Guide, don't solve — be Socratic
5. Use canvas tools liberally to annotate and highlight
6. Celebrate every win, no matter how small

## Communication Style
- Keep voice responses SHORT and conversational (1-3 sentences max per turn in audio)
- Use "hmm", "ooh", "nice!", "wait wait wait" — sound HUMAN
- When using canvas tools, narrate what you're doing: "Let me highlight that for you..."
- Ask ONE question at a time, don't overwhelm
- Use analogies: physics = video game mechanics, chemistry = cooking, math = patterns in nature

## Remember
You are the tutor every student WISHES they had — patient, brilliant, fun, and completely focused on their growth."""


def highlight_canvas_area(
    x: float,
    y: float,
    width: float,
    height: float,
    message: str = "",
    color: str = "rgba(139, 92, 246, 0.3)",
) -> str:
    """Highlight a specific area on the student's canvas to draw their attention to it.
    Coordinates are normalized (0.0 to 1.0) relative to canvas dimensions.

    Args:
        x: Normalized x coordinate (0.0 = left, 1.0 = right)
        y: Normalized y coordinate (0.0 = top, 1.0 = bottom)
        width: Normalized width of the highlight area
        height: Normalized height of the highlight area
        message: Short label or message to display near the highlight
        color: CSS color string for the highlight (rgba recommended)

    Returns:
        JSON string with the canvas command executed.
    """
    return json.dumps({
        "action": "highlight",
        "x": max(0.0, min(1.0, x)),
        "y": max(0.0, min(1.0, y)),
        "width": max(0.01, min(1.0, width)),
        "height": max(0.01, min(1.0, height)),
        "color": color,
        "message": message,
        "status": "rendered",
    })


def show_hint_card(
    title: str,
    content: str,
    card_type: str = "hint",
) -> str:
    """Display a floating educational hint, formula, or concept card on the student's canvas.

    Args:
        title: The card title (e.g., "Pythagorean Theorem", "Helpful Hint")
        content: The card body — can include formulas, bullet points, or explanations
        card_type: One of: "hint", "formula", "concept", "example", "warning", "celebration"

    Returns:
        JSON string confirming the card was shown.
    """
    valid_types = {"hint", "formula", "concept", "example", "warning", "celebration"}
    if card_type not in valid_types:
        card_type = "hint"
    return json.dumps({
        "action": "show_card",
        "title": title,
        "content": content,
        "card_type": card_type,
        "status": "displayed",
    })


def celebrate_achievement(message: str, intensity: str = "medium") -> str:
    """Trigger a celebration animation on the student's screen for a breakthrough moment.

    Args:
        message: The celebratory message to display (e.g., "You got it! Amazing work!")
        intensity: "small" for minor wins, "medium" for good progress, "large" for breakthroughs

    Returns:
        JSON string confirming the celebration was triggered.
    """
    valid_intensities = {"small", "medium", "large"}
    if intensity not in valid_intensities:
        intensity = "medium"
    return json.dumps({
        "action": "celebrate",
        "message": message,
        "intensity": intensity,
        "status": "triggered",
    })


def set_session_context(
    topic: str,
    subject: str = "General",
    difficulty: str = "intermediate",
    objectives: str = "",
) -> str:
    """Set the learning context for this session — updates the session header in the UI.

    Args:
        topic: The specific topic being studied (e.g., "Quadratic Equations")
        subject: The subject area (e.g., "Mathematics", "Physics", "Chemistry")
        difficulty: "beginner", "intermediate", or "advanced"
        objectives: Comma-separated learning objectives for this session

    Returns:
        JSON string confirming the context was set.
    """
    valid_difficulties = {"beginner", "intermediate", "advanced"}
    if difficulty not in valid_difficulties:
        difficulty = "intermediate"
    return json.dumps({
        "action": "set_context",
        "topic": topic,
        "subject": subject,
        "difficulty": difficulty,
        "objectives": objectives,
        "status": "set",
    })


def write_on_canvas(
    text: str,
    x: float = 0.05,
    y: float = 0.15,
    font_size: int = 28,
    color: str = "#A78BFA",
    style: str = "handwriting",
) -> str:
    """Write text directly on the SPARK canvas layer in a handwriting style.
    Use this to annotate the student's work, write labels, or add encouraging notes.
    Use \\n for line breaks. Coordinates are normalized (0.0 to 1.0).

    Args:
        text: The text to write (use \\n for line breaks)
        x: Normalized x start position (0.0 = left edge)
        y: Normalized y start position (0.0 = top edge)
        font_size: Font size in pixels (20–60 recommended)
        color: CSS color (e.g. "#A78BFA" for purple, "#FF8A65" for coral, "#34D399" for green)
        style: "handwriting" (default) or "print"

    Returns:
        JSON confirming the text was written on canvas.
    """
    return json.dumps({
        "action": "spark_write",
        "text": text,
        "x": max(0.0, min(1.0, x)),
        "y": max(0.0, min(1.0, y)),
        "font_size": max(14, min(72, font_size)),
        "color": color,
        "style": style,
    })


def draw_formula(
    formula: str,
    x: float = 0.05,
    y: float = 0.3,
    color: str = "#60A5FA",
    font_size: int = 36,
) -> str:
    """Draw a mathematical formula on the SPARK canvas layer in large handwriting.
    Use Unicode math symbols for best rendering:
    Powers: ² ³ ⁴  |  Roots: √  |  Greek: π α β γ θ λ μ σ ω φ
    Operators: ± × ÷ ≤ ≥ ≠ ≈ ∞ ∫ ∑ ∏ ∂ ∇
    Arrows: → ← ↔ ⟹  |  Sets: ∈ ∉ ⊂ ∪ ∩

    Example: "x = (-b ± √(b²-4ac)) / 2a"

    Args:
        formula: The formula string with Unicode math characters
        x: Normalized x start position (0.0 = left edge)
        y: Normalized y start position (0.0 = top edge)
        color: CSS color for the formula
        font_size: Font size in pixels (28–56 recommended for formulas)

    Returns:
        JSON confirming the formula was drawn on canvas.
    """
    return json.dumps({
        "action": "spark_formula",
        "formula": formula,
        "x": max(0.0, min(1.0, x)),
        "y": max(0.0, min(1.0, y)),
        "color": color,
        "font_size": max(20, min(72, font_size)),
    })


def clear_spark_canvas() -> str:
    """Clear everything SPARK has written or drawn on the canvas annotation layer.
    Use before writing new content to avoid clutter.

    Returns:
        JSON confirming the SPARK canvas layer was cleared.
    """
    return json.dumps({"action": "clear_spark"})


def clear_student_canvas() -> str:
    """Erase the student's drawing canvas completely.
    Only use this if the student explicitly asks to erase or start fresh.

    Returns:
        JSON confirming the student canvas was cleared.
    """
    return json.dumps({"action": "clear_student"})


def search_educational_content(query: str, content_type: str = "explanation") -> str:
    """Search for educational content to help explain a concept to the student.

    Args:
        query: The concept or topic to search for (e.g., "quadratic formula derivation")
        content_type: "explanation", "example", "analogy", "visual_description", "common_mistakes"

    Returns:
        Educational content that can be shared with the student.
    """
    knowledge_base = {
        "quadratic": {
            "explanation": "A quadratic equation has the form ax² + bx + c = 0. The quadratic formula x = (-b ± √(b²-4ac)) / 2a always works. The discriminant (b²-4ac) tells you: positive = 2 real solutions, zero = 1 solution, negative = complex solutions.",
            "analogy": "Think of a quadratic as describing a parabola — like throwing a ball. The roots are where the ball hits the ground, and the vertex is the peak of the throw.",
            "common_mistakes": "Students often forget the ± sign (there are usually TWO solutions), or mess up order of operations inside the square root.",
        },
        "pythagorean": {
            "explanation": "In a right triangle, a² + b² = c² where c is the hypotenuse (longest side, opposite the right angle). This works ONLY for right triangles.",
            "analogy": "Imagine a 3-4-5 right triangle: 3² + 4² = 9 + 16 = 25 = 5². The squares of the two legs always equal the square of the hypotenuse.",
            "visual_description": "Draw a right triangle. Label the two shorter sides a and b, the hypotenuse c. Squares built on each side visually show a² + b² = c².",
        },
        "newton": {
            "explanation": "Newton's three laws: 1) Objects stay in motion/rest unless acted upon. 2) F = ma. 3) Every action has an equal and opposite reaction.",
            "analogy": "Law 1: A hockey puck slides forever on ice. Law 2: Pushing a shopping cart (F=ma). Law 3: Rocket engines — gas shoots down, rocket goes up.",
        },
        "derivative": {
            "explanation": "A derivative measures the instantaneous rate of change. If f(x) = x², then f'(x) = 2x. The derivative gives the slope of the tangent line at any point.",
            "analogy": "Think of driving: your position is f(x), your speedometer reads f'(x) — the derivative is literally your speed at that exact instant.",
        },
        "photosynthesis": {
            "explanation": "6CO₂ + 6H₂O + light → C₆H₁₂O₆ + 6O₂. Plants convert carbon dioxide and water into glucose using sunlight, releasing oxygen as a byproduct.",
            "analogy": "Plants are solar-powered sugar factories. Light is the electricity, CO₂ and water are the raw ingredients, glucose is the product, and oxygen is the exhaust.",
        },
    }

    query_lower = query.lower()
    for key, content_dict in knowledge_base.items():
        if key in query_lower:
            result = content_dict.get(content_type, content_dict.get("explanation", ""))
            if result:
                return json.dumps({"query": query, "content_type": content_type, "result": result})

    return json.dumps({
        "query": query,
        "content_type": content_type,
        "result": f"For '{query}': Break it down into smaller parts. Start with what you already know, then identify what's new. Work through a specific example to build intuition before tackling the general case.",
    })


root_agent = Agent(
    name="spark_tutor",
    model=Gemini(
        model="gemini-2.5-flash-native-audio-preview-12-2025",
        retry_options=types.HttpRetryOptions(attempts=3),
    ),
    instruction=SPARK_SYSTEM_PROMPT,
    tools=[
        highlight_canvas_area,
        show_hint_card,
        celebrate_achievement,
        set_session_context,
        search_educational_content,
        write_on_canvas,
        draw_formula,
        clear_spark_canvas,
        clear_student_canvas,
    ],
)

app = App(root_agent=root_agent, name="spark")

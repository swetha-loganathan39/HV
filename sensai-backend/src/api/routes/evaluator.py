from datetime import datetime
import json
from typing import AsyncGenerator, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from api.db.chat import get_task_chat_history_for_user
from api.db.task import (
    get_evaluator_reference_materials,
    get_task,
    get_task_metadata,
)
from api.llm import stream_llm_with_openai
from api.models import EvaluatorType, TaskType
from api.prompts.evaluator import (
    DELAYED_RECALL_PROMPT,
    NARRATIVE_PROMPT,
    PODCAST_PROMPT,
    QUIZ_COMPETITION_PROMPT,
    THREE_TWO_ONE_PROMPT,
)
from api.utils.logging import logger

router = APIRouter()


class EvaluatorChatRequest(BaseModel):
    task_id: int
    user_id: int
    chat_history: list[dict]
    user_response: str
    metadata: dict = {}


@router.post("/chat")
async def evaluator_chat(request: EvaluatorChatRequest):
    async def stream_response() -> AsyncGenerator[str, None]:
        task = await get_task(request.task_id)
        if not task or task["type"] != TaskType.EVALUATOR:
            raise HTTPException(status_code=404, detail="Evaluator task not found")

        evaluator_data = task.get("evaluator") or {}
        evaluator_type = evaluator_data.get(
            "evaluator_type", EvaluatorType.NARRATIVE
        )

        reference_material = await get_evaluator_reference_materials(request.task_id)

        metadata = await get_task_metadata(request.task_id)
        syllabus = metadata["course"]["name"] if metadata else "General Course"

        prompts = {
            EvaluatorType.NARRATIVE: NARRATIVE_PROMPT,
            EvaluatorType.THREE_TWO_ONE: THREE_TWO_ONE_PROMPT,
            EvaluatorType.PODCAST: PODCAST_PROMPT,
            EvaluatorType.QUIZ_COMPETITION: QUIZ_COMPETITION_PROMPT,
            EvaluatorType.DELAYED_RECALL: DELAYED_RECALL_PROMPT,
        }

        system_prompt_template = prompts.get(evaluator_type, NARRATIVE_PROMPT)
        system_prompt = system_prompt_template.format(
            learning_material=reference_material,
            syllabus=syllabus,
        )

        messages = [{"role": "system", "content": system_prompt}]

        target_evaluators = [
            EvaluatorType.NARRATIVE,
            EvaluatorType.THREE_TWO_ONE,
            EvaluatorType.DELAYED_RECALL,
        ]

        should_terminate = False
        termination_reason = ""

        if evaluator_type in target_evaluators:
            if "bye" in request.user_response.lower():
                should_terminate = True
                termination_reason = "the user said bye"

            history = await get_task_chat_history_for_user(
                request.task_id, request.user_id
            )
            if history:
                first_msg_time_value = history[0]["created_at"]
                try:
                    if isinstance(first_msg_time_value, str):
                        first_msg_time = datetime.fromisoformat(
                            first_msg_time_value.replace("Z", "+00:00")
                        )
                    else:
                        first_msg_time = first_msg_time_value

                    elapsed = (datetime.now() - first_msg_time).total_seconds()
                    if elapsed >= 180:
                        should_terminate = True
                        termination_reason = "the 3-minute time limit was reached"
                except Exception as exc:
                    logger.error(f"Error calculating elapsed time: {exc}")

        if should_terminate:
            termination_hint = (
                f"[SYSTEM] Note: {termination_reason}. You MUST now provide a final "
                "performance summary/score and end the session by setting "
                "is_finished to true in your response."
            )
            messages.append({"role": "system", "content": termination_hint})

        messages.extend(request.chat_history)
        messages.append({"role": "user", "content": request.user_response})

        class Output(BaseModel):
            response: str = Field(description="The AI's response to the student.")
            is_finished: bool = Field(
                default=False,
                description="Whether the evaluation session is complete.",
            )
            suggested_score: Optional[float] = Field(
                None,
                description="A suggested score (mocked for now).",
            )

        from api.config import openai_plan_to_model_name

        model = openai_plan_to_model_name["text"]

        full_response_text = ""
        is_session_finished = False

        async for chunk in stream_llm_with_openai(
            model=model,
            messages=messages,
            response_model=Output,
            max_output_tokens=2048,
            api_mode="chat_completions",
        ):
            content = json.dumps(chunk.model_dump()) + "\n"
            full_response_text = chunk.response
            is_session_finished = chunk.is_finished
            yield content

        if is_session_finished:
            logger.info(
                "Score updated for user %s in task %s (Evaluator: %s)",
                request.user_id,
                request.task_id,
                evaluator_type,
            )
            print(
                f"DEBUG: Score updated for user {request.user_id} in task {request.task_id}"
            )

    return StreamingResponse(
        stream_response(),
        media_type="application/x-ndjson",
    )

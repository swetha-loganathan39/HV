from fastapi import APIRouter, Depends, HTTPException, status
from typing import List, Dict, Any
from datetime import datetime

from api.models import (
    LogSignalRequest,
    UserLearningSignal,
    UserLearningProfile
)

from api.utils.scoring_engine import process_signal_and_attach_scores

router = APIRouter()

# In-memory store for demonstration without disrupting DB layer
# Replace with actual DB queries later
_MOCK_SIGNALS_DB = []
_MOCK_PROFILES_DB = {}

@router.post("/log", response_model=UserLearningSignal)
async def log_signal(
    request: LogSignalRequest, 
    # user_id typically parsed from token. Hardcoded for mock:
    user_id: int = 1
):
    """
    Logs learning signals (telemetry) from the frontend for a given task/block.
    """
    
    # Pass metadata through Scoring Engine to evaluate thresholds & weights
    # Note: task_label could be deduced from task type (e.g., mcq, coding) in the DB
    process_signal_and_attach_scores(request, task_label="default")
    
    signal = UserLearningSignal(
        id=len(_MOCK_SIGNALS_DB) + 1,
        user_id=user_id,
        task_id=request.task_id,
        completion_percentage=request.completion_percentage,
        total_watch_time=request.total_watch_time,
        duration=request.duration,
        scroll_depth=request.scroll_depth,
        time_spent=request.time_spent,
        expected_reading_time=request.expected_reading_time,
        pause_count=request.pause_count,
        seek_back_count=request.seek_back_count,
        playback_speed_avg=request.playback_speed_avg,
        skip_forward_count=request.skip_forward_count,
        active_reading_time=request.active_reading_time,
        smooth_scroll_score=request.smooth_scroll_score,
        jump_scroll_count=request.jump_scroll_count,
        text_selections=request.text_selections,
        link_clicks=request.link_clicks,
        tab_focus_time=request.tab_focus_time,
        idle_time=request.idle_time,
        continuous_interaction_time=request.continuous_interaction_time,
        revisit_frequency=request.revisit_frequency,
        repeated_sections_count=request.repeated_sections_count,
        delayed_return=request.delayed_return,
        early_exit=request.early_exit,
        metadata=request.metadata,
        created_at=datetime.utcnow()
    )
    
    _MOCK_SIGNALS_DB.append(signal)
    
    return signal

@router.get("/profile/{user_id}", response_model=UserLearningProfile)
async def get_user_profile(user_id: int):
    """
    Retrieves the computed learning profile for a user.
    """
    profile = _MOCK_PROFILES_DB.get(user_id)
    if not profile:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, 
            detail="Learning profile not found for user."
        )
    return profile

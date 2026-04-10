from typing import Dict, Any, Optional, List, Tuple
from api.models import LogSignalRequest, AggregatedScoring, MetricAnalysis

# Weightages for different task contexts as requested
# Allows dynamically weighting the final score based on the cognitive load of a task.
TASK_WEIGHT_MAP = {
    "mcq": 1.0,           # Standard weight
    "coding": 1.5,        # High cognitive load, higher weight
    "interactive": 1.2,
    "podcast": 0.8,       # Passive listening, lower weight
    "summary": 0.5,       # Very short, lowest weight
    "default": 1.0
}

def evaluate_behavior_score(signal: LogSignalRequest) -> Tuple[float, List[MetricAnalysis]]:
    """
    Aggregates interactive actions and returns (score, detailed_breakdown).
    """
    base_score = 50.0  # Start neutral
    breakdown = []

    # Interaction Signals
    if signal.metadata and signal.metadata.interaction:
        inter = signal.metadata.interaction
        
        if (inter.highlight_text_count or 0) > 0:
            imp = min(20.0, inter.highlight_text_count * 3.0)
            base_score += imp
            breakdown.append(MetricAnalysis(metric_id="highlight_text", impact_score=imp, analysis="User is actively highlighting text, indicating deep reading habits."))
            
        if (inter.copy_paste_count or 0) > 0:
            imp = min(15.0, inter.copy_paste_count * 2.0)
            base_score += imp
            breakdown.append(MetricAnalysis(metric_id="copy_paste", impact_score=imp, analysis="User is extracting key information via copy-paste actions."))

        if (inter.rage_clicks or 0) > 3:
            base_score -= 15.0
            breakdown.append(MetricAnalysis(metric_id="rage_clicks", impact_score=-15.0, analysis="Significant rage clicks detected; user is experiencing frustration with the UI or content."))

        if (inter.focus_losses or 0) > 3:
            base_score -= 15.0
            breakdown.append(MetricAnalysis(metric_id="focus_losses", impact_score=-15.0, analysis="Frequent tab focus losses; learner is distracted or multi-tasking."))
        elif (inter.focus_losses or 0) > 0:
            base_score -= 2.0
            breakdown.append(MetricAnalysis(metric_id="interaction.focus_losses", impact_score=-2.0, analysis=f"{inter.focus_losses} tab focus loss detected. Minor distraction, but perfectly normal."))

        if inter.typing_speed_wpm and inter.typing_speed_wpm > 60:
            base_score += 8.0
            breakdown.append(MetricAnalysis(metric_id="interaction.typing_speed_wpm", impact_score=8.0, analysis=f"User typed at a fluent {inter.typing_speed_wpm} WPM during interactive components. Shows high confidence and cognitive comfort."))

    # Consumption Signals
    if signal.completion_percentage >= 90.0:
        base_score += 15.0
        breakdown.append(MetricAnalysis(metric_id="completion_rate", impact_score=15.0, analysis="High completion rate showing strong persistence."))
    elif signal.completion_percentage < 30.0:
        base_score -= 10.0
        breakdown.append(MetricAnalysis(metric_id="completion_rate", impact_score=-10.0, analysis="Very low completion; content was likely abandoned quickly."))
        
    if signal.skip_forward_count > 3:
        base_score -= 10.0
        breakdown.append(MetricAnalysis(metric_id="skip_forward", impact_score=-10.0, analysis="User is skipping forward frequently, possibly bypassing core material."))

    if signal.expected_reading_time and signal.time_spent:
        if signal.time_spent < (signal.expected_reading_time * 0.25) and signal.completion_percentage > 85.0:
            base_score -= 30.0
            breakdown.append(MetricAnalysis(metric_id="skimming_detection", impact_score=-30.0, analysis="Suspiciously fast completion vs content length; user is likely skimming or 'gaming' the progress bar."))
        elif signal.time_spent >= signal.expected_reading_time:
            base_score += 12.0
            breakdown.append(MetricAnalysis(metric_id="reading_time_pacing", impact_score=12.0, analysis=f"Time spent ({signal.time_spent}s) exceeds expected reading time ({signal.expected_reading_time}s). The user is reading carefully and completely avoiding skimming."))

    if signal.total_watch_time and signal.duration and signal.duration > 0:
        ratio = signal.total_watch_time / signal.duration
        if ratio >= 0.7:
            base_score += 5.0
            breakdown.append(MetricAnalysis(metric_id="watch_time_ratio", impact_score=5.0, analysis=f"User consumed {signal.total_watch_time}s out of {signal.duration}s total duration. Indicates healthy engagement but skipped some minor visual content."))

    if signal.scroll_depth and signal.scroll_depth >= 0.9:
        base_score += 8.0
        breakdown.append(MetricAnalysis(metric_id="scroll_depth", impact_score=8.0, analysis=f"User scrolled {int(signal.scroll_depth*100)}% of the page, validating that they visually processed the entire document rather than dropping off."))

    if signal.playback_speed_avg and signal.playback_speed_avg > 1.0:
        base_score += 2.0
        breakdown.append(MetricAnalysis(metric_id="playback_speed_avg", impact_score=2.0, analysis=f"Watched at {signal.playback_speed_avg}x speed, indicating they are comfortable grasping the material at a slightly faster pace."))

    if signal.skip_forward_count == 0:
        base_score += 5.0
        breakdown.append(MetricAnalysis(metric_id="skip_forward_count", impact_score=5.0, analysis="0 skips detected. The user is thoroughly consuming the content linearly without rushing."))

    if signal.seek_back_count > 0:
        base_score += 3.0
        breakdown.append(MetricAnalysis(metric_id="seek_back_count", impact_score=3.0, analysis=f"{signal.seek_back_count} seek-back event detected; user rewound specific media once, showing intent to review or understand a complex concept."))

    if signal.tab_focus_time and signal.time_spent:
        ratio = signal.tab_focus_time / signal.time_spent
        if ratio >= 0.9:
            base_score += 15.0
            breakdown.append(MetricAnalysis(metric_id="tab_focus_time", impact_score=15.0, analysis=f"Tab was actively focused for {signal.tab_focus_time}s out of {signal.time_spent}s. The learner has practically uninterrupted focus on the material."))

    if signal.text_selections > 0:
        base_score += 5.0
        breakdown.append(MetricAnalysis(metric_id="text_selections", impact_score=5.0, analysis=f"User actively selected text {signal.text_selections} times, reading methodically."))

    return max(0.0, min(100.0, base_score)), breakdown

def evaluate_performance_score(signal: LogSignalRequest, task_label: str) -> Tuple[float, List[MetricAnalysis]]:
    """
    Evaluates performance and returns (score, detailed_breakdown).
    """
    perf_score = 50.0 # Start neutral
    breakdown = []
    
    if signal.metadata and signal.metadata.chatbot:
        chat = signal.metadata.chatbot
        
        if (chat.hints_requested or 0) > 2:
            perf_score -= 10.0
            breakdown.append(MetricAnalysis(metric_id="hints_usage", impact_score=-10.0, analysis="High reliance on hints suggests user is struggling to solve problems independently."))
        elif (chat.hints_requested or 0) > 0:
            perf_score -= 5.0
            breakdown.append(MetricAnalysis(metric_id="chatbot.hints_requested", impact_score=-5.0, analysis=f"User required {chat.hints_requested} hints, indicating they encountered a minor block in their understanding but are proactively seeking help."))
            
        if (chat.total_messages_sent or 0) > 5:
            perf_score += 15.0
            breakdown.append(MetricAnalysis(metric_id="chatbot.total_messages_sent", impact_score=15.0, analysis=f"User heavily utilized the chatbot ({chat.total_messages_sent} messages), indicating a highly inquisitive mindset."))
            
        if (chat.average_prompt_length or 0) >= 40:
            perf_score += 10.0
            breakdown.append(MetricAnalysis(metric_id="chatbot.average_prompt_length", impact_score=10.0, analysis=f"User prompts are long ({chat.average_prompt_length} chars). They are asking highly articulate, multi-part questions, not just simple queries."))
            
        if (chat.sentiment_score or 0.0) >= 0.7:
            perf_score += 20.0
            breakdown.append(MetricAnalysis(metric_id="sentiment_analysis", impact_score=20.0, analysis="User exhibits positive and confident communication with the assistant."))
        elif (chat.sentiment_score or 0.0) < 0.3:
            perf_score -= 15.0
            breakdown.append(MetricAnalysis(metric_id="sentiment_analysis", impact_score=-15.0, analysis="User tone seems frustrated or negative during the interaction."))
            
    weight = TASK_WEIGHT_MAP.get(task_label.lower(), TASK_WEIGHT_MAP["default"])
    final_perf = max(0.0, min(100.0, perf_score * weight))
    
    return final_perf, breakdown

def determine_classification(b_score: float, p_score: float) -> str:
    """
    Classifies the user based on behavior and performance.
    """
    if b_score >= 80 and p_score >= 70:
        return "HIGHLY_ENGAGED_MASTERY"
    elif b_score < 40 and p_score < 40:
        return "STRUGGLING_DISENGAGED"
    elif b_score <= 30 and p_score >= 50:
        return "SKIMMING_OR_FAKING"
    elif b_score >= 70 and p_score < 50:
        return "TRYING_HARD_BUT_STRUGGLING"
    else:
        return "AVERAGE_LEARNER"

def generate_llm_insights(signal: LogSignalRequest) -> list[str]:
    """
    Analyzes raw metrics and outputs natural language descriptions.
    These insights act as direct context instructions for the LLM.
    """
    insights = []
    
    # Consumption anomalies
    if signal.skip_forward_count > 3:
        insights.append("User is repeatedly skipping forward, indicating they might be bored or rushing.")
    if signal.pause_count > 5:
        insights.append("User is pausing frequently, potentially taking notes or struggling with the pace.")
    if signal.expected_reading_time and signal.time_spent:
        if signal.time_spent < (signal.expected_reading_time * 0.25) and signal.completion_percentage > 85.0:
            insights.append("User completed the material suspiciously fast. They are lightly skimming or faking completion.")
            
    # Interactive anomalies
    if signal.metadata and signal.metadata.interaction:
        inter = signal.metadata.interaction
        if (inter.rage_clicks or 0) > 3:
            insights.append("User exhibited significant frustration (rage clicks) on the interface.")
        if (inter.focus_losses or 0) > 3:
            insights.append("User is frequently losing focus on the tab, indicating distraction.")
        if (inter.highlight_text_count or 0) > 2:
            insights.append("User is highly active, highlighting text to read carefully.")
            
    # Chat anomalies
    if signal.metadata and signal.metadata.chatbot:
        chat = signal.metadata.chatbot
        if (chat.hints_requested or 0) >= 2:
            insights.append("User is relying heavily on hints, showing signs of struggling with the core concepts.")
        if (chat.user_interruption_count or 0) >= 2:
            insights.append("User is abruptly cutting off AI responses, showing impatience.")
            
    return insights

def process_signal_and_attach_scores(signal_request: LogSignalRequest, task_label: str = "default") -> None:
    """
    Core engine function to aggregate metrics and append the scoring directly 
    onto the structural metadata.
    """
    # Create empty metadata if None so we can attach scores
    if not signal_request.metadata:
        from api.models import AdvancedScoringMetadata
        signal_request.metadata = AdvancedScoringMetadata()
        
    b_score, b_breakdown = evaluate_behavior_score(signal_request)
    p_score, p_breakdown = evaluate_performance_score(signal_request, task_label)
    
    classification = determine_classification(b_score, p_score)
    full_breakdown = b_breakdown + p_breakdown
    
    weight_applied = TASK_WEIGHT_MAP.get(task_label.lower(), TASK_WEIGHT_MAP["default"])
    overall = (b_score * 0.6) + (p_score * 0.4) 
    
    agg_score = AggregatedScoring(
        behavior_score=round(b_score, 2),
        performance_score=round(p_score, 2),
        overall_engagement_score=round(overall, 2),
        classification=classification,
        task_weight_applied=weight_applied,
        metric_breakdown=full_breakdown
    )
    
    # Attach to the metadata
    signal_request.metadata.engine_scores = agg_score

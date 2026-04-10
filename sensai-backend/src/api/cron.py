import subprocess
from typing import Dict
from api.db.analytics import get_usage_summary_by_organization
from api.slack import send_slack_notification_for_usage_stats
from api.settings import settings
from api.slack import send_slack_notification_for_alerts


async def send_usage_summary_stats():
    """
    Get usage summary statistics for different time periods and send them via Slack webhook.

    This function retrieves usage statistics for the last week, last month, and last year,
    then sends a formatted summary to a Slack channel via webhook.
    """
    try:
        # Get usage statistics for different time periods
        last_week_stats = {
            "org": await get_usage_summary_by_organization("last_week"),
        }
        current_month_stats = {
            "org": await get_usage_summary_by_organization("current_month"),
        }
        current_year_stats = {
            "org": await get_usage_summary_by_organization("current_year"),
        }

        # Send the statistics via Slack webhook
        await send_slack_notification_for_usage_stats(
            last_week_stats, current_month_stats, current_year_stats
        )

    except Exception as e:
        print(f"Error in get_usage_summary_stats: {e}")
        raise


async def check_memory_and_raise_alert():
    if not settings.slack_alert_webhook_url:
        return

    def get_available_memory():
        # Run df -h and parse output
        result = subprocess.run(["df", "-h"], stdout=subprocess.PIPE, text=True)
        lines = result.stdout.splitlines()

        for line in lines:
            if line.startswith("overlay"):
                parts = line.split()
                avail_str = parts[3]  # Avail column (e.g. '132G')
                if avail_str.lower().endswith("g"):
                    avail_gb = float(avail_str[:-1])
                    return avail_gb

    avail_gb = get_available_memory()

    if avail_gb is None:
        return

    if avail_gb < 50:
        # Send alert if less than 50GB of memory is available
        await send_slack_notification_for_alerts(
            f"Disk space low in EC2 instance: Only {int(avail_gb)} GB left!"
        )

async def compute_learning_status():
    """
    Cron job to aggregate UserLearningSignals and determine learning profiles.
    Evaluates Consumption, Engagement, and Attention signals to assign statuses
    such as 'Learned', 'Struggling', or 'Passive', and calculates a 'faking' score.
    """
    try:
        # In a full implementation, query database for new UserLearningSignals and ChatAssessmentScores
        # Below is the logic Member 3 (Chatbot Incharge) should reference for the scoring engine math:
        
        # Pseudo-implementation using a dummy signal:
        signals = [{"completion": 100, "watch_time_sec": 60, "expected_time_sec": 600, "pauses": 0}]
        
        for sig in signals:
            faking_flag = False
            status = "learned"
            
            # Rule 1: Faking / Pass-through
            # 100% completion but watch time is drastically lower than expected time (and fast playback isn't enough to explain it)
            if sig["completion"] > 90 and sig["watch_time_sec"] < (sig["expected_time_sec"] * 0.4):
                faking_flag = True
                status = "skipped"
            
            # Rule 2: Struggling (High engagement/effort but possible confusion)
            elif sig.get("seek_back_count", 0) > 5 or sig.get("pause_count", 0) > 5:
                # If ChatScore is ALSO low, they are definitely struggling
                chat_score = 0.4 # Pull from ChatAssessmentScore for this task
                if chat_score < 0.5:
                    status = "struggling"
                else:
                    status = "partially_learned"
            
            # Rule 3: Balanced Learning
            elif sig["completion"] > 80 and sig["watch_time_sec"] >= (sig["expected_time_sec"] * 0.8):
                status = "learned"
                
            # Update Profile mathematically based on this
            print(f"Computed Profile - Faking: {faking_flag}, Status: {status}")

    except Exception as e:
        print(f"Error in compute_learning_status: {e}")
        raise

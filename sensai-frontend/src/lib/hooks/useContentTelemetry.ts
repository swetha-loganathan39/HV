import { useEffect, useRef, useCallback, useState } from 'react';

interface TelemetryOptions {
    taskId?: string;
    userId?: string;
}

function makeEmptyTelemetry(taskId?: string) {
    return {
        task_id: taskId ? parseInt(taskId) : 0,
        completion_percentage: 0.0,
        total_watch_time: 0,
        duration: 0,
        scroll_depth: 0.0,
        time_spent: 0,
        pause_count: 0,
        seek_back_count: 0,
        playback_speed_avg: 1.0,
        skip_forward_count: 0,
        active_reading_time: 0,
        smooth_scroll_score: 1.0,
        jump_scroll_count: 0,
        text_selections: 0,
        link_clicks: 0,
        tab_focus_time: 0,
        idle_time: 0,
        continuous_interaction_time: 0,
        revisit_frequency: 0,
        repeated_sections_count: 0,
        delayed_return: false,
        early_exit: false,
        metadata: {
            device: {
                os: "unknown", browser: "unknown", device_type: "desktop",
                screen_resolution: "0x0", viewport_size: "0x0",
                timezone: "UTC", language: "en-US", connection_type: "unknown"
            },
            interaction: {
                rage_clicks: 0, dead_clicks: 0, copy_paste_count: 0,
                highlight_text_count: 0, typing_speed_wpm: 0, backspace_count: 0,
                time_to_first_interaction_ms: 0, rapid_scroll_count: 0,
                focus_losses: 0, mouse_trajectory_score: 1.0
            },
            chatbot: {
                total_messages_sent: 0, average_prompt_length: 0.0,
                time_spent_reading_ai_ms: 0, hints_requested: 0,
                regenerate_requests: 0, copy_from_chat_count: 0,
                paste_into_chat_count: 0, is_frustrated: false,
                sentiment_score: 0.0, user_interruption_count: 0,
                hesitation_time_ms: 0
            },
            custom_events: { clicked_feature_guide: false, theme_switched: "light" }
        }
    };
}

// Persist telemetry across HMR / React StrictMode double-mounts using a
// module-level map keyed by taskId. This survives Fast Refresh rebuilds.
const store: Record<string, ReturnType<typeof makeEmptyTelemetry>> = {};

export function useContentTelemetry({ taskId, userId }: TelemetryOptions) {
    console.log(`[Telemetry Hook] Called for taskId: ${taskId}, userId: ${userId}`);
    const storeKey = `telemetry_${taskId ?? 'unknown'}`;

    // Always use the same object for this taskId — survives remounts
    if (!store[storeKey]) {
        store[storeKey] = makeEmptyTelemetry(taskId);
    }
    const telemetryData = useRef(store[storeKey]);

    const initTime = useRef<number>(0);
    const lastActiveTime = useRef<number>(Date.now());
    const lastScrollTop = useRef<number>(0);
    const clickTimestamps = useRef<number[]>([]);
    const currentContinuousSession = useRef<number>(0);

    const [containerNode, setContainerNode] = useState<HTMLDivElement | null>(null);
    const containerRef = useCallback((node: HTMLDivElement | null) => {
        setContainerNode(node);
    }, []);

    // Device detection once per page load
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const nav = window.navigator as any;
        const d = telemetryData.current.metadata.device;
        d.screen_resolution = `${window.screen.width}x${window.screen.height}`;
        d.viewport_size = `${window.innerWidth}x${window.innerHeight}`;
        d.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        d.language = nav.language;
        d.connection_type = nav.connection?.effectiveType ?? "unknown";
        const ua = nav.userAgent;
        if (ua.includes("Win")) d.os = "Windows";
        else if (ua.includes("Mac")) d.os = "MacOS";
        else if (ua.includes("Linux")) d.os = "Linux";
        else if (ua.includes("Android")) d.os = "Android";
        else if (ua.includes("like Mac")) d.os = "iOS";
        if (ua.includes("Chrome")) d.browser = "Chrome";
        else if (ua.includes("Firefox")) d.browser = "Firefox";
        else if (ua.includes("Safari") && !ua.includes("Chrome")) d.browser = "Safari";
        else if (ua.includes("Edge")) d.browser = "Edge";
        d.device_type = /Mobile|Android|iP(ad|hone)/.test(ua) ? "mobile" : "desktop";
        telemetryData.current.metadata.custom_events.theme_switched =
            document.documentElement.classList.contains("dark") ? "dark" : "light";
    }, []);

    useEffect(() => {
        console.log("[Telemetry Hook] useEffect triggered! containerNode is:", containerNode ? "Found! ✅" : "Null ❌");
        if (!containerNode) return;

        let isTabActive = !document.hidden;
        // Don't reset initTime on remount — keep counting from first mount
        if (initTime.current === 0) initTime.current = Date.now();
        lastActiveTime.current = Date.now();

        const updateActivityTime = () => {
            const now = Date.now();
            const delta = now - lastActiveTime.current;

            if (telemetryData.current.metadata.interaction.time_to_first_interaction_ms === 0) {
                telemetryData.current.metadata.interaction.time_to_first_interaction_ms =
                    now - initTime.current;
            }

            if (delta > 15000 && isTabActive) {
                telemetryData.current.idle_time += Math.round((delta - 15000) / 1000);
                if (currentContinuousSession.current > telemetryData.current.continuous_interaction_time) {
                    telemetryData.current.continuous_interaction_time = currentContinuousSession.current;
                }
                currentContinuousSession.current = 0;
            } else if (isTabActive) {
                telemetryData.current.active_reading_time += Math.round(delta / 1000);
                currentContinuousSession.current += Math.round(delta / 1000);
            }

            if (isTabActive) {
                telemetryData.current.tab_focus_time += Math.round(delta / 1000);
            }
            lastActiveTime.current = now;
        };

        const handleScroll = () => {
            updateActivityTime();
            const { scrollTop, scrollHeight, clientHeight } = containerNode;
            const ratio = scrollHeight > clientHeight
                ? scrollTop / (scrollHeight - clientHeight)
                : 1.0;
            if (ratio > telemetryData.current.scroll_depth) {
                telemetryData.current.scroll_depth = ratio;
                telemetryData.current.completion_percentage = ratio * 100;
            }
            const delta = Math.abs(scrollTop - lastScrollTop.current);
            if (delta > 300) {
                telemetryData.current.jump_scroll_count += 1;
                telemetryData.current.metadata.interaction.rapid_scroll_count += 1;
            }
            lastScrollTop.current = scrollTop;

            // Immediate debug log on every scroll so you can confirm listeners are firing
            console.log(`📜 scroll_depth: ${(telemetryData.current.scroll_depth * 100).toFixed(1)}%  |  pause_count: ${telemetryData.current.pause_count}  |  seek_back_count: ${telemetryData.current.seek_back_count}`);
        };

        const handleVisibilityChange = () => {
            updateActivityTime();
            if (document.hidden) {
                telemetryData.current.metadata.interaction.focus_losses += 1;
                isTabActive = false;
            } else {
                isTabActive = true;
            }
        };

        const handleClick = (e: MouseEvent) => {
            updateActivityTime();
            const now = Date.now();
            clickTimestamps.current.push(now);
            clickTimestamps.current = clickTimestamps.current.filter(t => now - t < 2000);
            if (clickTimestamps.current.length >= 3) {
                telemetryData.current.metadata.interaction.rage_clicks += 1;
                clickTimestamps.current = [];
            } else {
                const target = e.target as HTMLElement;
                if (!['A', 'BUTTON', 'INPUT', 'TEXTAREA'].includes(target.tagName) && !target.onclick) {
                    telemetryData.current.metadata.interaction.dead_clicks += 1;
                } else if (target.tagName === 'A') {
                    telemetryData.current.link_clicks += 1;
                }
            }
        };

        const handleCopyPaste = () => {
            updateActivityTime();
            telemetryData.current.metadata.interaction.copy_paste_count += 1;
        };

        const handleSelection = () => {
            const sel = document.getSelection();
            if (sel && sel.toString().length > 0) {
                telemetryData.current.text_selections += 1;
                telemetryData.current.metadata.interaction.highlight_text_count += 1;
                updateActivityTime();
            }
        };

        // Capture phase on document — catches play/pause/seeked from any
        // video nested inside BlockNoteEditor or Notion renderer
        const handlePlay = (e: Event) => {
            updateActivityTime();
            const target = e.target as HTMLMediaElement;
            if (target?.duration) telemetryData.current.duration = Math.round(target.duration);
            console.log(`▶️  video play detected | duration: ${telemetryData.current.duration}s`);
        };

        const handlePause = () => {
            updateActivityTime();
            telemetryData.current.pause_count += 1;
            console.log(`⏸️  video pause detected | pause_count: ${telemetryData.current.pause_count}`);
        };

        const handleSeeked = () => {
            updateActivityTime();
            telemetryData.current.seek_back_count += 1;
            console.log(`⏩ video seeked | seek_back_count: ${telemetryData.current.seek_back_count}`);
        };

        containerNode.addEventListener('scroll', handleScroll, { passive: true });
        containerNode.addEventListener('click', handleClick);
        document.addEventListener('visibilitychange', handleVisibilityChange);
        document.addEventListener('copy', handleCopyPaste);
        document.addEventListener('paste', handleCopyPaste);
        document.addEventListener('selectionchange', handleSelection);
        document.addEventListener('play', handlePlay, true);
        document.addEventListener('pause', handlePause, true);
        document.addEventListener('seeked', handleSeeked, true);

        const sendData = (isFinal = false) => {
            console.log("[Telemetry Hook] sendData invoked, isFinal:", isFinal);
            updateActivityTime();
            if (currentContinuousSession.current > telemetryData.current.continuous_interaction_time) {
                telemetryData.current.continuous_interaction_time = currentContinuousSession.current;
            }
            telemetryData.current.time_spent = Math.round((Date.now() - initTime.current) / 1000);
            if (isFinal && telemetryData.current.scroll_depth < 0.8) {
                telemetryData.current.early_exit = true;
            }

            const payload = {
                task_id: telemetryData.current.task_id,
                completion_percentage: Number(telemetryData.current.completion_percentage.toFixed(2)),
                total_watch_time: telemetryData.current.total_watch_time,
                duration: telemetryData.current.duration,
                scroll_depth: Number(telemetryData.current.scroll_depth.toFixed(2)),
                time_spent: telemetryData.current.time_spent,
                expected_reading_time: 300,
                pause_count: telemetryData.current.pause_count,
                seek_back_count: telemetryData.current.seek_back_count,
                playback_speed_avg: telemetryData.current.playback_speed_avg,
                skip_forward_count: telemetryData.current.skip_forward_count,
                active_reading_time: telemetryData.current.active_reading_time,
                smooth_scroll_score: telemetryData.current.smooth_scroll_score,
                jump_scroll_count: telemetryData.current.jump_scroll_count,
                text_selections: telemetryData.current.text_selections,
                link_clicks: telemetryData.current.link_clicks,
                tab_focus_time: telemetryData.current.tab_focus_time,
                idle_time: telemetryData.current.idle_time,
                continuous_interaction_time: telemetryData.current.continuous_interaction_time,
                revisit_frequency: telemetryData.current.revisit_frequency,
                repeated_sections_count: telemetryData.current.repeated_sections_count,
                delayed_return: telemetryData.current.delayed_return,
                early_exit: telemetryData.current.early_exit,
                metadata: telemetryData.current.metadata,
            };

            console.log("\n🚀 --- [TELEMETRY PAYLOAD] --- 🚀");
            console.log(JSON.stringify(payload, null, 2));
            console.log("------------------------------\n");

            fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/signals/log`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                keepalive: isFinal,
            }).catch(e => console.warn("Backend telemetry error:", e));
        };

        // Fire immediately on mount so you don't have to wait 10s to confirm it works
        console.log("✅ [Telemetry] Container mounted — listeners attached, taskId:", taskId);
        // Note: Periodic interval removed. Will only send data on unmount (when leaving the page).

        return () => {
            sendData(true);
            containerNode.removeEventListener('scroll', handleScroll);
            containerNode.removeEventListener('click', handleClick);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            document.removeEventListener('copy', handleCopyPaste);
            document.removeEventListener('paste', handleCopyPaste);
            document.removeEventListener('selectionchange', handleSelection);
            document.removeEventListener('play', handlePlay, true);
            document.removeEventListener('pause', handlePause, true);
            document.removeEventListener('seeked', handleSeeked, true);
        };
        // Re-run if taskId changes, OR if the containerNode becomes available after initial loading state clears!
    }, [containerNode, taskId]);

    return containerRef;
}
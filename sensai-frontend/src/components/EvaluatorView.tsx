import React, { useState, useEffect, useRef } from 'react';
import { Send, Loader2, Check, Clock, AlertTriangle } from 'lucide-react';
import { ChatMessage } from '@/types/quiz';
import ChatHistoryView from './ChatHistoryView';
import AudioInputComponent from './AudioInputComponent';
import { EvaluatorType } from '@/types';

interface EvaluatorViewProps {
    taskId: string | number;
    userId: string | number;
    evaluatorType: EvaluatorType;
    readOnly?: boolean;
}

const SESSION_DURATION = 180;
const TIMED_EVALUATORS = ['narrative', 'delayed_recall', '3-2-1'];

const EvaluatorView: React.FC<EvaluatorViewProps> = ({
    taskId,
    userId,
    evaluatorType,
    readOnly = false,
}) => {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [isResponding, setIsResponding] = useState(false);
    const [isHistoryLoaded, setIsHistoryLoaded] = useState(false);
    const [timeLeft, setTimeLeft] = useState<number | null>(null);
    const [isTimeUp, setIsTimeUp] = useState(false);

    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const isTimedSession = TIMED_EVALUATORS.includes(evaluatorType);

    useEffect(() => {
        const fetchHistory = async () => {
            if (!taskId || !userId || isNaN(Number(userId))) {
                setIsHistoryLoaded(true);
                return;
            }

            try {
                const response = await fetch(
                    `${process.env.NEXT_PUBLIC_BACKEND_URL}/chat/user/${userId}/task/${taskId}`
                );
                if (response.ok) {
                    const history = await response.json();
                    setMessages(history);

                    if (isTimedSession && history.length > 0) {
                        const firstMsgTime = new Date(
                            history[0].created_at || history[0].timestamp
                        ).getTime();
                        const now = new Date().getTime();
                        const elapsedSeconds = Math.floor((now - firstMsgTime) / 1000);
                        const remaining = Math.max(0, SESSION_DURATION - elapsedSeconds);
                        setTimeLeft(remaining);
                        if (remaining <= 0) {
                            setIsTimeUp(true);
                        }
                    } else if (isTimedSession) {
                        setTimeLeft(SESSION_DURATION);
                    }
                }
            } catch (error) {
                console.error('Failed to fetch chat history:', error);
            } finally {
                setIsHistoryLoaded(true);
            }
        };

        fetchHistory();
    }, [taskId, userId, isTimedSession]);

    useEffect(() => {
        if (!isTimedSession || timeLeft === null || timeLeft <= 0 || readOnly) {
            if (timeLeft === 0) {
                setIsTimeUp(true);
            }
            return;
        }

        const interval = setInterval(() => {
            setTimeLeft((prev) => {
                if (prev === null || prev <= 1) {
                    clearInterval(interval);
                    setIsTimeUp(true);
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);

        return () => clearInterval(interval);
    }, [isTimedSession, timeLeft, readOnly]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, isResponding]);

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const handleSendMessage = async (
        text: string,
        type: 'text' | 'audio' = 'text'
    ) => {
        if (!text.trim() && type === 'text') {
            return;
        }
        if (isResponding || isTimeUp) {
            return;
        }

        if (isTimedSession && messages.length === 0 && timeLeft === SESSION_DURATION) {
            setTimeLeft(SESSION_DURATION);
        }

        const userMessage: ChatMessage = {
            id: Math.random().toString(36).substring(7),
            sender: 'user',
            content: text,
            timestamp: new Date(),
            messageType: type,
        };

        const newMessages = [...messages, userMessage];
        setMessages(newMessages);
        setInput('');
        setIsResponding(true);

        try {
            const response = await fetch(
                `${process.env.NEXT_PUBLIC_BACKEND_URL}/evaluator/chat`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        task_id: typeof taskId === 'string' ? parseInt(taskId) : taskId,
                        user_id: userId,
                        chat_history: messages.map((message) => ({
                            role: message.sender === 'user' ? 'user' : 'assistant',
                            content: message.content,
                        })),
                        user_response: text,
                    }),
                }
            );

            if (!response.ok) {
                throw new Error('Failed to get response');
            }

            const reader = response.body?.getReader();
            const decoder = new TextDecoder();
            let aiContent = '';
            let isFinished = false;

            const aiMessage: ChatMessage = {
                id: Math.random().toString(36).substring(7),
                sender: 'ai',
                content: '',
                timestamp: new Date(),
                messageType: 'text',
            };

            setMessages((prev) => [...prev, aiMessage]);

            while (true) {
                const { done, value } = await reader!.read();
                if (done) {
                    break;
                }

                const chunk = decoder.decode(value);
                const lines = chunk.split('\n').filter((line) => line.trim());

                for (const line of lines) {
                    try {
                        const data = JSON.parse(line);
                        if (data.response !== null && data.response !== undefined) {
                            aiContent = data.response;
                        }
                        if (data.is_finished !== null) {
                            isFinished = data.is_finished;
                        }

                        setMessages((prev) => {
                            const updated = [...prev];
                            const lastMsg = updated[updated.length - 1];
                            if (lastMsg && lastMsg.sender === 'ai') {
                                lastMsg.content = aiContent;
                            }
                            return updated;
                        });
                    } catch (error) {
                        console.error('Error parsing JSON chunk', error);
                    }
                }
            }

            try {
                const now = new Date().toISOString();
                await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/chat/`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        messages: [
                            { role: 'user', content: userMessage.content, created_at: now },
                            { role: 'assistant', content: aiContent, created_at: now },
                        ],
                        user_id: userId,
                        task_id: typeof taskId === 'string' ? parseInt(taskId) : taskId,
                        is_complete: isFinished,
                    }),
                });
            } catch (saveError) {
                console.error(
                    'Failed to save chat history (non-critical):',
                    saveError
                );
            }
        } catch (error) {
            console.error('Chat error:', error);
            setMessages((prev) => [
                ...prev,
                {
                    id: Math.random().toString(36).substring(7),
                    sender: 'ai',
                    content:
                        "I'm sorry, I encountered an error. Please try again.",
                    timestamp: new Date(),
                    isError: true,
                },
            ]);
        } finally {
            setIsResponding(false);
        }
    };

    const handleAudioSubmit = async (audioBlob: Blob) => {
        if (isTimeUp) {
            return;
        }
        setIsResponding(true);
        try {
            const formData = new FormData();
            formData.append('file', audioBlob, 'recording.webm');

            const response = await fetch(
                `${process.env.NEXT_PUBLIC_BACKEND_URL}/audio/transcribe`,
                {
                    method: 'POST',
                    body: formData,
                }
            );

            if (!response.ok) {
                throw new Error('Failed to transcribe audio');
            }

            const data = await response.json();
            const transcribedText = data.transcript;

            if (transcribedText) {
                await handleSendMessage(transcribedText, 'audio');
            } else {
                setMessages((prev) => [
                    ...prev,
                    {
                        id: Math.random().toString(36).substring(7),
                        sender: 'ai',
                        content:
                            "I couldn't hear any speech in your recording. Please try again.",
                        timestamp: new Date(),
                        isError: true,
                    },
                ]);
            }
        } catch (error) {
            console.error('Transcription error:', error);
            setMessages((prev) => [
                ...prev,
                {
                    id: Math.random().toString(36).substring(7),
                    sender: 'ai',
                    content:
                        "I'm sorry, I couldn't transcribe your audio. Please try again.",
                    timestamp: new Date(),
                    isError: true,
                },
            ]);
        } finally {
            setIsResponding(false);
        }
    };

    return (
        <div className="flex flex-col h-full bg-slate-50 dark:bg-[#111111] relative">
            {isTimedSession && timeLeft !== null && (
                <div
                    className={`absolute top-4 right-4 z-10 flex items-center space-x-2 px-3 py-1.5 rounded-full shadow-sm border ${
                        timeLeft < 30
                            ? 'bg-red-500 text-white border-red-600 animate-pulse'
                            : 'bg-white dark:bg-[#1A1A1A] text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-800'
                    }`}
                >
                    <Clock
                        size={14}
                        className={
                            timeLeft < 30 ? 'text-white' : 'text-emerald-500'
                        }
                    />
                    <span className="text-xs font-mono font-bold">
                        {formatTime(timeLeft)}
                    </span>
                </div>
            )}

            {readOnly && (
                <div className="bg-emerald-500/10 border-b border-emerald-500/20 p-3 text-center">
                    <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                        <Check size={14} className="mr-2" /> Builder Mode: This is a
                        preview. Switch to **Preview Mode** to test the bot.
                    </p>
                </div>
            )}

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {!isHistoryLoaded ? (
                    <div className="flex items-center justify-center h-full">
                        <Loader2 className="animate-spin text-emerald-500" size={32} />
                    </div>
                ) : (
                    <ChatHistoryView
                        chatHistory={messages}
                        isAiResponding={isResponding}
                        taskType="learning_material"
                        onViewScorecard={() => {}}
                        showPreparingReport={false}
                    />
                )}
                <div ref={messagesEndRef} />
            </div>

            {!readOnly && (
                <div className="p-4 bg-white dark:bg-[#1A1A1A] border-t border-slate-200 dark:border-transparent">
                    {isTimeUp && (
                        <div className="max-w-4xl mx-auto mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center space-x-3">
                            <AlertTriangle
                                className="text-red-500 shrink-0"
                                size={18}
                            />
                            <p className="text-xs text-red-600 dark:text-red-400">
                                **Time&apos;s up!** The 3-minute limit has been
                                reached. Please wait for the AI to provide your final
                                evaluation.
                            </p>
                        </div>
                    )}
                    <div className="max-w-4xl mx-auto flex items-end space-x-2">
                        {evaluatorType === 'podcast' ? (
                            <AudioInputComponent
                                onAudioSubmit={handleAudioSubmit}
                                isSubmitting={isResponding || isTimeUp}
                            />
                        ) : (
                            <div className="flex-1 relative">
                                <textarea
                                    ref={textareaRef}
                                    rows={1}
                                    value={input}
                                    disabled={isTimeUp}
                                    onChange={(e) => setInput(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && !e.shiftKey) {
                                            e.preventDefault();
                                            handleSendMessage(input);
                                        }
                                    }}
                                    placeholder={
                                        isTimeUp ? 'Session ended' : 'Type your response...'
                                    }
                                    className="w-full rounded-2xl border border-slate-300 dark:border-[#333333] bg-slate-50 dark:bg-[#111111] p-3 pr-12 focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:text-white resize-none disabled:opacity-50"
                                />
                                <button
                                    onClick={() => handleSendMessage(input)}
                                    disabled={!input.trim() || isResponding || isTimeUp}
                                    className="absolute right-2 bottom-2 p-2 rounded-full bg-emerald-500 text-white disabled:opacity-50 hover:bg-emerald-600 transition-colors"
                                >
                                    {isResponding ? (
                                        <Loader2 className="animate-spin" size={20} />
                                    ) : (
                                        <Send size={20} />
                                    )}
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {readOnly && (
                <div className="p-6 text-center bg-white dark:bg-[#1A1A1A] border-t border-slate-200 dark:border-transparent">
                    <p className="text-sm text-slate-500 dark:text-slate-400 italic">
                        The chatbot is disabled in the builder. Switch to Preview to
                        start the conversation.
                    </p>
                </div>
            )}
        </div>
    );
};

export default EvaluatorView;

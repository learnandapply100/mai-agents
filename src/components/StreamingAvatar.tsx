"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  LiveAvatarSession,
  SessionEvent,
  AgentEventsEnum,
} from "@heygen/liveavatar-web-sdk";

// Chroma key function to remove green screen
function applyChromaKey(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  threshold: number = 100
) {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    const red = data[i];
    const green = data[i + 1];
    const blue = data[i + 2];

    // Detect green screen pixels
    if (green > threshold && red < threshold && blue < threshold) {
      data[i + 3] = 0; // Set alpha to transparent
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

interface Match {
  id: string;
  name: string;
  sport: string;
  time: string;
  // The Odds API's sport_key, needed to fetch real odds/analysis for this match.
  // NOTE: "cricket" is a general key on The Odds API; confirm against
  // GET /sports/ for your account tier if it doesn't return events.
  sportKey: string;
}

// Ported from ANALYST_PERSONAS in sports_agent.py
const ANALYST_PERSONAS: Record<string, string> = {
  "ESPN Analyst":
    "You are an ESPN sports analyst. Be enthusiastic, use sports metaphors, reference historical matchups, and give confident predictions with reasoning.",
  "Vegas Sharp":
    "You are a professional sports bettor. Focus on line movement, value opportunities, injury impacts, and bankroll management. Be analytical and probability-focused.",
  "Statistical Guru":
    "You are a sports statistician. Cite specific stats, use advanced metrics, discuss sample sizes, and express uncertainty appropriately.",
  "Casual Fan":
    "You are a casual sports fan explaining to a friend. Keep it simple, focus on storylines, star players, and make it fun.",
  "Contrarian Analyst":
    "You are a contrarian analyst. Look for reasons why the favorite might lose, find value in underdogs, and challenge conventional wisdom.",
};

// Separate avatar options (visual appearance)
// NM 16/07/2026: Migrated to LiveAvatar IDs (obtained from https://app.liveavatar.com/avatars)
const AVATARS: Record<string, { id: string; description: string }> = {
  "Wayne (Male, Casual)": { id: "dd73ea75-1218-4ef3-92ce-606d5f7fbc0a", description: "Friendly male host" },
  "Marianne (Female, News)": { id: "f86e8b45-3389-424a-b3d7-7f6e8729e36d", description: "Female news reporter" },
  "Thaddeus (Male, Professional)": { id: "246e8d9d-5826-4f49-b8a0-07cb73ff7556", description: "Professional male anchor" },
  "Anthony (Male, Suit)": { id: "38ad67ed-98f0-407c-a2d2-4f0998b306fc", description: "Professional in suit" },
  "Anastasia (Female, Casual)": { id: "b4fc2d60-3b82-4694-b243-93e9d2bb0242", description: "Casual female host" },
};

// Separate voice options (audio)
// NM 16/07/2026: Migrated to LiveAvatar voice IDs (obtained from https://app.liveavatar.com/voices)
// Note: LiveAvatar voices don't carry an "emotion" parameter the way the old
// Streaming Avatar SDK did, so that field is dropped here.
const VOICES: Record<string, { id: string; description: string }> = {
  "Male - Excited": { id: "c2527536-6d1f-4412-a643-53a3497dada9", description: "Energetic male voice" },
  "Female - Broadcaster": { id: "8a504f9b-95dd-42d4-8b0c-edc2567b6382", description: "Professional female voice" },
  "Male - Friendly": { id: "83a26e3f-bcff-4887-80a2-17531c342c9e", description: "Warm male voice" },
  "Male - Serious": { id: "c466083f-30f0-465b-a836-0b77abfe7956", description: "Authoritative male voice" },
  "Female - Soothing": { id: "3607df3c-9de0-4274-b0be-7e035775ead5", description: "Calm female voice" },
};

// Sample matches - in production, fetch from Odds API
const SAMPLE_MATCHES: Match[] = [
  { id: "1", name: "Lakers vs Celtics", sport: "NBA", time: "Tonight 7:30 PM", sportKey: "basketball_nba" },
  { id: "2", name: "Chiefs vs Bills", sport: "NFL", time: "Sunday 4:25 PM", sportKey: "americanfootball_nfl" },
  { id: "3", name: "Man City vs Liverpool", sport: "Premier League", time: "Saturday 12:30 PM", sportKey: "soccer_epl" },
  { id: "4", name: "Yankees vs Red Sox", sport: "MLB", time: "Tomorrow 7:05 PM", sportKey: "baseball_mlb" },
  { id: "5", name: "India vs Australia", sport: "Cricket", time: "Friday 9:30 AM", sportKey: "cricket" },
];

export default function StreamingAvatarComponent() {
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [selectedMatch, setSelectedMatch] = useState<Match>(SAMPLE_MATCHES[0]);
  const [scriptText, setScriptText] = useState("");
  // NOTE: default must be a key that actually exists in the AVATARS/VOICES
  // objects above — this broke silently after the ID migration last time.
  const [selectedAvatar, setSelectedAvatar] = useState("Wayne (Male, Casual)");
  const [selectedVoice, setSelectedVoice] = useState("Male - Excited");
  const [error, setError] = useState<string | null>(null);
  const [debug, setDebug] = useState<string[]>([]);
  const [removeGreenScreen, setRemoveGreenScreen] = useState(true);

  // AI analysis generation (odds + news + Groq, ported from sports_agent.py)
  const [selectedPersona, setSelectedPersona] = useState("ESPN Analyst");
  const [customPersona, setCustomPersona] = useState("");
  const [isGeneratingAnalysis, setIsGeneratingAnalysis] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analyzedGame, setAnalyzedGame] = useState<string | null>(null);
  const [sources, setSources] = useState<string[]>([]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const avatarRef = useRef<LiveAvatarSession | null>(null);
  const animationRef = useRef<number | null>(null);

  // Placeholder script shown before the user generates real AI analysis.
  // NOTE: unlike before, changing the selected match no longer auto-rewrites
  // scriptText — that's now the job of "Generate AI Analysis" below, so a
  // generated script doesn't get silently clobbered by a match-selector change.
  useEffect(() => {
    setScriptText(
      `Welcome to AI Sports News! Select a sport and click "Generate AI Analysis" ` +
      `to have your anchor read a live, AI-generated breakdown of the latest odds and news — ` +
      `or write your own script here.`
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const generateAnalysis = async () => {
    setIsGeneratingAnalysis(true);
    setAnalysisError(null);
    addDebug(`Generating analysis for ${selectedMatch.sportKey}...`);

    try {
      // Your AVATARS keys are like "Wayne (Male, Casual)" — strip the
      // descriptor in parentheses so the LLM gets a clean name to introduce
      // itself with, e.g. "Wayne".
      const avatarName = selectedAvatar.split(" (")[0];

      const response = await fetch("/api/analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sportKey: selectedMatch.sportKey,
          persona: selectedPersona,
          customPersona,
          avatarName,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to generate analysis");
      }

      setScriptText(data.script);
      setAnalyzedGame(data.game);
      setSources(data.sources ?? []);
      addDebug(`Analysis generated for ${data.game}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Analysis generation failed";
      setAnalysisError(message);
      addDebug(`Analysis error: ${message}`);
    } finally {
      setIsGeneratingAnalysis(false);
    }
  };

  const addDebug = useCallback((msg: string) => {
    setDebug((prev) => [...prev.slice(-9), `${new Date().toLocaleTimeString()}: ${msg}`]);
  }, []);

  // Chroma key rendering loop
  const renderChromaKey = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.paused || video.ended) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Match canvas size to video
    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
    }

    // Draw video frame to canvas
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Apply chroma key if enabled
    if (removeGreenScreen) {
      applyChromaKey(ctx, canvas.width, canvas.height, 90);
    }

    animationRef.current = requestAnimationFrame(renderChromaKey);
  }, [removeGreenScreen]);

  // Start/stop chroma key rendering
  useEffect(() => {
    if (isSessionActive && removeGreenScreen) {
      animationRef.current = requestAnimationFrame(renderChromaKey);
    }
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isSessionActive, removeGreenScreen, renderChromaKey]);

  const fetchAccessToken = async (
    avatarId: string,
    voiceId: string
  ): Promise<string> => {
    const response = await fetch("/api/heygen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ avatarId, voiceId, language: "en" }),
    });
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || "Failed to get access token");
    }
    const data = await response.json();
    return data.sessionToken;
  };

  const startSession = async () => {
    setIsLoading(true);
    setError(null);
    addDebug("Starting session...");

    try {
      const avatarConfig = AVATARS[selectedAvatar];
      const voiceConfig = VOICES[selectedVoice];

      const sessionToken = await fetchAccessToken(avatarConfig.id, voiceConfig.id);
      addDebug("Got session token");

      // voiceChat controls whether the SDK captures the viewer's microphone
      // for two-way conversation. This app only pushes a pre-written script,
      // so it's off by default — flip to true if you want viewers to be able
      // to talk back to the anchor.
      const session = new LiveAvatarSession(sessionToken, { voiceChat: false });
      avatarRef.current = session;

      session.on(SessionEvent.SESSION_STREAM_READY, () => {
        addDebug("Stream ready!");
        if (videoRef.current) {
          session.attach(videoRef.current);
          videoRef.current.play().catch(console.error);
        }
        setIsSessionActive(true);
        setIsLoading(false);

        // Auto-speak the script after a short delay
        setTimeout(async () => {
          if (avatarRef.current && scriptText.trim()) {
            addDebug("Auto-speaking script...");
            try {
              await avatarRef.current.repeat(scriptText);
              addDebug("Auto-speak started");
            } catch (err) {
              addDebug("Auto-speak failed");
            }
          }
        }, 1000);
      });

      session.on(SessionEvent.SESSION_DISCONNECTED, () => {
        addDebug("Session disconnected");
        setIsSessionActive(false);
        if (videoRef.current) {
          videoRef.current.srcObject = null;
        }
      });

      session.on(AgentEventsEnum.AVATAR_SPEAK_STARTED, () => {
        addDebug("Avatar started talking");
        setIsSpeaking(true);
      });

      session.on(AgentEventsEnum.AVATAR_SPEAK_ENDED, () => {
        addDebug("Avatar stopped talking");
        setIsSpeaking(false);
      });

      addDebug(`Starting session with avatar: ${avatarConfig.id}, voice: ${voiceConfig.id}`);
      await session.start();
      addDebug("Session started successfully");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
      addDebug(`Error: ${message}`);
      setIsLoading(false);
    }
  };

  const speak = async () => {
    if (!avatarRef.current || !scriptText.trim()) return;

    addDebug("Sending speech request...");
    try {
      await avatarRef.current.repeat(scriptText);
      addDebug("Speech request sent");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Speech failed";
      setError(message);
      addDebug(`Speech error: ${message}`);
    }
  };

  const stopSpeaking = async () => {
    if (!avatarRef.current) return;
    try {
      avatarRef.current.interrupt();
      addDebug("Interrupted speech");
    } catch (err) {
      addDebug("Interrupt failed");
    }
  };

  const endSession = async () => {
    if (!avatarRef.current) return;

    addDebug("Ending session...");
    try {
      await avatarRef.current.stop();
    } catch (err) {
      addDebug("Stop session error (may be normal)");
    }

    avatarRef.current = null;
    setIsSessionActive(false);
    setIsSpeaking(false);
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    addDebug("Session ended");
  };

  useEffect(() => {
    return () => {
      if (avatarRef.current) {
        avatarRef.current.stop().catch(console.error);
      }
    };
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-white mb-2">
            AI Sports News Channel
          </h1>
          <p className="text-slate-400">
            Powered by HeyGen LiveAvatar | Modern AI Pro Workshop
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Video Panel */}
          <div className="bg-slate-800 rounded-2xl p-6 shadow-2xl">
            {/* Video container with studio background */}
            <div className="aspect-video bg-gradient-to-b from-blue-900 via-slate-800 to-slate-900 rounded-xl overflow-hidden relative">
              {/* News studio background */}
              <div className="absolute inset-0 bg-gradient-to-br from-blue-900/80 via-slate-800 to-slate-900" />
              <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 rounded-full blur-3xl" />
              <div className="absolute bottom-0 left-0 w-24 h-24 bg-cyan-500/10 rounded-full blur-2xl" />

              {/* Video element for stream source (hidden when using chroma key, but NOT muted for audio) */}
              <video
                ref={videoRef}
                autoPlay
                playsInline
                className={removeGreenScreen ? "absolute w-1 h-1 opacity-0" : "w-full h-full object-contain relative z-10"}
              />

              {/* Canvas for chroma key output */}
              <canvas
                ref={canvasRef}
                className={removeGreenScreen ? "w-full h-full object-contain relative z-10" : "hidden"}
              />
              {!isSessionActive && !isLoading && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="text-center text-slate-400">
                    <div className="text-6xl mb-4">🎬</div>
                    <p>Start a session to see your AI anchor</p>
                  </div>
                </div>
              )}
              {isLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                  <div className="text-center text-white">
                    <div className="animate-spin text-4xl mb-4">⏳</div>
                    <p>Initializing avatar...</p>
                  </div>
                </div>
              )}
              {isSpeaking && (
                <div className="absolute top-4 right-4 bg-red-600 text-white px-3 py-1 rounded-full text-sm animate-pulse">
                  LIVE
                </div>
              )}
              {/* Match ticker */}
              {isSessionActive && (
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-r from-blue-900 to-blue-800 text-white px-4 py-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold">{selectedMatch.sport}</span>
                    <span>{selectedMatch.name}</span>
                    <span className="text-blue-300">{selectedMatch.time}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Controls */}
            <div className="mt-6 space-y-4">
              {/* Match Selection */}
              <div>
                <label className="block text-sm text-slate-400 mb-2">
                  Select Match
                </label>
                <select
                  value={selectedMatch.id}
                  onChange={(e) => {
                    const match = SAMPLE_MATCHES.find(m => m.id === e.target.value);
                    if (match) setSelectedMatch(match);
                  }}
                  className="w-full bg-slate-700 text-white rounded-lg px-4 py-2"
                >
                  {SAMPLE_MATCHES.map((match) => (
                    <option key={match.id} value={match.id}>
                      {match.sport}: {match.name} - {match.time}
                    </option>
                  ))}
                </select>
              </div>

              {/* Avatar Selection (Visual) */}
              <div>
                <label className="block text-sm text-slate-400 mb-2">
                  Select Avatar (Appearance)
                </label>
                <select
                  value={selectedAvatar}
                  onChange={(e) => setSelectedAvatar(e.target.value)}
                  disabled={isSessionActive}
                  className="w-full bg-slate-700 text-white rounded-lg px-4 py-2 disabled:opacity-50"
                >
                  {Object.entries(AVATARS).map(([name]) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-slate-500 mt-1">{AVATARS[selectedAvatar]?.description}</p>
              </div>

              {/* Voice Selection (Audio) */}
              <div>
                <label className="block text-sm text-slate-400 mb-2">
                  Select Voice (Audio)
                </label>
                <select
                  value={selectedVoice}
                  onChange={(e) => setSelectedVoice(e.target.value)}
                  disabled={isSessionActive}
                  className="w-full bg-slate-700 text-white rounded-lg px-4 py-2 disabled:opacity-50"
                >
                  {Object.entries(VOICES).map(([name]) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-slate-500 mt-1">{VOICES[selectedVoice]?.description}</p>
              </div>

              {/* Green screen toggle */}
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="removeGreenScreen"
                  checked={removeGreenScreen}
                  onChange={(e) => setRemoveGreenScreen(e.target.checked)}
                  className="w-4 h-4 rounded"
                />
                <label htmlFor="removeGreenScreen" className="text-sm text-slate-400">
                  Remove green screen background
                </label>
              </div>

              <div className="flex gap-4">
                {!isSessionActive ? (
                  <button
                    onClick={startSession}
                    disabled={isLoading}
                    className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-slate-600 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
                  >
                    {isLoading ? "Starting..." : "Start Session"}
                  </button>
                ) : (
                  <button
                    onClick={endSession}
                    className="flex-1 bg-red-600 hover:bg-red-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
                  >
                    End Session
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Script Panel */}
          <div className="bg-slate-800 rounded-2xl p-6 shadow-2xl">
            <h2 className="text-xl font-semibold text-white mb-4">
              Anchor Script
            </h2>

            {/* Persona + AI generation controls */}
            <div className="mb-4 space-y-3">
              <div>
                <label className="block text-sm text-slate-400 mb-2">
                  AI Analyst Persona
                </label>
                <select
                  value={selectedPersona}
                  onChange={(e) => setSelectedPersona(e.target.value)}
                  className="w-full bg-slate-700 text-white rounded-lg px-4 py-2"
                >
                  {Object.keys(ANALYST_PERSONAS).map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>

              <textarea
                value={customPersona}
                onChange={(e) => setCustomPersona(e.target.value)}
                placeholder="Or write a custom persona, e.g. 'You are a cricket expert focusing on IPL...'"
                className="w-full h-16 bg-slate-700 text-white rounded-lg px-4 py-2 resize-none text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />

              <button
                onClick={generateAnalysis}
                disabled={isGeneratingAnalysis}
                className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-slate-600 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
              >
                {isGeneratingAnalysis ? "Generating analysis..." : "🔍 Generate AI Analysis"}
              </button>

              {analysisError && (
                <div className="bg-red-900/50 border border-red-500 text-red-200 rounded-lg p-3 text-sm">
                  {analysisError}
                </div>
              )}

              {analyzedGame && (
                <p className="text-xs text-slate-400">
                  Analyzing: <span className="text-slate-300">{analyzedGame}</span>
                </p>
              )}
            </div>

            <textarea
              value={scriptText}
              onChange={(e) => setScriptText(e.target.value)}
              placeholder="Enter the script for your AI anchor to read..."
              className="w-full h-48 bg-slate-700 text-white rounded-lg px-4 py-3 resize-none focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />

            <div className="mt-2 text-sm text-slate-400">
              {scriptText.split(" ").filter(Boolean).length} words |{" "}
              ~{Math.ceil(scriptText.split(" ").filter(Boolean).length / 150 * 60)} seconds
            </div>

            <div className="mt-4 flex gap-4">
              <button
                onClick={speak}
                disabled={!isSessionActive || isSpeaking || !scriptText.trim()}
                className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
              >
                {isSpeaking ? "Speaking..." : "Speak Script"}
              </button>
              <button
                onClick={stopSpeaking}
                disabled={!isSpeaking}
                className="bg-orange-600 hover:bg-orange-700 disabled:bg-slate-600 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
              >
                Stop
              </button>
            </div>

            {error && (
              <div className="mt-4 bg-red-900/50 border border-red-500 text-red-200 rounded-lg p-4">
                {error}
              </div>
            )}

            {/* Source transparency, matching sports_agent.py's "see the raw data" philosophy */}
            {sources.length > 0 && (
              <div className="mt-6">
                <h3 className="text-sm font-semibold text-slate-400 mb-2">
                  News Sources Used
                </h3>
                <div className="bg-slate-900 rounded-lg p-3 text-xs text-slate-400 space-y-1">
                  {sources.map((url, i) => (
                    <div key={i} className="truncate">
                      <a href={url} target="_blank" rel="noopener noreferrer" className="hover:text-blue-400">
                        {url}
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Debug Log */}
            <div className="mt-6">
              <h3 className="text-sm font-semibold text-slate-400 mb-2">
                Debug Log
              </h3>
              <div className="bg-slate-900 rounded-lg p-3 h-32 overflow-y-auto text-xs text-slate-400 font-mono">
                {debug.length === 0 ? (
                  <p>Waiting for events...</p>
                ) : (
                  debug.map((msg, i) => <div key={i}>{msg}</div>)
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center text-slate-500 text-sm">
          <p>
            Built for Modern AI Pro Workshop | Using HeyGen LiveAvatar SDK
          </p>
        </div>
      </div>
    </div>
  );
}

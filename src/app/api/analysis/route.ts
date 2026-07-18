// src/app/api/analysis/route.ts
//
// Ported from sports_agent.py's get_odds() + get_news() + analyze_with_llm().
// Difference from the Python version: the prompt asks for flowing spoken
// prose (no markdown/bullets/headers) since this text gets read aloud by
// the avatar, not displayed on screen.

import { NextRequest, NextResponse } from "next/server";

const ODDS_API_KEY = process.env.ODDS_API_KEY;
const ODDS_BASE_URL = process.env.ODDS_BASE_URL; // e.g. https://api.the-odds-api.com/v4
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

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

interface OddsOutcome {
  name: string;
  price: number;
}
interface OddsMarket {
  key: string;
  outcomes: OddsOutcome[];
}
interface OddsBookmaker {
  title: string;
  markets: OddsMarket[];
}
interface OddsEvent {
  id: string;
  home_team: string;
  away_team: string;
  commence_time: string;
  bookmakers?: OddsBookmaker[];
}

interface TavilyResult {
  title?: string;
  content?: string;
  url?: string;
}

interface OddsResult {
  events: OddsEvent[];
  requestsRemaining: string | null;
  requestsUsed: string | null;
}

async function getOdds(sportKey: string): Promise<OddsResult> {
  if (!ODDS_API_KEY || !ODDS_BASE_URL) {
    throw new Error("ODDS_API_KEY or ODDS_BASE_URL not configured");
  }
  const url = `${ODDS_BASE_URL}/sports/${sportKey}/odds/?apiKey=${ODDS_API_KEY}&regions=us&markets=h2h&oddsFormat=american`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Odds API error: ${response.status} ${await response.text()}`);
  }
  const events: OddsEvent[] = await response.json();
  return {
    events,
    requestsRemaining: response.headers.get("x-requests-remaining"),
    requestsUsed: response.headers.get("x-requests-used"),
  };
}

interface NewsResult {
  results: TavilyResult[];
  creditsUsed: number | null;
}

async function getNews(query: string, maxResults = 8): Promise<NewsResult> {
  if (!TAVILY_API_KEY) {
    // Matches the Python fallback behavior loosely: if no Tavily key, just
    // proceed with no news rather than hard-failing the whole request.
    return { results: [], creditsUsed: null };
  }
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: TAVILY_API_KEY,
      query,
      max_results: maxResults,
      search_depth: "basic",
      include_usage: true, // returns the real credit cost of this specific call
    }),
  });
  if (!response.ok) {
    // Non-fatal: analysis can still proceed on odds data alone.
    console.error("Tavily error:", await response.text());
    return { results: [], creditsUsed: null };
  }
  const data = await response.json();
  return {
    results: data.results ?? [],
    creditsUsed: data.usage?.credits ?? null,
  };
}

interface LlmResult {
  content: string;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
}

async function analyzeWithLlm(prompt: string): Promise<LlmResult> {
  if (!GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY not configured");
  }
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/gpt-oss-120b",
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!response.ok) {
    throw new Error(`Groq API error: ${response.status} ${await response.text()}`);
  }
  const data = await response.json();
  return {
    content: data.choices?.[0]?.message?.content ?? "",
    promptTokens: data.usage?.prompt_tokens ?? null,
    completionTokens: data.usage?.completion_tokens ?? null,
    totalTokens: data.usage?.total_tokens ?? null,
  };
}

function buildOddsContext(event: OddsEvent): string {
  let context = "";
  for (const bookmaker of (event.bookmakers ?? []).slice(0, 3)) {
    context += `\n${bookmaker.title}:\n`;
    for (const market of bookmaker.markets ?? []) {
      if (market.key === "h2h") {
        for (const outcome of market.outcomes) {
          const sign = outcome.price > 0 ? "+" : "";
          context += `  ${outcome.name}: ${sign}${outcome.price}\n`;
        }
      }
    }
  }
  return context;
}

interface AnalysisRequestBody {
  sportKey: string;
  eventId?: string;
  persona: string;
  customPersona?: string;
  avatarName?: string;
}

export async function POST(request: NextRequest) {
  let body: AnalysisRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { sportKey, eventId, persona, customPersona, avatarName } = body;
  if (!sportKey) {
    return NextResponse.json({ error: "sportKey is required" }, { status: 400 });
  }

  try {
    const { events, requestsRemaining, requestsUsed } = await getOdds(sportKey);

    // Prefer the exact game the user selected (by real Odds API event id,
    // from /api/matches). Fall back to "first upcoming event with odds" only
    // if no eventId was sent — e.g. older clients or direct API testing.
    const event = eventId
      ? events.find((e) => e.id === eventId)
      : events.find((e) => e.bookmakers && e.bookmakers.length > 0);

    if (!event) {
      return NextResponse.json(
        {
          error: eventId
            ? "The selected game is no longer available — it may have started or odds may have changed. Try refreshing the match list."
            : "No upcoming games with odds found for this sport right now",
        },
        { status: 404 }
      );
    }

    const teams = `${event.away_team} ${event.home_team}`;
    const newsResult = await getNews(`${teams} game preview injury news`, 8);

    const newsText = newsResult.results
      .map((article) => `Title: ${article.title ?? ""}\nContent: ${article.content ?? ""}`)
      .join("\n\n");
    const sources = newsResult.results.map((article) => article.url).filter(Boolean) as string[];

    const oddsContext = buildOddsContext(event);
    const activePersona =
      customPersona && customPersona.trim().length > 0
        ? customPersona
        : ANALYST_PERSONAS[persona] ?? ANALYST_PERSONAS["ESPN Analyst"];

    const prompt = `
${activePersona}

Analyze this upcoming game: ${event.away_team} @ ${event.home_team}
Game Time: ${event.commence_time}

CURRENT BETTING ODDS:
${oddsContext}

LATEST NEWS & INFORMATION:
${newsText}

Write this as a broadcast script that will be read aloud by an AI news anchor avatar.
Cover: the key factors influencing this game, your prediction with a confidence level,
a betting angle if there's a clear one, and anything worth watching for.

Formatting rules (important — this will be spoken by a text-to-speech avatar):
- Plain, flowing sentences only. No markdown, no bullet points, no numbered lists, no headers, no asterisks.
- Around 150-200 words, sized to run about 60-75 seconds when read aloud.
- Sound like a natural TV sports anchor talking, not a written report.
- Reference the actual news and odds data provided above.
${
  avatarName
    ? `- Open by introducing yourself by name as "${avatarName}". Use exactly this name, every time — do not invent, alter, or substitute a different name.`
    : `- Do not introduce yourself by name or invent a name for yourself — speak generically as the broadcast anchor.`
}
`;

    const llmResult = await analyzeWithLlm(prompt);

    return NextResponse.json({
      script: llmResult.content,
      game: `${event.away_team} @ ${event.home_team}`,
      commenceTime: event.commence_time,
      sources,
      usage: {
        oddsRequestsRemaining: requestsRemaining,
        oddsRequestsUsed: requestsUsed,
        promptTokens: llmResult.promptTokens,
        completionTokens: llmResult.completionTokens,
        totalTokens: llmResult.totalTokens,
        tavilyCredits: newsResult.creditsUsed,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Analysis generation failed";
    console.error("Analysis route error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

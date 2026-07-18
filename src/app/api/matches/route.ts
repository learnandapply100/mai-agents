// src/app/api/matches/route.ts
//
// Replaces the hardcoded SAMPLE_MATCHES list in StreamingAvatar.tsx.
// Fetches the next real upcoming game (with odds available) for each of the
// 5 tracked sports, so the dropdown reflects actual live schedules instead
// of a placeholder like "Lakers vs Celtics, Tonight 7:30 PM".
//
// Naturally capped at 5 entries since we only track 5 sport keys — a sport
// with no games scheduled right now (e.g. NBA off-season) is simply
// omitted rather than shown as a broken/empty option.

import { NextResponse } from "next/server";

const ODDS_API_KEY = process.env.ODDS_API_KEY;
const ODDS_BASE_URL = process.env.ODDS_BASE_URL;

// NOTE: "cricket" is a general Odds API key — confirm it's valid for your
// account tier via GET /sports/ if it never returns results.
const TRACKED_SPORTS: { sportKey: string; label: string }[] = [
  { sportKey: "basketball_nba", label: "NBA" },
  { sportKey: "americanfootball_nfl", label: "NFL" },
  { sportKey: "soccer_epl", label: "Premier League" },
  { sportKey: "baseball_mlb", label: "MLB" },
  { sportKey: "cricket", label: "Cricket" },
];

interface OddsEvent {
  id: string;
  home_team: string;
  away_team: string;
  commence_time: string;
  bookmakers?: { title: string; markets: unknown[] }[];
}

interface MatchOption {
  id: string; // real Odds API event id, used to fetch this exact game later
  name: string;
  sport: string;
  time: string;
  sportKey: string;
  daysUntil: number;
  // true when this is the next scheduled game but it's more than a week out
  // (e.g. sport is between seasons) — lets the UI label it clearly instead
  // of implying it's happening "soon".
  isFarOut: boolean;
}

const FAR_OUT_THRESHOLD_DAYS = 7;

async function getNextEvent(
  sportKey: string
): Promise<{ event: OddsEvent | null; requestsRemaining: string | null; requestsUsed: string | null }> {
  if (!ODDS_API_KEY || !ODDS_BASE_URL) return { event: null, requestsRemaining: null, requestsUsed: null };

  const url = `${ODDS_BASE_URL}/sports/${sportKey}/odds/?apiKey=${ODDS_API_KEY}&regions=us&markets=h2h&oddsFormat=american`;

  // Cache for 5 minutes, matching the TTL used by get_odds() in sports_agent.py,
  // so a page full of dropdown loads doesn't burn through your Odds API quota.
  const response = await fetch(url, { next: { revalidate: 300 } });
  if (!response.ok) {
    console.error(`Odds API error for ${sportKey}: ${response.status}`);
    return { event: null, requestsRemaining: null, requestsUsed: null };
  }

  const events: OddsEvent[] = await response.json();
  return {
    event: events.find((e) => e.bookmakers && e.bookmakers.length > 0) ?? null,
    requestsRemaining: response.headers.get("x-requests-remaining"),
    requestsUsed: response.headers.get("x-requests-used"),
  };
}

function formatTime(isoString: string): string {
  try {
    return new Date(isoString).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return isoString;
  }
}

export async function GET() {
  if (!ODDS_API_KEY || !ODDS_BASE_URL) {
    return NextResponse.json(
      { error: "ODDS_API_KEY or ODDS_BASE_URL not configured" },
      { status: 500 }
    );
  }

  let lastRequestsRemaining: string | null = null;
  let lastRequestsUsed: string | null = null;

  const results = await Promise.all(
    TRACKED_SPORTS.map(async ({ sportKey, label }) => {
      const { event, requestsRemaining, requestsUsed } = await getNextEvent(sportKey);
      if (requestsRemaining) lastRequestsRemaining = requestsRemaining;
      if (requestsUsed) lastRequestsUsed = requestsUsed;
      if (!event) return null;

      const commenceDate = new Date(event.commence_time);
      const daysUntil = Math.max(
        0,
        Math.ceil((commenceDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
      );

      const match: MatchOption = {
        id: event.id,
        name: `${event.away_team} @ ${event.home_team}`,
        sport: label,
        time: formatTime(event.commence_time),
        sportKey,
        daysUntil,
        isFarOut: daysUntil > FAR_OUT_THRESHOLD_DAYS,
      };
      return match;
    })
  );

  const matches = results.filter((m): m is MatchOption => m !== null);

  return NextResponse.json({
    matches,
    usage: {
      oddsRequestsRemaining: lastRequestsRemaining,
      oddsRequestsUsed: lastRequestsUsed,
      oddsCallsThisRequest: TRACKED_SPORTS.length,
    },
  });
}

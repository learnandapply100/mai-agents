# AI Sports News Channel - LiveAvatar

Real-time AI sports anchor using HeyGen's LiveAvatar SDK, with AI-generated
game analysis pulled live from odds and news data.

**Modern AI Pro Workshop** | Build Your Own ESPN
**Migration note:** this app originally used the @heygen/streaming-avatar
SDK against HeyGen's Streaming Avatar API, which was sunset. It now runs on
@heygen/liveavatar-web-sdk against LiveAvatar. See
docs.liveavatar.com for the current platform

## Features

- Real-time streaming AI avatar - (5 preset avatars, 5 voice options)
- AI-generated game analysis — pulls live odds (The Odds API) and news
(Tavily), then generates a broadcast-ready script via Groq, matching the
selected anchor persona
- 5 built-in analyst personas (ESPN Analyst, Vegas Sharp, Statistical Guru,
Casual Fan, Contrarian Analyst), or write your own custom persona
- Live game selector — dropdown pulls real upcoming games from the Odds
API rather than a fixed sample list; games more than 7 days out (e.g. a
sport between seasons) are clearly flagged rather than shown as if
imminent
- Usage & cost tracking — session panel shows exact API call counts,
Groq token usage, and Odds/Tavily quota consumed, plus an estimated
LiveAvatar credit cost (see Known Limitations for what's exact vs. estimated)
- Source transparency — see which news articles the AI analysis drew from
- Custom script input
- Live broadcasting indicator
- Debug logging

## Quick Start

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Set up environment**
   ```bash
   cp .env.example .env.local
   ```
   Fill in .env.local with your real API keys (see API Keys below)

3. **Run development server**
   ```bash
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000)

## Deploy to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/YOUR_USERNAME/streaming-avatar)

Connect this repo to a Vercel project, then add the environment variables
below under Settings → Environment Variables (these do not carry over
from your local .env.local automatically)

## How It Works

1. Click "Start Session" to initialize the avatar
2. Enter your script in the text area
3. Click "Speak Script" to have the avatar read it
4. Use "Stop" to interrupt, "End Session" to close

## API Keys

See .env.example for the full list of variable names

Free tier of LiveAvatar includes trial credits for testing.

## Known Limitations

- **Sport selector shows the next scheduled game, which may be far out.**
The dropdown pulls real upcoming games live from the Odds API (not a
hardcoded sample list), and analysis is generated for the exact game
selected. However, when a league is between seasons/rounds, 
"next scheduled game" can be weeks away (e.g. EPL's next
match might be its season opener in August). The UI flags this clearly
with a ⚠ warning when the next game is more than 7 days out, rather than
presenting it as if it's happening soon

- **Free LiveAvatar plan limits:** 10 credits/month, 2 min max per session,
1 concurrent session, 1080p with watermark. is_sandbox: true in
route.ts further restricts you to a single test avatar with a shorter
session cap — set it to false for real testing/production, understanding
that consumes real credits.

- **Usage panel numbers are a mix of exact and estimated.** Odds API,
Groq, and Tavily figures are real numbers read from those APIs' own
responses. LiveAvatar session/credit figures are estimated from streamed
time on the page, not your real billed balance — check
app.liveavatar.com for the actual number.
**Usage counters also reset on page reload (in-memory only, not persisted)**

- **Cricket's Odds API sport_key is unconfirmed for all account tiers** —
verify via GET /sports/ if it returns no events.

## Tech Stack

- Next.js 16
- TypeScript
- Tailwind CSS
- @heygen/liveavatar-web-sdk (real-time avatar streaming)
- WebRTC
- Groq (openai/gpt-oss-120b) for analysis generation
- The Odds API + Tavily for live data

## Workshop

This is part of the **Modern AI Pro Agentic AI Workshop**.

What you're building that ChatGPT/Claude can't do:
- Real-time interactive AI avatars
- Custom streaming video generation
- Low-latency WebRTC communication

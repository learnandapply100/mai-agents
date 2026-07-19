import { NextRequest, NextResponse } from "next/server";

// TODO: Add LIVEAVATAR_API_KEY to your .env.local / Vercel project settings.
// Get it from https://app.liveavatar.com/developers
const LIVEAVATAR_API_KEY = process.env.LIVEAVATAR_API_KEY ?? "PLACEHOLDER_LIVEAVATAR_API_KEY";
const LIVEAVATAR_API_URL = "https://api.liveavatar.com";

// TODO: Replace with the context_id from the "Sports Anchor Broadcast" context
// you create at https://app.liveavatar.com/contexts
const LIVEAVATAR_CONTEXT_ID = process.env.LIVEAVATAR_CONTEXT_ID ?? "PLACEHOLDER_CONTEXT_ID";

// Defaults to sandboxed (safe) unless explicitly set to "false" in env vars.
// Given how easily a single accidental "Start Session" click can burn a real
// credit, this should never silently default to spending real credits.
const IS_SANDBOX = process.env.LIVEAVATAR_SANDBOX !== "false";

interface StartSessionRequestBody {
  avatarId: string;
  voiceId: string;
  language?: string;
}

export async function POST(request: NextRequest) {
  if (!LIVEAVATAR_API_KEY || LIVEAVATAR_API_KEY === "PLACEHOLDER_LIVEAVATAR_API_KEY") {
    return NextResponse.json(
      { error: "LIVEAVATAR_API_KEY not configured" },
      { status: 500 }
    );
  }

  let body: StartSessionRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must include avatarId and voiceId" },
      { status: 400 }
    );
  }

  const { avatarId, voiceId, language = "en" } = body;

  if (!avatarId || !voiceId) {
    return NextResponse.json(
      { error: "avatarId and voiceId are required" },
      { status: 400 }
    );
  }

  try {
    const response = await fetch(`${LIVEAVATAR_API_URL}/v1/sessions/token`, {
      method: "POST",
      headers: {
        "X-API-KEY": LIVEAVATAR_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        mode: "FULL",
        avatar_id: avatarId,
        avatar_persona: {
          voice_id: voiceId,
          context_id: LIVEAVATAR_CONTEXT_ID,
          language,
        },
        is_sandbox: IS_SANDBOX,
      }),
    });

    if (!response.ok) {
      const contentType = response.headers.get("content-type");
      let errorMessage = "Failed to retrieve session token";

      if (contentType?.includes("application/json")) {
        const errorBody = await response.json();
        errorMessage =
          errorBody?.data?.[0]?.message ??
          errorBody?.message ??
          errorBody?.error ??
          errorMessage;
      } else {
        errorMessage = (await response.text()) || errorMessage;
      }

      return NextResponse.json({ error: errorMessage }, { status: response.status });
    }

    const data = await response.json();
    const sessionToken = data?.data?.session_token;
    const sessionId = data?.data?.session_id;

    if (!sessionToken) {
      return NextResponse.json(
        { error: "Failed to retrieve session token" },
        { status: 500 }
      );
    }

    return NextResponse.json({ sessionToken, sessionId, isSandbox: IS_SANDBOX });
  } catch (error) {
    console.error("LiveAvatar token generation error:", error);
    return NextResponse.json(
      { error: "Failed to generate session token" },
      { status: 500 }
    );
  }
}

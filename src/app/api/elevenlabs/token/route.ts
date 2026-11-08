import { NextResponse } from "next/server";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

// The agent is private (auth enabled), so the browser needs a short-lived conversation token.
// WebRTC with a conversation token is the React SDK's default for voice sessions.
// The API key stays on the server; only the token goes to the browser.

export const dynamic = "force-dynamic";

export async function GET() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const agentId = process.env.ELEVENLABS_AGENT_ID?.trim();
  if (!apiKey || !agentId?.startsWith("agent_")) {
    return NextResponse.json(
      { error: "Voice agent is not configured on the server." },
      { status: 500 },
    );
  }

  try {
    const client = new ElevenLabsClient({ apiKey });
    const { token } = await client.conversationalAi.conversations.getWebrtcToken({ agentId });
    return NextResponse.json(
      { conversationToken: token },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    const status = (err as { statusCode?: number })?.statusCode;
    console.error("ElevenLabs token request failed", status ?? "", (err as Error)?.message);
    return NextResponse.json(
      { error: "Could not start a voice session. Please try again." },
      { status: 502 },
    );
  }
}

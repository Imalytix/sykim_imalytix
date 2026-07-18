import { NextResponse } from "next/server";
import type { HealthResponse } from "@/types/analysis";

export async function GET() {
  const body: HealthResponse = {
    status: "ok",
    models: {
      openai: Boolean(process.env.OPENAI_API_KEY),
      gemini: Boolean(process.env.GEMINI_API_KEY),
      anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    },
  };
  return NextResponse.json(body);
}

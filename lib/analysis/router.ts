import type { MetadataAnalysis } from "@/types/analysis";

/**
 * Return true when metadata alone is strong enough to skip a vision call.
 * In quick mode we save latency/cost whenever the file already has decisive
 * AI-generation clues such as Stable Diffusion parameters or a very strong
 * metadata score.
 */
export function hasStrongMetadataEvidence(metadata: MetadataAnalysis): boolean {
  if (metadata.metadata_score >= 35) return true;
  if (metadata.ai_tool_detected) return true;
  return metadata.evidence.some(
    (item) => item.includes("Stable Diffusion") || item.includes("ComfyUI") || item.includes("EXIF Software"),
  );
}

export interface RoutingPlan {
  call_openai: boolean;
  call_gemini: boolean;
  call_claude: boolean;
  prompt_type: "quick" | "standard";
}

export function decideRouting(
  mode: "quick" | "standard" | "deep",
  metadata: MetadataAnalysis,
  hasKeys: { openai: boolean; gemini: boolean; claude: boolean },
): RoutingPlan {
  let promptType: "quick" | "standard" = "standard";

  if (mode === "quick") {
    promptType = "quick";
    if (hasStrongMetadataEvidence(metadata)) {
      return { call_openai: false, call_gemini: false, call_claude: false, prompt_type: promptType };
    }
  } else if (mode === "deep") {
    promptType = "standard";
  }

  return {
    call_openai: hasKeys.openai,
    call_gemini: hasKeys.gemini,
    call_claude: hasKeys.claude,
    prompt_type: promptType,
  };
}

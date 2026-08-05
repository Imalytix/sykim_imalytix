export interface RoutingPlan {
  call_openai: boolean;
  call_gemini: boolean;
  call_claude: boolean;
  prompt_type: "quick" | "standard";
}

/**
 * Always calls every provider that has an API key, with the full "standard"
 * prompt — quick/deep never actually differed from this in practice (quick's
 * metadata-based skip and deep's non-existent extra depth were both removed
 * 2026-08-05, see docs/) and standard vs deep were already 100% identical.
 * `mode` still exists as a field on the request/DB row (kept for the "quick
 * literally means skip everything" flexibility later, and because
 * verification_requests.mode is already relied on by v_daily_activity), it
 * just no longer changes what this function returns.
 */
export function decideRouting(hasKeys: { openai: boolean; gemini: boolean; claude: boolean }): RoutingPlan {
  return {
    call_openai: hasKeys.openai,
    call_gemini: hasKeys.gemini,
    call_claude: hasKeys.claude,
    prompt_type: "standard",
  };
}

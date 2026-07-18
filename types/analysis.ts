export type Confidence = "low" | "medium" | "high";
export type Severity = "low" | "medium" | "high";

export interface BBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface Evidence {
  type: string;
  label: string;
  severity: Severity;
  description: string;
}

export interface SuspiciousRegion {
  label: string;
  severity: Severity;
  description: string;
  bbox?: BBox | null;
}

export type ContentType = "face" | "body" | "animal" | "landscape" | "object" | "text" | "other";

export interface VisionResult {
  provider: "openai" | "gemini" | "claude";
  model_name?: string;
  is_ai_generated: boolean | null;
  score: number;
  confidence: Confidence;
  content_type?: ContentType | null;
  evidence: Evidence[];
  suspicious_regions: SuspiciousRegion[];
  limitations: string[];
  raw_response?: unknown;
  is_mock?: boolean;
  error_message?: string | null;
}

export interface MetadataAnalysis {
  exif_found: boolean;
  png_metadata_found: boolean;
  c2pa_found: boolean;
  ai_tool_detected: boolean;
  detected_tools: string[];
  metadata_score: number;
  camera_make_model_found: boolean;
  evidence: string[];
  limitations: string[];
  raw: Record<string, unknown>;
}

export interface FinalResult {
  is_ai_generated: boolean | null;
  ai_probability: number;
  label: string;
  confidence: Confidence;
}

export interface AnalysisInput {
  type: string;
  mime_type: string;
  width: number;
  height: number;
  phash: string;
}

export interface AnalysisResult {
  product: string;
  request_id: string;
  mode: "quick" | "standard" | "deep";
  input: AnalysisInput;
  final_result: FinalResult;
  metadata_analysis: MetadataAnalysis;
  vision_results: VisionResult[];
  evidence_summary: string[];
  suspicious_regions: SuspiciousRegion[];
  limitations: string[];
  recommended_action: string;
}

export interface HealthResponse {
  status: "ok";
  models: {
    openai: boolean;
    gemini: boolean;
    anthropic: boolean;
  };
}

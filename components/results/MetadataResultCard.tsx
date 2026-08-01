import clsx from "clsx";
import { FileSearch, Tag } from "lucide-react";
import type { CameraInfo, FileInfo } from "@/types/analysis";

interface MetadataResultCardProps {
  exifFound: boolean;
  pngMetadataFound: boolean;
  c2paFound: boolean;
  aiToolDetected: boolean;
  detectedTools: string[];
  metadataScore: number;
  evidence: string[];
  limitations: string[];
  cameraInfo: CameraInfo | null;
  fileInfo: FileInfo;
}

function Flag({ label, active }: { label: string; active: boolean }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium",
        active ? "border-white/20 bg-white/20 text-[#f4f4f6]" : "border-white/8 bg-transparent text-[#6b6b76]",
      )}
    >
      {label}
    </span>
  );
}

function KeyValueRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-white/6 py-2 last:border-b-0">
      <span className="shrink-0 text-[13px] text-[#9a9aa4]">{label}</span>
      <span className="text-right text-[13px] font-semibold text-[#e5e5ea]">{value}</span>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatCapturedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

export default function MetadataResultCard({
  exifFound,
  pngMetadataFound,
  c2paFound,
  aiToolDetected,
  detectedTools,
  metadataScore,
  evidence,
  limitations,
  cameraInfo,
  fileInfo,
}: MetadataResultCardProps) {
  return (
    <article className="rounded-2xl border border-white/9 bg-white/[0.04] p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[#6b6b76]">메타데이터 분석</div>
          <div className="mt-2 text-lg font-semibold text-[#f4f4f6]">EXIF / PNG / C2PA</div>
        </div>
        <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-[#9a9aa4]">
          <FileSearch className="h-5 w-5" />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Flag label="EXIF" active={exifFound} />
        <Flag label="PNG" active={pngMetadataFound} />
        <Flag label="C2PA" active={c2paFound} />
        <Flag label="AI 도구 흔적" active={aiToolDetected} />
      </div>

      <div className="mt-4 rounded-xl border border-white/8 bg-black/20 p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-[#9a9aa4]">메타데이터 점수</span>
          <span className="font-[family-name:var(--font-inter)] text-3xl font-semibold text-[#f4f4f6]">{metadataScore}</span>
        </div>
        {detectedTools.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {detectedTools.map((tool) => (
              <span
                key={tool}
                className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-[#e5e5ea]"
              >
                <Tag className="h-3 w-3" />
                {tool}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {cameraInfo && (
        <div className="mt-4 rounded-xl border border-white/8 bg-black/20 p-4">
          <div className="mb-1 text-sm font-semibold text-[#f4f4f6]">촬영 정보 (EXIF)</div>
          <div className="flex flex-col">
            {cameraInfo.make || cameraInfo.model ? (
              <KeyValueRow label="카메라" value={[cameraInfo.make, cameraInfo.model].filter(Boolean).join(" ")} />
            ) : null}
            {cameraInfo.lens_model && <KeyValueRow label="렌즈" value={cameraInfo.lens_model} />}
            {cameraInfo.captured_at && <KeyValueRow label="촬영 일시" value={formatCapturedAt(cameraInfo.captured_at)} />}
            {(cameraInfo.exposure_time || cameraInfo.f_number || cameraInfo.iso) && (
              <KeyValueRow
                label="노출"
                value={[cameraInfo.exposure_time, cameraInfo.f_number, cameraInfo.iso ? `ISO ${cameraInfo.iso}` : null]
                  .filter(Boolean)
                  .join(" · ")}
              />
            )}
            <KeyValueRow label="위치 정보" value={cameraInfo.has_gps ? "포함" : "미포함"} />
          </div>
        </div>
      )}

      <div className="mt-4 rounded-xl border border-white/8 bg-black/20 p-4">
        <div className="mb-1 text-sm font-semibold text-[#f4f4f6]">이미지 메타데이터</div>
        <div className="flex flex-col">
          <KeyValueRow label="파일 형식" value={(fileInfo.format ?? "알 수 없음").toUpperCase()} />
          <KeyValueRow label="해상도" value={`${fileInfo.width} × ${fileInfo.height}`} />
          <KeyValueRow label="용량" value={formatBytes(fileInfo.size_bytes)} />
          {fileInfo.color_space && <KeyValueRow label="색 공간" value={fileInfo.color_space} />}
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#6b6b76]">주요 근거</div>
          <ul className="space-y-2 text-sm leading-6 text-[#d4d4d9]">
            {evidence.slice(0, 4).map((item, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-2 h-1.5 w-1.5 rounded-full bg-[#6b6b76]" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#6b6b76]">한계</div>
          <ul className="space-y-2 text-sm leading-6 text-[#9a9aa4]">
            {limitations.slice(0, 3).map((item, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-2 h-1.5 w-1.5 rounded-full bg-[#4a4a54]" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </article>
  );
}

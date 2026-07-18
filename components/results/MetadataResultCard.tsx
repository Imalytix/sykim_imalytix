import clsx from "clsx";
import { FileSearch, Tag } from "lucide-react";

interface MetadataResultCardProps {
  exifFound: boolean;
  pngMetadataFound: boolean;
  c2paFound: boolean;
  aiToolDetected: boolean;
  detectedTools: string[];
  metadataScore: number;
  evidence: string[];
  limitations: string[];
}

function Flag({ label, active }: { label: string; active: boolean }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium",
        active ? "border-sky-200 bg-sky-50 text-sky-700" : "border-slate-200 bg-slate-50 text-slate-400",
      )}
    >
      {label}
    </span>
  );
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
}: MetadataResultCardProps) {
  return (
    <article className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">메타데이터 분석</div>
          <div className="mt-2 text-lg font-semibold text-slate-900">EXIF / PNG / C2PA</div>
        </div>
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-500">
          <FileSearch className="h-5 w-5" />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Flag label="EXIF" active={exifFound} />
        <Flag label="PNG" active={pngMetadataFound} />
        <Flag label="C2PA" active={c2paFound} />
        <Flag label="AI 도구 흔적" active={aiToolDetected} />
      </div>

      <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-slate-500">메타데이터 점수</span>
          <span className="text-3xl font-semibold text-slate-900">{metadataScore}</span>
        </div>
        {detectedTools.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {detectedTools.map((tool) => (
              <span
                key={tool}
                className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-medium text-violet-700"
              >
                <Tag className="h-3 w-3" />
                {tool}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">주요 근거</div>
          <ul className="space-y-2 text-sm leading-6 text-slate-700">
            {evidence.slice(0, 4).map((item, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-2 h-1.5 w-1.5 rounded-full bg-slate-400" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">한계</div>
          <ul className="space-y-2 text-sm leading-6 text-slate-500">
            {limitations.slice(0, 3).map((item, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-2 h-1.5 w-1.5 rounded-full bg-slate-300" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </article>
  );
}

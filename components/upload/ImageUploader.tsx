"use client";

import clsx from "clsx";
import { Upload } from "lucide-react";
import { useRef, useState } from "react";

// Kept in sync with the server-side MAX_FILE_SIZE_MB default (see
// app/api/analyze/image/route.ts) — this is a UX shortcut only, not a
// security boundary; the server enforces its own limit regardless of what
// the client sends.
//
// Capped below Vercel's hard 4.5MB request/response body limit for
// Serverless Functions (not configurable, applies regardless of plan —
// https://vercel.com/docs/functions/limitations#request-body-size). A
// higher app-level limit here would let uploads pass this check but still
// get killed by Vercel's platform layer before our route code ever runs,
// with a non-JSON error response.
const MAX_FILE_SIZE_MB = 4;

interface ImageUploaderProps {
  previewUrl: string | null;
  fileName: string | null | undefined;
  onFileSelected: (file: File, dataUrl: string) => void;
  onError: (message: string) => void;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("미리보기 이미지를 생성할 수 없습니다."));
    reader.readAsDataURL(file);
  });
}

/** Compact white upload square — click or drag anywhere on the card. Matches
 *  the design reference's hero upload card (icon + label, no separate
 *  camera/file-picker buttons) rather than the earlier dashed dropzone. */
export default function ImageUploader({ previewUrl, fileName, onFileSelected, onError }: ImageUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFiles = async (fileList: FileList | null) => {
    const file = fileList?.[0];
    if (!file) return;

    const maxBytes = MAX_FILE_SIZE_MB * 1024 * 1024;
    if (file.size > maxBytes) {
      onError(`이미지 파일이 너무 큽니다 (${(file.size / (1024 * 1024)).toFixed(1)}MB > ${MAX_FILE_SIZE_MB}MB). 더 작은 파일을 선택해주세요.`);
      return;
    }

    const dataUrl = await fileToDataUrl(file);
    onFileSelected(file, dataUrl);
  };

  return (
    <div className="flex flex-col items-center gap-3">
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={async (e) => {
          e.preventDefault();
          setIsDragging(false);
          await handleFiles(e.dataTransfer.files);
        }}
        className={clsx(
          "flex h-[170px] w-[170px] flex-col items-center justify-center gap-3 overflow-hidden rounded-3xl bg-white text-[#1a1a1a] shadow-[0_20px_50px_rgba(0,0,0,0.35)] transition",
          isDragging ? "ring-2 ring-[#52bdff]" : "hover:-translate-y-0.5",
        )}
      >
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- local blob/data URL preview, next/image adds no value here
          <img src={previewUrl} alt={fileName ?? "선택된 이미지"} className="h-full w-full object-cover" />
        ) : (
          <>
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/5">
              <Upload className="h-5 w-5" />
            </span>
            <span className="text-sm font-semibold">이미지 업로드</span>
          </>
        )}
      </button>
      {previewUrl && <p className="max-w-[200px] truncate text-center text-xs text-[#9a9aa4]">{fileName} · 다시 클릭하면 교체됩니다</p>}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={async (e) => {
          const input = e.currentTarget;
          await handleFiles(input.files);
          input.value = "";
        }}
      />
    </div>
  );
}

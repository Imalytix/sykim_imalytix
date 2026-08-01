"use client";

import clsx from "clsx";
import { Camera, FolderOpen, UploadCloud } from "lucide-react";
import { useRef, useState } from "react";
import SelectedImagePreview from "./SelectedImagePreview";

// Kept in sync with the server-side MAX_FILE_SIZE_MB default (see
// app/api/analyze/image/route.ts) — this is a UX shortcut only, not a
// security boundary; the server enforces its own limit regardless of what
// the client sends.
const MAX_FILE_SIZE_MB = 10;

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

export default function ImageUploader({ previewUrl, fileName, onFileSelected, onError }: ImageUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
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

  if (previewUrl) {
    return (
      <div className="rounded-2xl border border-white/9 bg-white/[0.04] p-4">
        <SelectedImagePreview imageUrl={previewUrl} fileName={fileName ?? "업로드된 이미지"} />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="mt-3 w-full rounded-xl border border-white/14 bg-white/8 py-2.5 text-sm font-medium text-[#f4f4f6] transition hover:bg-white/16"
        >
          다른 이미지로 교체
        </button>
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

  return (
    <div
      className={clsx(
        "flex flex-col items-center justify-center rounded-2xl border-2 border-dashed py-14 text-center transition-colors",
        isDragging ? "border-[#3b82f6] bg-[#3b82f6]/10" : "border-white/14 bg-white/[0.03] hover:border-white/25",
      )}
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
    >
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-xl border border-white/12 bg-white/5">
        <UploadCloud className="h-6 w-6 text-[#9a9aa4]" />
      </div>

      <p className="text-[15px] font-medium text-[#f4f4f6]">이미지를 드래그하거나 선택하세요</p>
      <p className="mt-1.5 mb-7 text-sm text-[#6b6b76]">JPG · PNG · WEBP · 최대 10MB</p>

      <div className="flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={() => cameraInputRef.current?.click()}
          className="inline-flex items-center gap-2 rounded-xl border border-white/14 bg-white/8 px-5 py-2.5 text-sm font-medium text-[#f4f4f6] transition hover:bg-white/16"
        >
          <Camera className="h-4 w-4" />
          사진 촬영
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="inline-flex items-center gap-2 rounded-xl bg-[#3b82f6] px-5 py-2.5 text-sm font-bold text-white shadow-[0_10px_30px_rgba(59,130,246,0.35)] transition hover:-translate-y-0.5"
        >
          <FolderOpen className="h-4 w-4" />
          파일 선택
        </button>
      </div>

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
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
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

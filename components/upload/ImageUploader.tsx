"use client";

import clsx from "clsx";
import { Camera, FolderOpen, UploadCloud } from "lucide-react";
import { useRef, useState } from "react";
import SelectedImagePreview from "./SelectedImagePreview";

interface ImageUploaderProps {
  previewUrl: string | null;
  fileName: string | null | undefined;
  onFileSelected: (file: File, dataUrl: string) => void;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("미리보기 이미지를 생성할 수 없습니다."));
    reader.readAsDataURL(file);
  });
}

export default function ImageUploader({ previewUrl, fileName, onFileSelected }: ImageUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFiles = async (fileList: FileList | null) => {
    const file = fileList?.[0];
    if (!file) return;
    const dataUrl = await fileToDataUrl(file);
    onFileSelected(file, dataUrl);
  };

  if (previewUrl) {
    return (
      <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
        <SelectedImagePreview imageUrl={previewUrl} fileName={fileName ?? "업로드된 이미지"} />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="mt-3 w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 text-sm text-slate-500 transition hover:bg-slate-100"
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
        isDragging ? "border-sky-400 bg-sky-50" : "border-slate-200 bg-slate-50 hover:border-slate-300",
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
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-200 bg-white shadow-sm">
        <UploadCloud className="h-6 w-6 text-slate-400" />
      </div>

      <p className="text-[15px] font-medium text-slate-700">이미지를 드래그하거나 선택하세요</p>
      <p className="mt-1.5 mb-7 text-sm text-slate-400">JPG · PNG · WEBP · 최대 10MB</p>

      <div className="flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={() => cameraInputRef.current?.click()}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-medium text-slate-600 shadow-sm transition hover:bg-slate-50"
        >
          <Camera className="h-4 w-4" />
          사진 촬영
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-900 bg-slate-900 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800"
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

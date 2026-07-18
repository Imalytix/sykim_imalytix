/* eslint-disable @next/next/no-img-element */
interface SelectedImagePreviewProps {
  imageUrl: string;
  fileName: string;
}

export default function SelectedImagePreview({ imageUrl, fileName }: SelectedImagePreviewProps) {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-[24px] border border-slate-200 bg-slate-50">
      <div className="border-b border-slate-200 px-4 py-3">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">미리보기</div>
        <div className="mt-1 truncate text-sm font-medium text-slate-700">{fileName}</div>
      </div>
      <div className="flex min-h-[320px] flex-1 items-center justify-center p-4">
        <img
          src={imageUrl}
          alt={fileName}
          className="max-h-[420px] w-full rounded-[20px] object-contain shadow-[0_10px_30px_rgba(15,23,42,0.08)]"
        />
      </div>
    </div>
  );
}

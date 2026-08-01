/* eslint-disable @next/next/no-img-element */
interface SelectedImagePreviewProps {
  imageUrl: string;
  fileName: string;
}

export default function SelectedImagePreview({ imageUrl, fileName }: SelectedImagePreviewProps) {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-white/8 bg-black/20">
      <div className="border-b border-white/8 px-4 py-3">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[#6b6b76]">미리보기</div>
        <div className="mt-1 truncate text-sm font-medium text-[#e5e5ea]">{fileName}</div>
      </div>
      <div className="flex min-h-[320px] flex-1 items-center justify-center p-4">
        <img src={imageUrl} alt={fileName} className="max-h-[420px] w-full rounded-lg object-contain" />
      </div>
    </div>
  );
}

import { AlertTriangle } from "lucide-react";

interface ErrorStateProps {
  title?: string;
  message: string;
}

export default function ErrorState({ title = "분석에 실패했습니다.", message }: ErrorStateProps) {
  return (
    <div className="rounded-3xl border border-rose-200 bg-rose-50 p-5 text-rose-900">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 text-rose-500" />
        <div>
          <div className="font-semibold">{title}</div>
          <div className="mt-1 text-sm leading-6 text-rose-800">{message}</div>
        </div>
      </div>
    </div>
  );
}

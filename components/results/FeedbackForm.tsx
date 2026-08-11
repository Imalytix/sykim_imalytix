"use client";

import { useState } from "react";

interface FeedbackFormProps {
  /** Stored alongside the message purely for manual cross-referencing —
   *  not a real foreign key (see supabase/schema.sql's feedback table). */
  requestId: string;
}

type SubmitState = "idle" | "submitting" | "sent" | "error";

/** Mirrors the design handoff's result.html .feedback section (title +
 *  textarea + submit + toast) — this project's version actually persists
 *  to Supabase instead of just showing a toast (see app/api/feedback/route.ts). */
export default function FeedbackForm({ requestId }: FeedbackFormProps) {
  const [message, setMessage] = useState("");
  const [state, setState] = useState<SubmitState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = message.trim();
    if (!trimmed || state === "submitting") return;

    setState("submitting");
    setErrorMessage(null);
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, request_id: requestId }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.detail ?? "피드백 전송에 실패했습니다.");
      setMessage("");
      setState("sent");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "피드백 전송에 실패했습니다.");
      setState("error");
    }
  };

  // 제출 완료 후엔 폼 대신 감사 인사 + 익스텐션 다운로드 유도로 교체 — 디자인 목업 그대로.
  if (state === "sent") {
    return (
      <div className="mt-4 flex flex-col items-center gap-5 border-t border-white/8 pt-8 text-center">
        <h2 className="text-[15px] font-bold leading-relaxed text-[#f4f4f6]">
          후기를 보내주셔서 감사합니다
          <br />
          서비스를 다운받아 이미지를 우클릭 한 번으로 검증해보세요
        </h2>
        <a
          href="https://chromewebstore.google.com/detail/imalytix-%EC%9D%B4%EB%AF%B8%EC%A7%80-%ED%83%90%EC%83%89/lkcgfkikbdaiiajjdhmbllnifmebacbn"
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-xl bg-[#52bdff] px-8 py-3 text-sm font-bold text-white shadow-[0_10px_30px_rgba(82,189,255,0.35)] transition hover:-translate-y-0.5"
        >
          다운로드
        </a>
      </div>
    );
  }

  return (
    <div className="mt-4 flex flex-col items-center gap-4 border-t border-white/8 pt-8 text-center">
      <h2 className="text-[15px] font-bold leading-relaxed text-[#f4f4f6]">
        서비스는 만족스러우셨나요?
        <br />
        소중한 후기를 들려주시면 검토 후 반영하겠습니다
      </h2>
      <form onSubmit={handleSubmit} className="flex w-full flex-col gap-3">
        <textarea
          rows={4}
          value={message}
          onChange={(e) => {
            setMessage(e.target.value);
            if (state === "error") setState("idle");
          }}
          placeholder="어떤 점이 좋았고, 아쉬웠는지 자유롭게 적어 주세요."
          className="w-full resize-none rounded-xl border border-white/14 bg-black/20 px-4 py-3 text-sm text-[#f4f4f6] placeholder-[#6b6b76] outline-none transition focus:border-[#52bdff] focus:ring-2 focus:ring-[#52bdff]/25"
        />
        <button
          type="submit"
          disabled={!message.trim() || state === "submitting"}
          className="rounded-xl bg-[#52bdff] py-3 text-sm font-bold text-white shadow-[0_10px_30px_rgba(82,189,255,0.35)] transition hover:-translate-y-0.5 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {state === "submitting" ? "전송 중…" : "피드백 남기기"}
        </button>
      </form>
      {state === "error" && errorMessage && <p className="text-[13px] text-rose-400">{errorMessage}</p>}
    </div>
  );
}

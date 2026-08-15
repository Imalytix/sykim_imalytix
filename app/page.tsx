"use client";

import { ChevronDown, FileCheck2, Layers, ScanEye, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import AnalysisStepsLoader from "@/components/results/AnalysisStepsLoader";
import AnalysisResultView from "@/components/results/AnalysisResultView";
import AppFooter from "@/components/layout/AppFooter";
import AppHeader from "@/components/layout/AppHeader";
import ImageUploader from "@/components/upload/ImageUploader";
import type { AnalysisResult } from "@/types/analysis";

// 히어로 아치에 올릴 실제 사진. 첫 번째(hero-1)가 스크롤 시 아치를 이탈해
// 아래 "판단 근거" 데모 쪽으로 날아가는 카드로 지정된다(참고 사이트 main.js의
// cards[0]/data-hero-card와 동일한 역할). 실사진은 8장뿐이라, 참고 사이트의
// 16장 링 밀도에 맞춰 두 바퀴 반복해 16장을 채운다 — layoutRing()이 카드
// 수(n)로 360°를 나누는 방식이라 반복해도 배치 자체는 그대로 자연스럽게 잘 됨.
const ARCH_PHOTOS = [
  "/hero-photos/hero-1.jpg",
  "/hero-photos/hero-2.jpg",
  "/hero-photos/hero-3.jpg",
  "/hero-photos/hero-4.jpg",
  "/hero-photos/hero-5.jpg",
  "/hero-photos/hero-6.jpg",
  "/hero-photos/hero-7.jpg",
  "/hero-photos/hero-8.jpg",
  "/hero-photos/hero-1.jpg",
  "/hero-photos/hero-2.jpg",
  "/hero-photos/hero-3.jpg",
  "/hero-photos/hero-4.jpg",
  "/hero-photos/hero-5.jpg",
  "/hero-photos/hero-6.jpg",
  "/hero-photos/hero-7.jpg",
  "/hero-photos/hero-8.jpg",
];

// 디자인 목업(Figma "이런 상황에서 쓰세요" 프레임)에서 카드 5장을 통째로
// 잘라낸 정적 이미지 — 배지·문구·일러스트가 전부 그 안에 그려져 있어서 텍스트를
// 따로 오버레이하지 않고 이미지 자체를 카드로 씀.
const USE_CASES = [
  { tag: "데이팅 앱", img: "/use-cases/dating.png" },
  { tag: "중고 거래", img: "/use-cases/secondhand.png" },
  { tag: "음식 리뷰", img: "/use-cases/food.png" },
  { tag: "숙소, 부동산", img: "/use-cases/housing.png" },
  { tag: "SNS", img: "/use-cases/sns.png" },
];

// 데모 카드가 요약(게이지) 다음으로 굴려 보여주는 "핵심 결과" 상세 —
// 디자인 목업의 익스텐션 팝업 하단부와 같은 구성. 실제 분석 결과가 아니라
// 연출용 고정 문구다.
const DEMO_SIGNALS = [
  { title: "촬영 정보가 확인되지 않습니다.", desc: "카메라로 촬영된 기록이 남아 있지 않습니다." },
  { title: "제작 이력을 확인할 수 없습니다.", desc: "제작·편집 기록인 C2PA 흔적이 이미지에 남아 있지 않습니다." },
  { title: "AI 생성과 유사한 특징이 다수 발견되었습니다.", desc: "질감과 패턴에서 AI 생성 이미지와 유사한 특성이 분석되었습니다." },
];

const TECH = [
  { icon: <Layers className="h-5 w-5" />, title: "Fusion Engine", desc: "여러 AI 모델의 분석 결과를 융합해 하나의 모델만 봤을 때의 한계를 보완합니다." },
  { icon: <ScanEye className="h-5 w-5" />, title: "Multi-model Analysis", desc: "서로 다른 관점의 AI 모델이 이미지를 동시에 대조 분석합니다." },
  { icon: <FileCheck2 className="h-5 w-5" />, title: "Explainable Results", desc: "결과와 함께 판단 근거를 제공하여 사용자가 직접 확인하고 이해할 수 있습니다." },
];

async function analyzeImageFile(file: File): Promise<AnalysisResult> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("mode", "standard");

  const response = await fetch("/api/analyze/image", { method: "POST", body: formData });
  // Vercel이 요청/응답 본문이 4.5MB를 넘으면 우리 라우트 코드가 실행되기도
  // 전에 플랫폼 레벨에서 JSON이 아닌 응답(예: "Request Entity Too Large")을
  // 돌려줄 수 있음 — response.json()이 그대로 SyntaxError를 던지면 사용자가
  // 원인 모를 파싱 에러 문구를 그대로 보게 되므로 안전하게 처리.
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 413) throw new Error("이미지 파일이 너무 큽니다. 더 작은 파일을 선택해주세요.");
    throw new Error(data?.detail ?? "분석에 실패했습니다.");
  }
  if (!data) throw new Error("서버 응답을 처리할 수 없습니다. 잠시 후 다시 시도해주세요.");
  return data as AnalysisResult;
}

export default function Home() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const showHero = !analysisResult && !isLoading;

  // ── 히어로 아치 + 스크롤 연출용 DOM 참조 ─────────────────────────────
  // 매 프레임 style을 직접 건드리는 애니메이션이라 React state로 리렌더를
  // 유발하지 않고 ref로 DOM을 직접 조작(참고 사이트 main.js와 동일한 접근).
  const heroSectionRef = useRef<HTMLElement | null>(null);
  const ringRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const heroCenterRef = useRef<HTMLDivElement | null>(null);
  const heroHintRef = useRef<HTMLDivElement | null>(null);
  const flyCardRef = useRef<HTMLDivElement | null>(null);

  const verifySectionRef = useRef<HTMLElement | null>(null);
  const verifyHeadRef = useRef<HTMLDivElement | null>(null);
  const dropZoneRef = useRef<HTMLDivElement | null>(null);
  const dropImgRef = useRef<HTMLDivElement | null>(null);
  const resultPanelRef = useRef<HTMLDivElement | null>(null);
  const gaugeCircleRef = useRef<HTMLDivElement | null>(null);
  const gaugeNumRef = useRef<HTMLSpanElement | null>(null);
  const badgeRef = useRef<HTMLSpanElement | null>(null);
  const descRef = useRef<HTMLParagraphElement | null>(null);
  const cardScrollRef = useRef<HTMLDivElement | null>(null);
  const cardFadeRef = useRef<HTMLDivElement | null>(null);
  const cardFadeTopRef = useRef<HTMLDivElement | null>(null);

  // 아치 배치·스크롤 연출 전체 — 참고 사이트(imalytix-web-deploy/js/main.js)의
  // layoutRing()/renderHero()/renderFlight()/renderVerify()를 그대로 이식.
  // 카드들이 원호(반원) 위에 배치되고, 스크롤하면 원호 전체가 회전하며 열리고,
  // 그중 한 장(hero-1)이 화면 중앙으로 날아올랐다가 아래 "판단 근거" 데모의
  // 체크보드 박스에 내려앉고, 결과 패널이 뒤이어 올라오며 게이지가 채워진다.
  useEffect(() => {
    if (!showHero) return;
    const hero = heroSectionRef.current;
    const verify = verifySectionRef.current;
    const ring = ringRef.current;
    const heroCard = cardRefs.current[0];
    const flyCard = flyCardRef.current;
    const dropZone = dropZoneRef.current;
    const dropImg = dropImgRef.current;
    const resultPanel = resultPanelRef.current;
    if (!hero || !verify || !ring || !heroCard || !flyCard || !dropZone || !dropImg || !resultPanel) return;

    const heroCenter = heroCenterRef.current;
    const heroHint = heroHintRef.current;
    const verifyHead = verifyHeadRef.current;
    const gaugeCircle = gaugeCircleRef.current;
    const gaugeNum = gaugeNumRef.current;
    const badge = badgeRef.current;
    const desc = descRef.current;
    const cardScroll = cardScrollRef.current;
    const cardFade = cardFadeRef.current;
    const cardFadeTop = cardFadeTopRef.current;
    // 카드 상세 파트에서 한 줄씩 차례로 떠오르는 요소들(순서 = DOM 순서)
    const reveals = cardScroll ? Array.from(cardScroll.querySelectorAll<HTMLElement>("[data-reveal]")) : [];

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
    const norm = (v: number, a: number, b: number) => clamp((v - a) / (b - a), 0, 1);
    const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
    const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

    /* ── 아치 배치 ── */
    const ARC_GAP_RATIO = 1.14; // 카드 폭 대비 최소 중심 간격(1.0 = 딱 붙음)
    let ringRadius = 0;
    let ringOffsetY = 24;

    function layoutRing() {
      const cardEls = cardRefs.current;
      if (!cardEls[0]) return;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const phone = vw < 768;
      const n = cardEls.length;

      // 닫힌 링(360°). n장을 균등하게 둘러 배치하므로 아무리 돌려도 끊긴
      // 구간이 생기지 않는다 — 화면엔 아래쪽을 베일 그라데이션이 덮어서
      // 반원처럼 보일 뿐. 아치 중심을 화면 아래쪽에 두면 반지름을 크게 쓸
      // 수 있고, 폰에서는 반지름이 화면 폭에 묶여 작아지는 탓에 중심을
      // 내리면 링 전체가 그라데이션 밑으로 사라져버려 거의 화면 중앙에 둔다.
      ringOffsetY = vh * (phone ? 0.02 : 0.28);
      const centerY = vh / 2 + ringOffsetY;
      const maxByWidth = Math.min(vw * (phone ? 0.54 : 0.46), 620);

      // 반지름은 카드 크기에, 카드 크기는 반지름에 걸려 있어 서로를 문다.
      // 둘레를 n장이 정확히 채우도록 카드 폭을 역산하고 두 번 수렴시킨다.
      //   2π(R − 0.61w) = n · w · GAP  →  w = 2πR / (n·GAP + 1.22π)
      let w = cardEls[0].offsetWidth || 120;
      for (let pass = 0; pass < 2; pass++) {
        ringRadius = Math.min(centerY - 76 - w * 0.61, maxByWidth); // 꼭대기가 내브를 피하도록
        w = clamp((2 * Math.PI * ringRadius) / (n * ARC_GAP_RATIO + 1.22 * Math.PI), 46, 170);
      }
      document.documentElement.style.setProperty("--ring-card", `${w}px`);
      ringRadius = Math.min(centerY - 76 - w * 0.61, maxByWidth);

      const step = 360 / n;
      cardEls.forEach((card, i) => {
        if (!card) return;
        const deg = -90 + step * i; // 첫 카드(hero-1)가 꼭대기에서 시작
        const rad = (deg * Math.PI) / 180;
        const x = Math.cos(rad) * ringRadius;
        const y = Math.sin(rad) * ringRadius;
        const tilt = deg + 90; // 카드가 링을 따라 부채꼴로 기울도록
        card.dataset.x = String(x);
        card.dataset.y = String(y);
        card.dataset.tilt = String(tilt);
        card.style.transform = `translate(${x}px, ${y}px) rotate(${tilt}deg)`;
      });
    }

    /* ── 카드 하나가 아치를 이탈해 결과 데모로 날아가는 애니메이션 ──
       두 섹션에 걸쳐 있어 절대 scrollY 기준으로 구동하며, 양 끝점을 매번
       실측해서(measureFlight) 목표 지점이 살아있는 값이 되도록 한다. */
    const FLY_HOLD = 0.44; // 공중에서 부풀며 머무는 구간의 비중
    const flight: {
      s: number;
      e: number;
      armed: boolean;
      from: { x: number; y: number; w: number; h: number } | null;
      rot0: number;
      landed: boolean | null;
    } = { s: 0, e: 0, armed: false, from: null, rot0: 0, landed: null };

    function measureFlight() {
      const vh = window.innerHeight;
      flight.s = hero!.offsetTop + (hero!.offsetHeight - vh) * 0.55;
      // 0.09 = 예전 340vh 섹션에서의 0.12와 같은 지점(약 29vh). 섹션이
      // 상세 파트만큼 길어졌으므로 비율을 낮춰 착지 시점을 그대로 유지한다.
      flight.e = verify!.offsetTop + (verify!.offsetHeight - vh) * 0.09;
    }

    /* ── 카드 안에서 요약 → 상세로 굴러가는 거리 ──
       카드는 고정 높이 뷰포트이고 그 안의 내용 기둥(cardScroll)을 스크롤에
       맞춰 위로 밀어 올린다. 넘치는 만큼이 곧 굴릴 거리라 실측해서 쓴다. */
    let cardScrollMax = 0;
    function measureCard() {
      if (!cardScroll) return;
      cardScrollMax = Math.max(0, cardScroll.scrollHeight - resultPanel!.clientHeight);
    }

    function armFlight(spin: number) {
      const r = heroCard!.getBoundingClientRect();
      flight.from = {
        x: r.left + r.width / 2,
        y: r.top + r.height / 2,
        w: heroCard!.offsetWidth,
        h: heroCard!.offsetHeight,
      };
      const deg = (parseFloat(heroCard!.dataset.tilt || "0") || 0) + spin;
      flight.rot0 = (((deg % 360) + 540) % 360) - 180;
      flight.armed = true;
    }

    function setLanded(on: boolean) {
      if (flight.landed === on) return;
      flight.landed = on;
      dropImg!.style.opacity = on ? "1" : "0";
      dropImg!.classList.toggle("is-landed", on);
      dropZone!.classList.toggle("is-hit", on);
    }

    function renderFlight(spin: number) {
      const sy = window.pageYOffset || document.documentElement.scrollTop;
      const fp = norm(sy, flight.s, flight.e);

      if (fp <= 0) {
        flight.armed = false;
        flyCard!.classList.remove("is-active");
        heroCard!.style.opacity = "";
        setLanded(false);
        return 0;
      }
      if (fp >= 1) {
        flyCard!.classList.remove("is-active");
        heroCard!.style.opacity = "0";
        setLanded(true);
        return 1;
      }

      if (!flight.armed) armFlight(spin);
      heroCard!.style.opacity = "0";
      setLanded(false);
      flyCard!.classList.add("is-active");

      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const f = flight.from!;
      const tr = dropImg!.getBoundingClientRect(); // 살아있는 값(프레임이 스크롤되며 계속 움직임)
      const to = { x: tr.left + tr.width / 2, y: tr.top + tr.height / 2, w: tr.width, h: tr.height };

      // 공중 정지 지점 — 양 끝보다 커야 "다가오는" 느낌이 남
      const holdW = clamp(Math.max(f.w * 2.7, to.w * 1.5), 170, Math.min(vw * 0.72, vh * 0.5));
      const hold = { x: vw * 0.5, y: vh * 0.47, w: holdW, h: holdW * 1.12 };

      let x: number, y: number, w: number, h: number, t: number;
      if (fp <= FLY_HOLD) {
        t = easeOutCubic(fp / FLY_HOLD);
        x = lerp(f.x, hold.x, t);
        y = lerp(f.y, hold.y, t);
        w = lerp(f.w, hold.w, t);
        h = lerp(f.h, hold.h, t);
      } else {
        t = easeInOutCubic((fp - FLY_HOLD) / (1 - FLY_HOLD));
        x = lerp(hold.x, to.x, t);
        y = lerp(hold.y, to.y, t);
        w = lerp(hold.w, to.w, t);
        h = lerp(hold.h, to.h, t);
        const arc = Math.sin(t * Math.PI); // 직선이 아니라 살짝 휘어져 들어감
        x += arc * (to.x < hold.x ? 44 : -44);
        y -= arc * 28;
      }

      const swell = reduceMotion ? 0 : Math.sin(fp * Math.PI); // 0→1→0, 공중에 떠있을 때만 기울어짐
      const rotZ = lerp(flight.rot0, 0, easeOutCubic(clamp(fp / FLY_HOLD, 0, 1)));

      flyCard!.style.width = `${w}px`;
      flyCard!.style.height = `${h}px`;
      flyCard!.style.borderRadius = `${clamp(w * 0.07, 12, 26)}px`;
      flyCard!.style.opacity = String(lerp(0.2, 1, norm(fp, 0, 0.2)));
      flyCard!.style.transform =
        `translate3d(${x - w / 2}px, ${y - h / 2}px, 0)` +
        ` perspective(1000px) rotateX(${13 * swell}deg) rotateY(${-34 * swell}deg) rotate(${rotZ}deg)`;

      return fp;
    }

    function renderHero() {
      const rect = hero!.getBoundingClientRect();
      const total = hero!.offsetHeight - window.innerHeight;
      const p = clamp(-rect.top / total, 0, 1);

      const spin = easeOutCubic(p) * 240;
      const drift = lerp(1, 1.18, p);
      const lift = ringOffsetY + p * -40;
      ring!.style.transform = `translate(0, ${lift}px) rotate(${spin}deg) scale(${drift})`;

      const fp = renderFlight(spin);

      // 카드가 공중에 떠 있는 동안엔 아치와 히어로 문구가 무대를 비워준다
      ring!.style.opacity = String((1 - norm(p, 0.82, 1) * 0.85) * (1 - norm(fp, 0.03, 0.38)));
      const out = norm(fp, 0, 0.24);
      if (heroCenter) {
        heroCenter.style.transform = `scale(${1 - out * 0.14}) translateY(${-out * 40}px)`;
        heroCenter.style.opacity = String(1 - out);
      }
      if (heroHint) heroHint.style.opacity = String(1 - norm(fp, 0, 0.2));
    }

    function renderVerify() {
      const rect = verify!.getBoundingClientRect();
      const total = verify!.offsetHeight - window.innerHeight;
      const p = clamp(-rect.top / total, 0, 1);

      // 아래 구간들은 섹션이 340vh였을 때의 비율을 420vh 기준으로 환산한 값
      // (스크롤 가능 구간 240vh → 320vh). 각 연출이 도는 스크롤 지점은 예전
      // 그대로 두고, 뒤에 붙은 상세 파트가 남은 구간을 쓰도록 하기 위함.
      if (verifyHead) {
        const h = norm(p, 0.015, 0.135);
        verifyHead.style.opacity = String(h);
        verifyHead.style.transform = `translateY(${(1 - h) * 26}px)`;
      }

      // 결과 패널이 아래에서 올라옴
      const r = norm(p, 0.225, 0.42);
      const re = easeOutCubic(r);
      resultPanel!.style.transform = `translateY(${(1 - re) * 105}%)`;
      resultPanel!.style.opacity = String(norm(p, 0.225, 0.285));

      // 게이지가 채워지며 숫자가 오름 — 다 차면 배지/문구 등장
      const g = norm(p, 0.315, 0.525);
      const eg = easeOutCubic(g);
      const pct = Math.round(75 * eg);
      if (gaugeCircle) gaugeCircle.style.background = `conic-gradient(#f23e3e ${pct * 3.6}deg, #f2f2f2 0deg)`;
      if (gaugeNum) gaugeNum.textContent = `${pct}%`;
      const doneOpacity = String(norm(g, 0.94, 1));
      if (badge) badge.style.opacity = doneOpacity;
      if (desc) desc.style.opacity = doneOpacity;

      // 요약이 끝나면 카드 안 내용이 위로 밀려 올라가며 "핵심 결과" 상세로
      // 넘어간다 — 팝업을 손으로 스크롤해 내리는 것과 같은 움직임.
      const s = easeInOutCubic(norm(p, 0.55, 0.89));
      if (cardScroll) cardScroll.style.transform = `translateY(${-s * cardScrollMax}px)`;
      // 더 볼 게 남았다는 힌트 — 바닥까지 굴러가면 사라진다
      if (cardFade) cardFade.style.opacity = String(1 - norm(s, 0.72, 1));
      if (cardFadeTop) cardFadeTop.style.opacity = String(norm(s, 0.02, 0.18));
      reveals.forEach((el, i) => {
        const e = easeOutCubic(norm(s, i * 0.09, i * 0.09 + 0.3));
        el.style.opacity = String(e);
        el.style.transform = `translateY(${(1 - e) * 16}px)`;
      });
    }

    let rafId = 0;
    function onScroll() {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        renderHero();
        renderVerify();
      });
    }
    function handleResize() {
      layoutRing();
      measureFlight();
      measureCard();
      flight.armed = false;
      onScroll();
    }
    function handleLoad() {
      layoutRing();
      measureFlight();
      measureCard();
      onScroll();
    }
    function handleVisibility() {
      if (!document.hidden) onScroll();
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", handleResize);
    window.addEventListener("load", handleLoad);
    document.addEventListener("visibilitychange", handleVisibility);

    layoutRing();
    measureFlight();
    measureCard();
    onScroll();
    // 웹폰트 등으로 섹션 높이가 첫 페인트 이후 바뀔 수 있어, 이미 load가
    // 끝난 상태로 마운트된 경우(주로 이 경우)에도 한 번 더 재계산.
    if (document.readyState === "complete") handleLoad();

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("load", handleLoad);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [showHero]);

  // "이런 상황에서 쓰세요" 마퀴 — 속도(px/초)가 화면 크기와 무관하게 항상
  // 일정하도록, 카드 목록 한 벌의 실제 폭을 재서 재생 시간을 계산한다.
  // 카드 목록을 두 번 이어붙였으므로 scrollWidth의 절반이 한 벌 폭.
  const marqueeTrackRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const track = marqueeTrackRef.current;
    if (!track) return;
    const DRIFT_SPEED = 42; // px/s — 참고 사이트의 --drift-speed와 동일
    function tuneDrift() {
      const setWidth = track!.scrollWidth / 2;
      if (!setWidth) return;
      track!.style.setProperty("--drift-dur", `${setWidth / DRIFT_SPEED}s`);
    }
    tuneDrift();
    window.addEventListener("resize", tuneDrift);
    window.addEventListener("load", tuneDrift);
    return () => {
      window.removeEventListener("resize", tuneDrift);
      window.removeEventListener("load", tuneDrift);
    };
  }, []);

  // 익스텐션 데모 영상 — 참고 사이트와 동일하게 화면에 보일 때만 재생하고
  // 벗어나면 멈춤(항상 자동재생하는 것보다 배터리/리소스 부담이 적음).
  const extVideoRef = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const video = extVideoRef.current;
    if (!video) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) video.play().catch(() => {});
        else video.pause();
      },
      { threshold: 0.45 },
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, []);

  // 기술 신뢰도 카드 3장 — 스크롤로 화면에 들어오면 한 번에 페이드인(디자인
  // 피드백: 개별 등장이 아니라 3개 박스 동시 등장).
  const techGridRef = useRef<HTMLDivElement | null>(null);
  const [techVisible, setTechVisible] = useState(false);
  useEffect(() => {
    const el = techGridRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setTechVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const handleAnalyze = async (fileOverride?: File) => {
    const file = fileOverride ?? selectedFile;
    if (!file) {
      setErrorMessage("이미지를 먼저 선택해주세요.");
      return;
    }
    try {
      setErrorMessage(null);
      setIsLoading(true);
      const result = await analyzeImageFile(file);
      setPreviewUrl(result.analyzed_image_data_url);
      setAnalysisResult(result);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "분석에 실패했습니다.");
    } finally {
      setIsLoading(false);
    }
  };

  // 아치 카드를 클릭하면 그 사진을 바로 업로드한 것처럼 분석 시작 — 브라우저가
  // 우리 자신의 public/ 정적 파일을 fetch해서 File로 감싼 뒤 기존 파일 업로드
  // 경로를 그대로 재사용.
  const handleSampleClick = async (src: string) => {
    try {
      setErrorMessage(null);
      const response = await fetch(src);
      if (!response.ok) throw new Error("샘플 이미지를 불러올 수 없습니다.");
      const blob = await response.blob();
      const filename = src.split("/").pop() ?? "sample.jpg";
      const file = new File([blob], filename, { type: blob.type || "image/jpeg" });
      setSelectedFile(file);
      setPreviewUrl(src);
      await handleAnalyze(file);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "샘플 이미지를 불러올 수 없습니다.");
    }
  };

  return (
    <div className="min-h-screen bg-black">
      <AppHeader />

      {showHero && (
        <>
          {/* ─────────── PART 1 · 히어로(아치 카드 + 업로드) ─────────── */}
          <section id="top" ref={heroSectionRef} className="hero-pin">
            <div className="hero-pin__sticky">
              <div ref={ringRef} className="hero-ring" aria-hidden="true">
                {ARCH_PHOTOS.map((src, i) => (
                  <button
                    key={`${src}-${i}`}
                    type="button"
                    ref={(el) => {
                      cardRefs.current[i] = el;
                    }}
                    onClick={() => handleSampleClick(src)}
                    aria-label="샘플 이미지로 바로 검증하기"
                    className="ring-card"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- public/ 정적 데모 자산, next/image 이점 없음 */}
                    <img src={src} alt="" />
                  </button>
                ))}
              </div>

              <div className="hero-veil" aria-hidden="true" />

              <div ref={heroCenterRef} className="relative z-[5] mx-auto max-w-2xl px-6 text-center sm:max-w-4xl">
                <h1 className="break-keep text-4xl font-bold tracking-tight text-[#f4f4f6] [text-shadow:0_4px_30px_rgba(0,0,0,0.6)] sm:text-5xl">
                  더 확실한 판단을 위한 이미지 검증
                </h1>
                <p className="mt-4 break-keep text-base leading-relaxed text-[rgba(244,244,246,0.82)] [text-shadow:0_2px_22px_rgba(0,0,0,0.75)] sm:text-2xl">
                  Imalytix는 AI 생성 여부와 이미지 조작 가능성을{" "}
                  <br className="sm:hidden" />
                  다양한 분석 기법으로 검증하고,{" "}
                  <br className="hidden sm:block" />
                  결과와 판단 근거를 제공하는 이미지 검증 서비스입니다.
                </p>

                <div className="mt-10 flex flex-col items-center gap-4">
                  <ImageUploader
                    previewUrl={previewUrl}
                    fileName={selectedFile?.name ?? null}
                    onFileSelected={(file, dataUrl) => {
                      setSelectedFile(file);
                      setPreviewUrl(dataUrl);
                      setErrorMessage(null);
                    }}
                    onError={(message) => setErrorMessage(message)}
                  />

                  {errorMessage && (
                    <div className="w-full max-w-sm rounded-xl border border-rose-500/25 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-200">
                      {errorMessage}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => handleAnalyze()}
                    className="rounded-xl bg-[#52bdff] px-8 py-3 text-sm font-bold tracking-tight text-white shadow-[0_10px_30px_rgba(82,189,255,0.175)] transition hover:-translate-y-0.5 hover:shadow-[0_10px_30px_rgba(82,189,255,0.35)]"
                  >
                    이미지 검증하기
                  </button>
                </div>
              </div>

              <div ref={heroHintRef} className="hero-hint">
                <span>Scroll</span>
                <ChevronDown className="h-3.5 w-3.5" />
              </div>
            </div>
          </section>

          {/* 아치를 이탈해 날아가는 카드의 분신(clone) — position:fixed */}
          <div ref={flyCardRef} className="fly-card" aria-hidden="true">
            {/* eslint-disable-next-line @next/next/no-img-element -- 스크롤 연출용 고정 이미지, next/image 이점 없음 */}
            <img src={ARCH_PHOTOS[0]} alt="" />
          </div>

          {/* ─────────── PART 2 · 판단 근거 데모(결과 패널이 스크롤에 맞춰 등장) ─────────── */}
          <section ref={verifySectionRef} className="verify-pin">
            <div className="verify-pin__sticky">
              <div ref={verifyHeadRef} className="max-w-lg px-6 sm:max-w-2xl">
                <h2 className="break-keep text-2xl font-extrabold tracking-tight text-[#f4f4f6] sm:text-[40px]">결과만이 아닌, 판단 근거까지 제공합니다.</h2>
                <p className="mt-3 break-keep text-sm leading-relaxed text-[#9a9aa4] sm:text-2xl">
                  AI 생성 가능성과 다양한 분석 결과를 함께 확인하여,{" "}
                  <br className="hidden sm:block" />
                  결과를 더 쉽게 이해하고 판단할 수 있습니다.
                </p>
              </div>

              <div className="verify-stage">
                <div ref={dropZoneRef} className="verify-drop">
                  <div ref={dropImgRef} className="drop-img">
                    {/* eslint-disable-next-line @next/next/no-img-element -- 스크롤 연출용 고정 이미지, next/image 이점 없음 */}
                    <img src={ARCH_PHOTOS[0]} alt="" />
                  </div>
                </div>

                <div className="verify-result">
                  <div ref={resultPanelRef} className="verify-card w-full overflow-hidden rounded-2xl bg-white text-left text-[#1a1a1a]" style={{ opacity: 0 }}>
                    <div ref={cardScrollRef} className="verify-card__scroll">
                      <div className="flex items-center justify-between px-4 py-2.5">
                        <span className="flex items-center gap-1.5 text-[13px] font-extrabold tracking-tight">
                          {/* eslint-disable-next-line @next/next/no-img-element -- 카드 안 고정 크기 워드마크, next/image 이점 없음 */}
                          <img src="/imalytix-icon.png" alt="" className="h-4 w-auto" /> imalytix
                        </span>
                        <X className="h-3.5 w-3.5 text-[#bbb]" />
                      </div>
                      <div className="flex items-center gap-2.5 border-t border-black/6 px-4 py-2.5">
                        {/* eslint-disable-next-line @next/next/no-img-element -- 스크롤 연출용 고정 썸네일, next/image 이점 없음 */}
                        <img src={ARCH_PHOTOS[0]} alt="" className="h-8 w-8 shrink-0 rounded-lg object-cover" />
                        <div className="min-w-0">
                          <div className="truncate text-[12px] font-semibold text-[#1a1a1a]">이 이미지를 분석했습니다.</div>
                          <div className="text-[11px] text-[#8a8a8a]">방금 전</div>
                        </div>
                      </div>
                      <div className="flex flex-col items-center gap-3 px-4 py-6">
                        <div
                          ref={gaugeCircleRef}
                          className="relative flex h-24 w-24 items-center justify-center rounded-full"
                          style={{ background: "conic-gradient(#f23e3e 0deg, #f2f2f2 0deg)" }}
                        >
                          <div className="absolute inset-[7px] flex flex-col items-center justify-center gap-0.5 rounded-full bg-white text-center">
                            <span className="text-[9px] font-semibold leading-none text-[#9a9aa4]">AI 생성 가능성</span>
                            <span ref={gaugeNumRef} className="text-xl font-extrabold leading-none">
                              0%
                            </span>
                          </div>
                        </div>
                        <span ref={badgeRef} className="rounded-full bg-[#f23e3e] px-3 py-1 text-[11px] font-bold text-white opacity-0 transition-opacity duration-300">
                          높음
                        </span>
                        <p ref={descRef} className="mt-0.5 text-[12px] text-[#7a7a7a] opacity-0 transition-opacity duration-300">
                          AI 생성 이미지일 가능성이 높습니다.
                        </p>
                      </div>
                      {/* ── 여기서부터가 스크롤로 넘어오는 상세 파트 ── */}
                      <div data-reveal className="border-t border-black/6 px-4 pt-3 text-[12px] font-extrabold opacity-0">
                        핵심 결과
                      </div>
                      <div className="flex flex-col gap-2 px-4 pb-4 pt-2">
                        {DEMO_SIGNALS.map((sig) => (
                          <div key={sig.title} data-reveal className="flex items-start gap-2 rounded-xl border border-black/8 bg-[#fafafa] px-3 py-2.5 opacity-0">
                            <span className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-black/15 text-[#9a9aa4]">
                              <X className="h-2.5 w-2.5" strokeWidth={3} />
                            </span>
                            <div className="min-w-0">
                              <div className="break-keep text-[12px] font-bold leading-snug">{sig.title}</div>
                              <div className="mt-0.5 break-keep text-[11px] leading-snug text-[#8a8a8a]">{sig.desc}</div>
                            </div>
                          </div>
                        ))}
                        <div data-reveal className="rounded-xl border border-[#52bdff]/60 bg-[#52bdff]/[0.06] px-3 py-3 opacity-0">
                          <div className="break-keep text-[12px] font-bold">이 이미지를 어떻게 해석하면 좋을까요?</div>
                          <p className="mt-1 break-keep text-[11px] leading-relaxed text-[#6b6b76]">
                            여러 분석 신호에서 AI 생성과 유사한 특징이 확인되었습니다. 중요한 의사결정에 활용하기 전에는 원본 출처와 다른 정보도 함께 확인하는 것을 권장합니다.
                          </p>
                        </div>
                        {/* 목업의 CTA를 그대로 그린 연출용 요소 — 실제로 누르는 버튼이 아니라 <div> */}
                        <div data-reveal className="rounded-xl bg-[#52bdff] py-2.5 text-center text-[12px] font-bold text-white opacity-0">자세한 분석 보기</div>
                      </div>
                    </div>
                    {/* 아래에 더 있다는 힌트 — 바닥까지 굴러가면 걷힌다 */}
                    <div ref={cardFadeRef} className="verify-card__fade" />
                    <div ref={cardFadeTopRef} className="verify-card__fade verify-card__fade--top" />
                  </div>
                </div>
              </div>
            </div>
          </section>
        </>
      )}

      <main className="mx-auto w-full max-w-5xl px-6 py-10">
        <AnalysisStepsLoader active={isLoading} previewUrl={previewUrl} />

        {analysisResult && !isLoading && (
          <AnalysisResultView
            analysisResult={analysisResult}
            previewUrl={previewUrl}
            errorMessage={errorMessage}
            returnPath={`/result/${analysisResult.request_id}`}
          />
        )}

        {showHero && (
          <>
            {/* 이런 상황에서 쓰세요 — 좌측으로 계속 흘러가는 카드 행 */}
            <section className="mt-10 text-center">
              <h2 className="break-keep text-2xl font-extrabold tracking-tight text-[#f4f4f6] sm:text-[40px]">이미지를 믿기 어려운 AI 시대</h2>
              <p className="mx-auto mt-3 max-w-lg break-keep text-sm leading-relaxed text-[#9a9aa4] sm:max-w-2xl sm:text-2xl">
                이제 실제와 구분하기 어려운 이미지를 만들어냅니다.{" "}
                <br className="hidden sm:block" />
                중요한 이미지는 눈으로만 판단하기보다, 검증을 통해 확인해야 합니다.
              </p>
              <div className="marquee-viewport mt-10 overflow-hidden py-2">
                {/* 카드 목록을 통째로 두 번 이어붙여서 -50%까지 흘러가면 이음매 없이 반복 */}
                <div ref={marqueeTrackRef} className="animate-marquee flex w-max gap-4">
                  {[...USE_CASES, ...USE_CASES].map((uc, i) => (
                    // eslint-disable-next-line @next/next/no-img-element -- public/ 정적 디자인 에셋, next/image 이점 없음
                    <img key={`${uc.tag}-${i}`} src={uc.img} alt={uc.tag} className="h-[312px] w-[220px] shrink-0 rounded-2xl" />
                  ))}
                </div>
              </div>
            </section>

            {/* 기술 신뢰도 */}
            <section id="tech" className="mt-24 rounded-3xl border border-white/8 bg-white/[0.02] px-6 py-16 text-center">
              <h2 className="break-keep text-2xl font-extrabold tracking-tight text-[#f4f4f6] sm:text-[40px]">국내외 AI 전문가의 자문을 바탕으로 설계했습니다.</h2>
              <p className="mx-auto mt-3 max-w-xl break-keep text-sm leading-relaxed text-[#9a9aa4] sm:max-w-2xl sm:text-2xl">
                탐지 모델 구조와 검증 방식은 KAIST 연구실, KT 임직원과{" "}
                <br className="hidden sm:block" />
                해외 유명 대학 ML 엔지니어의 자문을 통해 설계되었습니다.
              </p>
              <div
                ref={techGridRef}
                className={`mx-auto mt-10 grid max-w-4xl gap-5 text-left transition-all duration-700 ease-out sm:grid-cols-3 ${
                  techVisible ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0"
                }`}
              >
                {TECH.map((t) => (
                  <div key={t.title} className="rounded-2xl border border-white/9 bg-white/[0.04] p-7 transition hover:border-[#52bdff]/40">
                    <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-[#52bdff]/15 text-[#52bdff]">{t.icon}</div>
                    <div className="text-[17px] font-extrabold text-[#f4f4f6]">{t.title}</div>
                    <p className="mt-2 text-sm leading-relaxed text-[#9a9aa4]">{t.desc}</p>
                  </div>
                ))}
              </div>
            </section>

            {/* 익스텐션 홍보 — 참고 사이트(PART 5 · EXTENSION VIDEO)와 동일한 구성 */}
            <section className="mt-24 text-center">
              <h2 className="break-keep text-2xl font-extrabold tracking-tight text-[#f4f4f6] sm:text-[40px]">
                브라우저 익스텐션으로,{" "}
                <br className="sm:hidden" />
                보던 화면 그대로
              </h2>
              <p className="mx-auto mt-3 max-w-lg break-keep text-sm leading-relaxed text-[#9a9aa4] sm:max-w-none sm:text-2xl">
                설치 한 번이면 뉴스·SNS·쇼핑몰 어디서든{" "}
                <br className="sm:hidden" />
                우클릭으로 바로 검증할 수 있습니다.
              </p>
              <div className="mx-auto mt-10 max-w-[860px] overflow-hidden rounded-[18px] border border-white/10 bg-[#1b1b21] shadow-[0_30px_90px_rgba(0,0,0,0.6)]">
                <video
                  ref={extVideoRef}
                  src="/extension-demo.mp4"
                  muted
                  loop
                  playsInline
                  autoPlay
                  preload="auto"
                  className="block w-full bg-black"
                />
              </div>
              <a
                href="#top"
                className="mt-8 hidden rounded-xl bg-[#52bdff] px-8 py-3 text-sm font-bold tracking-tight shadow-[0_10px_30px_rgba(82,189,255,0.175)] transition hover:-translate-y-0.5 hover:shadow-[0_10px_30px_rgba(82,189,255,0.35)] sm:inline-block"
              >
                <span className="cta-sheen">무료로 시작하기</span>
              </a>
            </section>
          </>
        )}
      </main>

      <AppFooter />
    </div>
  );
}

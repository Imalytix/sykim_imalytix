import type { Metadata } from "next";
import AppHeader from "@/components/layout/AppHeader";

export const metadata: Metadata = {
  title: "개인정보처리방침 — Imalytix",
  description: "Imalytix 웹 서비스 및 Chrome 확장 프로그램의 개인정보 수집·이용·보관에 관한 방침입니다.",
};

// Chrome Web Store 심사는 이 URL이 항상 열려야 하므로(로그인 뒤로 숨기거나
// 리다이렉트하면 반려 사유가 됩니다) 인증 없이 정적으로 렌더링되는 페이지로
// 둡니다 — proxy.ts는 세션 갱신만 하고 게이팅은 하지 않으므로 그대로 공개.
const EFFECTIVE_DATE = "2026년 8월 6일";
const CONTACT_EMAIL = "imalytix@gmail.com";
const SERVICE_ORIGIN = "https://sykimimalytix.vercel.app";

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 border-t border-white/8 pt-8">
      <h2 className="text-base font-bold text-[#f4f4f6]">{title}</h2>
      <div className="mt-3 flex flex-col gap-3 text-sm leading-7 text-[#c4c4cc]">{children}</div>
    </section>
  );
}

function Bullets({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="flex list-disc flex-col gap-2 pl-5 marker:text-[#5a5a66]">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

const PERMISSIONS: { name: string; purpose: string }[] = [
  {
    name: "contextMenus",
    purpose:
      "웹페이지의 이미지를 우클릭했을 때 컨텍스트 메뉴에 “Imalytix로 이미지 분석하기” 항목을 추가하기 위해 사용합니다. 메뉴 항목 등록 이외의 용도로는 사용하지 않으며, 이 권한으로 페이지 내용을 읽지 않습니다.",
  },
  {
    name: "storage",
    purpose:
      "사용자가 지정한 분석 서버 주소(API 엔드포인트) 설정값과, 우클릭한 이미지 주소를 결과 화면으로 넘기기 위한 일시적 값만 브라우저 로컬 영역에 저장합니다. 브라우저 밖으로 동기화하거나 서버로 보내지 않습니다.",
  },
  {
    name: "sidePanel",
    purpose: "분석 결과를 브라우저 사이드 패널에 표시하기 위해 사용합니다. 사용자가 확장 프로그램을 실행했을 때만 열립니다.",
  },
  {
    name: "호스트 권한 (<all_urls>)",
    purpose:
      "사용자가 어떤 사이트에서든 이미지를 우클릭해 분석하고 그 결과를 해당 페이지 위에 표시할 수 있어야 하므로, 특정 도메인 목록으로 한정할 수 없어 전체 사이트 접근 권한을 요청합니다. 결과 UI는 기본적으로 표시되지 않으며 사용자가 직접 실행했을 때만 나타납니다. 이 권한으로 페이지의 텍스트·입력값·쿠키·방문 기록을 읽거나 수집하지 않습니다.",
  },
  {
    name: `분석 서버 통신 (${SERVICE_ORIGIN})`,
    purpose:
      "분석 요청과 결과 수신은 위 자사 서버로만 전송됩니다. 그 외 어떤 외부 도메인으로도 사용자 데이터를 전송하지 않습니다.",
  },
];

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0c]">
      <AppHeader />

      <main className="mx-auto w-full max-w-3xl px-6 py-12">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#6b6b76]">Privacy Policy</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-[#f4f4f6]">개인정보처리방침</h1>
        <p className="mt-2 text-sm text-[#9a9aa4]">시행일: {EFFECTIVE_DATE}</p>

        <div className="mt-8 rounded-2xl border border-white/9 bg-white/[0.04] p-6 text-sm leading-7 text-[#c4c4cc]">
          Imalytix(이하 “서비스”)는 이미지가 AI로 생성되었을 가능성을 분석해 알려주는 도구입니다. 서비스는 그 목적을 수행하는 데
          필요한 최소한의 정보만 처리하며, <strong className="font-semibold text-[#f4f4f6]">이용자의 웹 브라우징 기록, 페이지
          내용, 입력값, 개인 식별 정보를 수집하지 않습니다.</strong> 본 방침은 웹사이트({SERVICE_ORIGIN})와 Chrome 확장 프로그램
          “imalytix” 모두에 동일하게 적용됩니다.
        </div>

        <div className="mt-10 flex flex-col gap-8">
          <Section id="collect" title="1. 수집하는 정보">
            <p>서비스는 아래 정보만 수집합니다. 어느 항목도 광고·프로파일링 목적으로는 사용되지 않습니다.</p>
            <Bullets
              items={[
                <>
                  <strong className="font-semibold text-[#f4f4f6]">분석 대상 이미지</strong> — 이용자가 직접 업로드한 이미지 파일,
                  또는 이용자가 우클릭 메뉴로 명시적으로 선택한 이미지의 주소(URL)와 해당 이미지 데이터. 이용자가 분석을 요청하지
                  않은 이미지는 어떤 경우에도 전송되지 않습니다.
                </>,
                <>
                  <strong className="font-semibold text-[#f4f4f6]">요청 기술 정보</strong> — 분석 요청 처리·오류 추적·남용(과도한
                  자동 요청) 방지를 위해 IP 주소, 브라우저 User-Agent, 요청 출처(Origin/Referer), 요청 시각, 처리 소요 시간, 파일명 및
                  이미지 크기·형식 등 기술적 메타데이터를 기록합니다.
                </>,
                <>
                  <strong className="font-semibold text-[#f4f4f6]">계정 정보(선택)</strong> — 웹사이트에서 회원가입·로그인을 한
                  경우에 한해 이메일 주소와 표시 이름을 저장하며, 이는 “내 분석 이력” 기능 제공에만 사용됩니다. 로그인은 필수가
                  아니며, 확장 프로그램은 로그인 없이도 사용할 수 있습니다.
                </>,
                <>
                  <strong className="font-semibold text-[#f4f4f6]">이용자가 직접 보낸 피드백</strong> — 결과 화면의 피드백 양식에
                  이용자가 작성해 제출한 내용.
                </>,
              ]}
            />
          </Section>

          <Section id="not-collect" title="2. 수집하지 않는 정보">
            <p>서비스는 아래 정보를 수집·저장·전송하지 않습니다.</p>
            <Bullets
              items={[
                "이용자가 방문한 웹페이지의 주소, 제목, 본문, HTML 등 페이지 콘텐츠",
                "브라우징 기록·검색 기록·북마크·탭 목록",
                "입력 양식에 입력한 값, 비밀번호, 인증 정보, 쿠키, 로컬 스토리지 등 웹사이트 세션 데이터",
                "키 입력, 마우스 이동, 클립보드, 화면 녹화 등 이용자 행동 기록",
                "위치 정보, 연락처, 기기 식별자, 금융 정보, 건강 정보",
              ]}
            />
            <p>
              확장 프로그램의 결과 표시 UI는 기본 상태에서 동작하지 않으며, 이용자가 우클릭 메뉴 또는 툴바 아이콘으로 직접 실행한
              경우에만 표시됩니다.
            </p>
          </Section>

          <Section id="permissions" title="3. 요청 권한과 사용 목적">
            <p>확장 프로그램은 아래 권한만 요청하며, 각 권한은 명시된 목적 외로 사용되지 않습니다.</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="w-44 py-2 pr-4 align-top font-semibold text-[#9a9aa4]">권한</th>
                    <th className="py-2 font-semibold text-[#9a9aa4]">사용 목적</th>
                  </tr>
                </thead>
                <tbody>
                  {PERMISSIONS.map((perm) => (
                    <tr key={perm.name} className="border-b border-white/6 align-top">
                      <td className="py-3 pr-4 font-mono text-[13px] leading-6 text-[#f4f4f6]">{perm.name}</td>
                      <td className="py-3 leading-7 text-[#c4c4cc]">{perm.purpose}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section id="purpose" title="4. 이용 목적">
            <Bullets
              items={[
                "요청한 이미지의 AI 생성 여부 분석 결과 제공",
                "동일·유사 이미지 재요청 시 기존 분석 결과 재사용(불필요한 재분석 방지)",
                "서비스 오류 진단, 품질 개선, 분석 정확도 향상",
                "과도한 자동 요청 등 남용 방지 및 서비스 안정성 확보",
                "로그인한 이용자의 분석 이력 조회 기능 제공",
              ]}
            />
          </Section>

          <Section id="third-party" title="5. 제3자 처리 및 위탁">
            <p>
              분석은 외부 AI 모델 제공사의 API를 이용해 수행됩니다. 이에 따라 이용자가 분석을 요청한 이미지가 아래 사업자에게
              전송되며, 각 사의 정책에 따라 처리됩니다. 전송되는 것은 분석 대상 이미지뿐이며, 이용자의 계정 정보나 브라우징 정보는
              전송되지 않습니다.
            </p>
            <Bullets
              items={[
                <>
                  <strong className="font-semibold text-[#f4f4f6]">OpenAI, Google(Gemini), Anthropic(Claude)</strong> — 이미지의 AI
                  생성 여부 판별. 각 사는 API로 전달된 데이터를 기본적으로 모델 학습에 사용하지 않는다고 밝히고 있습니다.
                </>,
                <>
                  <strong className="font-semibold text-[#f4f4f6]">Supabase</strong> — 분석 기록 및 이미지 저장(데이터베이스·스토리지).
                </>,
                <>
                  <strong className="font-semibold text-[#f4f4f6]">Vercel</strong> — 웹 서비스 및 API 서버 호스팅.
                </>,
              ]}
            />
            <p>위 위탁은 서비스 제공에 필요한 범위로 한정되며, 그 외 제3자에게 정보를 제공하지 않습니다.</p>
          </Section>

          <Section id="no-sale" title="6. 데이터 판매·전송 제한">
            <p>서비스는 Chrome Web Store 개발자 프로그램 정책의 데이터 사용 요건을 준수하며, 다음을 명시적으로 확약합니다.</p>
            <Bullets
              items={[
                "이용자 데이터를 제3자에게 판매하지 않습니다.",
                "확장 프로그램의 단일 목적(이미지 AI 생성 여부 분석)과 무관한 용도로 이용자 데이터를 사용하거나 전송하지 않습니다.",
                "신용도 판단이나 대출 심사 등의 목적으로 이용자 데이터를 사용하거나 전송하지 않습니다.",
                "광고 목적의 데이터 수집, 추적, 프로파일링을 하지 않습니다.",
              ]}
            />
          </Section>

          <Section id="retention" title="7. 보관 기간 및 파기">
            <p>
              분석 대상 이미지와 분석 기록은 결과 재조회·중복 분석 방지·품질 개선 목적으로 서비스 운영 기간 동안 보관되며, 목적이
              종료되거나 이용자가 삭제를 요청한 경우 지체 없이 파기합니다. 회원 탈퇴 시 계정 정보는 즉시 삭제되고, 해당 계정과
              연결된 분석 기록의 계정 식별자는 함께 제거됩니다.
            </p>
          </Section>

          <Section id="rights" title="8. 이용자의 권리">
            <p>
              이용자는 언제든지 자신의 개인정보에 대한 열람, 정정, 삭제, 처리 정지를 요청할 수 있습니다. 아래 문의처로 연락하시면
              합리적인 기간 내에 처리합니다. 확장 프로그램을 삭제하면 브라우저에 저장된 확장 프로그램 설정값은 즉시 함께
              제거됩니다.
            </p>
          </Section>

          <Section id="security" title="9. 보안 조치">
            <p>
              모든 통신은 HTTPS로 암호화되며, 저장된 이미지는 비공개 저장소에 보관되어 권한이 확인된 요청에만 한시적 서명 URL로
              제공됩니다. 데이터베이스에는 행 수준 보안(Row Level Security)을 적용해 로그인한 이용자가 자신의 기록만 조회할 수 있도록
              제한하고 있으며, 서버 내부 오류 메시지는 이용자에게 노출되지 않습니다.
            </p>
          </Section>

          <Section id="children" title="10. 아동의 개인정보">
            <p>
              서비스는 만 14세 미만 아동을 대상으로 하지 않으며, 아동의 개인정보를 의도적으로 수집하지 않습니다. 관련 사실을 인지할
              경우 해당 정보를 즉시 삭제합니다.
            </p>
          </Section>

          <Section id="changes" title="11. 방침의 변경">
            <p>
              본 방침이 변경되는 경우 변경 내용과 시행일을 본 페이지에 게시합니다. 중대한 변경의 경우 확장 프로그램 또는 웹사이트를
              통해 별도로 안내합니다.
            </p>
          </Section>

          <Section id="contact" title="12. 문의처">
            <p>
              개인정보 처리에 관한 문의·열람·삭제 요청은 아래로 연락해 주시기 바랍니다.
              <br />
              이메일:{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-[#60a5fa] hover:underline">
                {CONTACT_EMAIL}
              </a>
            </p>
          </Section>
        </div>

        <div className="mt-12 border-t border-white/8 pt-6">
          {/* 일반 <a> 의도적 사용 — 홈 화면이 분석 결과를 보여주던 중이었어도
              항상 확실하게 초기 상태로 돌아가도록 풀 리로드 (AppHeader.tsx와 동일 이유) */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/" className="text-sm text-[#60a5fa] hover:underline">
            ← 홈으로 돌아가기
          </a>
        </div>
      </main>
    </div>
  );
}

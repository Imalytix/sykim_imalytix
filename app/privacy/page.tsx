import AppFooter from "@/components/layout/AppFooter";
import AppHeader from "@/components/layout/AppHeader";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-lg font-bold text-[#f4f4f6]">{title}</h2>
      <div className="mt-3 flex flex-col gap-3 text-sm leading-relaxed text-[#c4c4ca]">{children}</div>
    </section>
  );
}

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-white/9">
      <table className="w-full min-w-[560px] border-collapse text-left text-[13px]">
        <thead>
          <tr className="bg-white/[0.06]">
            {head.map((h) => (
              <th key={h} className="border-b border-white/9 px-4 py-2.5 font-semibold text-[#f4f4f6]">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-white/6 last:border-b-0">
              {row.map((cell, j) => (
                <td key={j} className="px-4 py-2.5 align-top text-[#c4c4ca]">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function PrivacyPage() {
  return (
    <div className="flex min-h-screen flex-col bg-black">
      <AppHeader />

      <main className="flex-1 px-6 py-16">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-3xl font-bold tracking-tight text-[#f4f4f6]">개인정보처리방침</h1>
          <p className="mt-3 text-sm text-[#9a9aa4]">
            시행일자: 2026년 8월 6일
            <br />
            Imalytix(이하 &ldquo;회사&rdquo;)는 「개인정보 보호법」 등 관련 법령을 준수하며, 이용자의 개인정보를 보호하기 위해 다음과 같이
            개인정보처리방침을 수립·공개합니다.
          </p>

          <div className="mt-6 rounded-xl border border-amber-400/25 bg-amber-400/10 px-4 py-3 text-[13px] leading-relaxed text-amber-200">
            이 문서는 서비스 운영자가 직접 작성한 초안입니다. 정식 배포(특히 Chrome 웹스토어 등록) 전에는 개인정보보호 전문 변호사의 검토를
            받으시길 권장합니다. 본 문서는 법률 자문을 대체하지 않습니다.
          </div>

          <Section title="제1조 (개인정보의 처리 목적)">
            <p>회사는 다음의 목적을 위하여 개인정보를 처리합니다. 처리한 개인정보는 다음의 목적 이외의 용도로는 사용되지 않습니다.</p>
            <ul className="list-disc pl-5">
              <li>업로드된 이미지의 AI 생성 여부·조작 여부 분석 및 판단 근거 제공 (서비스의 핵심 목적)</li>
              <li>회원 가입 의사 확인, 회원제 서비스(분석 이력 조회 등) 제공을 위한 본인 식별</li>
              <li>부정 이용 방지, 서비스 남용(과도한 요청 등) 차단 및 보안 사고 대응</li>
              <li>서비스 개선을 위한 이용 통계 분석</li>
              <li>이용자 피드백 접수 및 응대</li>
            </ul>
          </Section>

          <Section title="제2조 (처리하는 개인정보 항목)">
            <Table
              head={["구분", "수집 항목"]}
              rows={[
                ["필수 (서비스 이용 시)", "업로드 이미지 파일, 이미지에 포함된 촬영정보(EXIF: 카메라 기종, 촬영일시, 노출값 등 — GPS 좌표값 자체는 저장하지 않고 포함 여부만 기록), 이미지 해시값, 접속 IP, User-Agent, 요청 시각, Referer/Origin"],
                ["선택 (로그인 시)", "이메일 주소, 프로필 이름(Google 계정 제공 정보), 로그인 방식(Google), 분석 이력"],
                ["선택 (피드백 작성 시)", "피드백 메시지 내용, 작성 시 IP·User-Agent"],
                ["자동 생성 정보", "쿠키(로그인 세션 유지용), 분석 결과값(AI 생성 확률, 판정 근거)"],
              ]}
            />
            <p className="text-[13px] text-[#9a9aa4]">
              ⚠️ 업로드하시는 이미지에는 사람의 얼굴 등 개인을 식별할 수 있는 정보가 포함될 수 있습니다. 회사는 이미지 속 인물을 식별·특정하기
              위한 얼굴인식을 수행하지 않으며, 오직 이미지 자체가 AI로 생성·편집되었는지를 판별하는 기술적 포렌식 분석 목적으로만
              이용합니다.
            </p>
          </Section>

          <Section title="제3조 (개인정보의 처리 및 보유 기간)">
            <p>
              회사는 원칙적으로 개인정보 처리 목적이 달성된 후에는 해당 정보를 지체 없이 파기합니다. 다만 현재 서비스는 초기 운영 단계로,
              아래와 같이 처리합니다.
            </p>
            <ul className="list-disc pl-5">
              <li>회원 정보(이메일 등): 회원 탈퇴 시까지 보유하며, 탈퇴 요청 시 지체 없이 파기합니다.</li>
              <li>
                업로드 이미지 및 분석 기록: 서비스 제공(중복 분석 방지, 유사 이미지 비교 등)을 위해 <b>별도 자동 파기 절차 없이</b> 보관하고
                있습니다. 이용자가 imalytix@gmail.com으로 삭제를 요청하시면 지체 없이 삭제 조치합니다.
              </li>
              <li>피드백 메시지: 서비스 개선 목적 달성 시 또는 삭제 요청 시까지 보관합니다.</li>
              <li>접속 기록(IP 등): 통신비밀보호법 등 관계 법령에 특별한 규정이 있는 경우 해당 법령에서 정한 기간 동안 보관합니다.</li>
            </ul>
            <p className="text-[13px] text-[#9a9aa4]">
              ※ 회사는 자동 파기 절차 도입을 검토 중이며, 정책이 확정되는 대로 본 방침을 갱신합니다.
            </p>
          </Section>

          <Section title="제4조 (개인정보의 제3자 제공)">
            <p>회사는 이용자의 개인정보를 제1조에서 명시한 목적 범위 내에서만 처리하며, 원칙적으로 이용자의 동의 없이 제3자에게 제공하지 않습니다.</p>
          </Section>

          <Section title="제5조 (개인정보 처리업무의 위탁 및 국외 이전)">
            <p>
              회사는 이미지 분석을 위해 아래 해외 AI 서비스 제공업체에 업로드 이미지를 전송(처리위탁 및 국외이전)합니다. 각 업체는 자체
              개인정보처리방침에 따라 전송받은 데이터를 처리합니다.
            </p>
            <Table
              head={["수탁자", "이전 국가", "이전 항목", "이전 목적 및 방법"]}
              rows={[
                ["OpenAI, L.L.C. (GPT-4o)", "미국", "분석 대상 이미지", "AI 기반 이미지 생성 여부 분석 · API를 통한 실시간 전송, 별도 보관 위탁 없음"],
                ["Google LLC (Gemini API)", "미국", "분석 대상 이미지", "AI 기반 이미지 생성 여부 분석 · API를 통한 실시간 전송"],
                ["Anthropic, PBC (Claude API)", "미국", "분석 대상 이미지", "AI 기반 이미지 생성 여부 분석 · API를 통한 실시간 전송"],
                ["Supabase, Inc.", "미국 (인프라 제공사 기준)", "업로드 이미지, 계정정보, 분석 기록 전반", "데이터베이스·파일 저장·로그인 인증 등 서비스 인프라 운영 위탁"],
              ]}
            />
            <p className="text-[13px] text-[#9a9aa4]">
              위 업체들은 각자의 정책에 따라 전송받은 이미지를 자체 서버(주로 미국 소재)에서 처리하며, 회사가 별도로 요청하지 않는 한 자체
              모델 학습에 사용하지 않도록 API 이용 약관상의 옵트아웃 정책을 따르고 있습니다(각 업체 정책은 아래 링크에서 확인 가능합니다).
              국외 이전을 원하지 않으실 경우, 서비스의 핵심 기능인 AI 이미지 분석 자체를 이용하실 수 없습니다.
            </p>
            <ul className="list-disc pl-5 text-[13px]">
              <li>
                <a href="https://openai.com/policies/privacy-policy" target="_blank" rel="noopener noreferrer" className="text-[#52bdff] underline">
                  OpenAI 개인정보처리방침
                </a>
              </li>
              <li>
                <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" className="text-[#52bdff] underline">
                  Google 개인정보처리방침
                </a>
              </li>
              <li>
                <a href="https://www.anthropic.com/legal/privacy" target="_blank" rel="noopener noreferrer" className="text-[#52bdff] underline">
                  Anthropic 개인정보처리방침
                </a>
              </li>
              <li>
                <a href="https://supabase.com/privacy" target="_blank" rel="noopener noreferrer" className="text-[#52bdff] underline">
                  Supabase 개인정보처리방침
                </a>
              </li>
            </ul>
          </Section>

          <Section title="제6조 (개인정보의 자동화된 결정에 관한 사항)">
            <p>
              회사는 업로드된 이미지에 대해 AI 모델이 자동으로 &ldquo;AI 생성 가능성 점수&rdquo;와 판정 근거를 산출합니다. 이는 이용자의 판단을
              돕기 위한 참고 정보 제공 목적이며, 이용자의 법적 권리나 의무에 중대한 영향을 미치는 확정적·구속적 결정이 아닙니다. 이용자는
              결과 화면에서 판정에 사용된 근거(메타데이터, 모델별 판단 등)를 확인할 수 있으며, 자동화된 결과에 대한 설명을 요구하거나 이의를
              제기하고자 하는 경우 imalytix@gmail.com으로 문의하실 수 있습니다.
            </p>
          </Section>

          <Section title="제7조 (정보주체의 권리·의무 및 행사방법)">
            <p>이용자는 언제든지 아래와 같은 권리를 행사할 수 있습니다.</p>
            <ul className="list-disc pl-5">
              <li>개인정보 열람 요구</li>
              <li>오류 등이 있을 경우 정정 요구</li>
              <li>삭제 요구</li>
              <li>처리 정지 요구</li>
            </ul>
            <p>
              위 권리 행사는 imalytix@gmail.com으로 이메일을 보내주시면 지체 없이 조치하겠습니다. 이용자가 만 14세 미만 아동인 경우 법정대리인이
              권리를 대신 행사할 수 있습니다.
            </p>
          </Section>

          <Section title="제8조 (개인정보의 파기)">
            <p>
              회사는 개인정보 보유 기간이 경과하거나 처리 목적이 달성되어 개인정보가 불필요하게 되었을 때에는 지체 없이 해당 개인정보를
              파기합니다. 전자적 파일 형태의 정보는 복구할 수 없는 방법으로 영구 삭제합니다.
            </p>
          </Section>

          <Section title="제9조 (개인정보의 안전성 확보조치)">
            <ul className="list-disc pl-5">
              <li>전송 구간 암호화(HTTPS/TLS) 적용</li>
              <li>데이터베이스 접근 권한을 최소한의 인원으로 제한하고, 행 단위 접근제어(Row Level Security)를 적용하여 이용자가 본인 데이터만 조회 가능하도록 구성</li>
              <li>관리자 권한(서비스 운영 키)은 서버 환경에서만 사용하고 외부에 노출되지 않도록 관리</li>
              <li>이미지·URL 업로드 시 악성 파일 형식 차단, 내부망 접근 시도(SSRF) 차단 등 기술적 보안 조치 적용</li>
              <li>비정상적으로 과도한 요청을 자동 차단하는 속도 제한(Rate Limit) 적용</li>
            </ul>
          </Section>

          <Section title="제10조 (쿠키의 설치·운영 및 거부)">
            <p>
              회사는 로그인 상태 유지를 위해 세션 쿠키를 사용합니다. 이용자는 브라우저 설정을 통해 쿠키 저장을 거부할 수 있으나, 이 경우 로그인이
              필요한 일부 기능(분석 이력 저장 등)의 이용이 제한될 수 있습니다. 비로그인 상태의 이미지 분석 기능은 쿠키 거부와 무관하게 이용
              가능합니다.
            </p>
          </Section>

          <Section title="제11조 (Chrome 확장 프로그램 관련 안내)">
            <p>
              Imalytix Chrome 확장 프로그램은 &ldquo;웹페이지의 이미지를 우클릭하여 AI 생성 여부를 검증한다&rdquo;는 단일 목적으로만
              동작하며, 이 목적과 무관한 브라우징 기록·방문 이력·개인정보를 수집하지 않습니다. 사용자가 명시적으로 선택한 이미지의 URL만
              분석을 위해 회사 서버로 전송됩니다.
            </p>
          </Section>

          <Section title="제12조 (개인정보 보호책임자)">
            <p>회사는 개인정보 처리에 관한 업무를 총괄해서 책임지고, 개인정보 처리와 관련한 이용자의 불만 처리 및 피해 구제를 위하여 아래와 같이 개인정보 보호책임자를 지정하고 있습니다.</p>
            <ul className="list-disc pl-5">
              <li>개인정보 보호책임자 / 열람청구 접수 부서: Imalytix 운영팀</li>
              <li>연락처: imalytix@gmail.com</li>
            </ul>
            <p className="text-[13px] text-[#9a9aa4]">※ 정식 서비스 운영 전, 담당자 실명과 연락처로 교체를 권장합니다.</p>
          </Section>

          <Section title="제13조 (권익침해 구제방법)">
            <p>개인정보 침해에 대한 신고나 상담이 필요하신 경우 아래 기관에 문의하실 수 있습니다.</p>
            <ul className="list-disc pl-5">
              <li>개인정보분쟁조정위원회 (1833-6972, www.kopico.go.kr)</li>
              <li>개인정보침해신고센터 (국번없이 118, privacy.kisa.or.kr)</li>
              <li>대검찰청 사이버범죄수사단 (국번없이 1301, www.spo.go.kr)</li>
              <li>경찰청 사이버수사국 (국번없이 182, ecrm.cyber.go.kr)</li>
            </ul>
          </Section>

          <Section title="제14조 (개인정보처리방침의 변경)">
            <p>
              이 개인정보처리방침은 법령·정책 또는 서비스 변경에 따라 내용의 추가·삭제 및 수정이 있을 시에는 시행 최소 7일 전(중대한 변경의
              경우 30일 전)부터 웹사이트 공지사항을 통해 고지합니다.
            </p>
          </Section>
        </div>
      </main>

      <AppFooter />
    </div>
  );
}

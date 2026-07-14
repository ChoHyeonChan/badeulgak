// 복지로(한국사회보장정보원) 중앙부처복지서비스 API → data-extra.js 생성 스크립트
// 실행: DATA_GO_KR_KEY=발급받은키 node scripts/fetch-data.mjs
// GitHub Actions가 주 1회 자동 실행해 data-extra.js를 갱신·커밋합니다.
//
// API: https://www.data.go.kr/data/15090532/openapi.do (자동승인, 무료, 개발계정 100건/일)
// 공식 Swagger 확인 완료:
//   목록 GET /NationalWelfarelistV001  (serviceKey, callTp=L, pageNo, numOfRows≤500, srchKeyCode)
//   상세 GET /NationalWelfaredetailedV001 (serviceKey, callTp=D, servId)
//
// 전략: 목록은 매회 전체 갱신(1~2콜), 상세는 회당 DETAIL_BUDGET건씩 점진 수집.
//       이미 수집한 상세는 기존 data-extra.js에서 이어받아 누적한다(캐시).

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const KEY = process.env.DATA_GO_KR_KEY;
if (!KEY) {
  console.error("환경변수 DATA_GO_KR_KEY가 필요합니다. (공공데이터포털 일반 인증키)");
  process.exit(1);
}

const BASE = "https://apis.data.go.kr/B554287/NationalWelfareInformationsV001";
const ROWS = 500;          // 공식 최대치
const MAX_PAGES = 2;       // 최대 1,000건
const DETAIL_BUDGET = 80;  // 회당 상세조회 건수 (일 트래픽 100건 내 여유 확보)
const TRIM = 300;          // 상세 텍스트 필드 최대 길이 (파일 크기 관리)

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dir, "..", "data-extra.js");

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m
    ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
    : "";
}
const trim = (s) => (s.length > TRIM ? s.slice(0, TRIM).trimEnd() + "…" : s);

async function call(params) {
  const url = `${BASE}/${params.op}?serviceKey=${KEY}&` +
    Object.entries(params.q).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  const res = await fetch(url);
  const body = await res.text();
  if (!res.ok) {
    writeFileSync(join(__dir, "raw-sample.xml"), body);
    throw new Error(`HTTP ${res.status} (${params.op}) — scripts/raw-sample.xml 확인`);
  }
  return body;
}

// ── 1) 기존 상세 캐시 로드 ──────────────────────────────────────
let cache = new Map();
if (existsSync(OUT)) {
  const prev = readFileSync(OUT, "utf-8");
  const m = prev.match(/const EXTRA_PROGRAMS = (\[[\s\S]*\]);/);
  if (m) {
    try {
      for (const it of JSON.parse(m[1])) {
        if (it.id && (it.content || it.target_detail)) cache.set(it.id, it);
      }
    } catch { /* 캐시 파싱 실패 시 무시하고 새로 수집 */ }
  }
}
console.log(`기존 상세 캐시: ${cache.size}건`);

// ── 2) 목록 수집 ────────────────────────────────────────────────
const items = [];
for (let page = 1; page <= MAX_PAGES; page++) {
  const xml = await call({ op: "NationalWelfarelistV001", q: { callTp: "L", pageNo: page, numOfRows: ROWS, srchKeyCode: "001" } });
  const errMsg = tag(xml, "returnAuthMsg") || tag(xml, "errMsg");
  if (errMsg && !xml.includes("<servList>")) {
    writeFileSync(join(__dir, "raw-sample.xml"), xml);
    throw new Error(`API 오류: ${errMsg} — scripts/raw-sample.xml 확인`);
  }
  const blocks = xml.match(/<servList>[\s\S]*?<\/servList>/g) || [];
  for (const b of blocks) {
    items.push({
      id: tag(b, "servId"),
      name: tag(b, "servNm"),
      summary: tag(b, "servDgst"),
      agency: tag(b, "jurMnofNm") || tag(b, "jurOrgNm"),
      life: tag(b, "lifeArray"),           // 실제 응답 태그 확인됨 (예: "청년,중장년,노년")
      target: tag(b, "trgterIndvdlArray"),  // (예: "장애인,저소득")
      theme: tag(b, "intrsThemaArray"),     // (예: "생활지원,일자리,서민금융")
      apply: tag(b, "onapPsbltYn"),         // 온라인신청 가능여부(Y/N)
      link: tag(b, "servDtlLink"),
    });
  }
  console.log(`목록 ${page}페이지: ${blocks.length}건`);
  if (blocks.length < ROWS) break;
}

const cleaned = items.filter((it) => it.id && it.name && it.summary);
if (cleaned.length === 0) {
  throw new Error("파싱된 항목이 0건 — scripts/raw-sample.xml에서 실제 태그명을 확인하세요.");
}

// ── 3) 상세 점진 수집 (지원대상·지원내용 원문 인용) ─────────────
let fetched = 0;
let detailSampleSaved = false;
for (const it of cleaned) {
  const hit = cache.get(it.id);
  if (hit) {
    it.target_detail = hit.target_detail || "";
    it.content = hit.content || "";
    continue;
  }
  if (fetched >= DETAIL_BUDGET) continue;
  try {
    const xml = await call({ op: "NationalWelfaredetailedV001", q: { callTp: "D", servId: it.id } });
    if (!detailSampleSaved) {
      writeFileSync(join(__dir, "raw-detail-sample.xml"), xml);
      detailSampleSaved = true;
    }
    it.target_detail = trim(tag(xml, "tgtrDtlCn"));   // 지원대상
    it.content = trim(tag(xml, "alwServCn"));          // 지원내용(금액 등)
    it.criteria = trim(tag(xml, "slctCritCn"));        // 선정기준
    fetched++;
  } catch (e) {
    console.warn(`상세 실패(${it.id}): ${e.message}`);
    break; // 트래픽 초과 등 — 다음 주기에 이어서
  }
}
console.log(`상세 신규 수집: ${fetched}건 (누적 ${cleaned.filter((i) => i.content).length}건)`);

// ── 4) 출력 ─────────────────────────────────────────────────────
const banner =
  `// 자동 생성 파일 — 직접 수정 금지 (scripts/fetch-data.mjs가 갱신)\n` +
  `// 출처: 복지로 중앙부처복지서비스 (한국사회보장정보원, data.go.kr) — 원문 인용\n` +
  `// 갱신: ${new Date().toISOString().slice(0, 10)} / 목록 ${cleaned.length}건, 상세 ${cleaned.filter((i) => i.content).length}건\n`;
writeFileSync(OUT, banner + "const EXTRA_PROGRAMS = " + JSON.stringify(cleaned, null, 1) + ";\n");
console.log(`data-extra.js 갱신 완료: ${cleaned.length}건`);

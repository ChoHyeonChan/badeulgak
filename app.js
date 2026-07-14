// 받을각 - 매칭 엔진 & UI 로직
(function () {
  "use strict";

  const state = { age: null, status: null, housing: null, income: null, child: null, freeText: "" };
  let currentStep = 1;
  const LAST_STEP = 6; // 6단계(자유 고민)가 마지막. 5단계(자녀)는 해당 없으면 자동으로 건너뛴다.

  const screens = {
    intro: document.getElementById("screen-intro"),
    form: document.getElementById("screen-form"),
    loading: document.getElementById("screen-loading"),
    result: document.getElementById("screen-result"),
  };

  function showScreen(name) {
    Object.values(screens).forEach((s) => s.removeAttribute("data-active"));
    screens[name].setAttribute("data-active", "true");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // 해당 나이대에 물어볼 필요가 없는 문항은 건너뛴다 (예: 10대·어르신에게 자녀 유무)
  function shouldSkip(stepEl) {
    const skipAges = (stepEl.dataset.skipWhenAge || "").split(",").filter(Boolean);
    return skipAges.includes(state.age);
  }

  function stepEl(n) {
    return document.querySelector(`.q-block[data-step="${n}"]`);
  }

  // dir: +1(다음) / -1(이전) — 건너뛸 문항을 지나 실제로 보여줄 단계를 찾는다
  function resolveStep(n, dir) {
    let target = n;
    while (target > 1 && target < LAST_STEP && shouldSkip(stepEl(target))) {
      target += dir;
    }
    return target;
  }

  function goToStep(n) {
    currentStep = n;
    document.querySelectorAll(".q-block").forEach((el) => {
      el.classList.toggle("active", Number(el.dataset.step) === n);
    });
    // 건너뛰는 문항이 있으면 전체 개수도 줄여서 표시한다 (예: 5문항 / 6문항)
    const total = Array.from(document.querySelectorAll(".q-block"))
      .filter((el) => !shouldSkip(el)).length;
    const shownIndex = Array.from(document.querySelectorAll(".q-block"))
      .filter((el) => !shouldSkip(el))
      .findIndex((el) => Number(el.dataset.step) === n) + 1;
    document.getElementById("step-label").textContent = `${shownIndex} / ${total}`;
    document.getElementById("progress-fill").style.width = `${(shownIndex / total) * 100}%`;
    document.getElementById("btn-back").disabled = n === 1;
  }

  document.getElementById("btn-start").addEventListener("click", () => {
    showScreen("form");
    goToStep(1);
  });

  document.getElementById("btn-back").addEventListener("click", () => {
    if (currentStep > 1) goToStep(resolveStep(currentStep - 1, -1));
  });

  // 선택형 문항: 카드 클릭 시 값 저장 후 자동으로 다음 단계로
  document.querySelectorAll(".choice-grid").forEach((grid) => {
    const field = grid.dataset.field;
    grid.addEventListener("click", (e) => {
      const card = e.target.closest(".choice-card");
      if (!card) return;
      grid.querySelectorAll(".choice-card").forEach((c) => c.classList.remove("selected"));
      card.classList.add("selected");
      state[field] = card.dataset.value;
      setTimeout(() => {
        if (currentStep < LAST_STEP) goToStep(resolveStep(currentStep + 1, +1));
      }, 220);
    });
  });

  document.getElementById("btn-submit").addEventListener("click", () => {
    state.freeText = document.getElementById("free-text").value.trim();
    runMatching();
  });

  document.getElementById("btn-restart").addEventListener("click", () => {
    state.age = state.status = state.housing = state.income = state.child = null;
    state.freeText = "";
    document.getElementById("free-text").value = "";
    document.querySelectorAll(".choice-card").forEach((c) => c.classList.remove("selected"));
    showScreen("form");
    goToStep(1);
  });

  // ===== 매칭 로직 =====
  function scoreProgram(p) {
    let score = 0;
    const reasons = [];

    // 자녀가 있어야만 신청 가능한 제도(자녀장려금 등)는 자녀가 없으면 후보에서 제외한다.
    // 자녀 문항을 건너뛴 경우(10대·어르신)에도 추천하지 않는다.
    if (p.requiresChild && state.child !== "yes") {
      return { program: p, score: -100, reasons: [], hitKeywords: [] };
    }

    // 자격 조건이 명시된 제도에서 조건 미충족은 강하게 감점해
    // "지금 조건이 맞는 제도"라는 약속을 지킨다.
    if (p.ages.includes(state.age)) {
      score += 3;
      reasons.push("age");
    } else {
      score -= 5;
    }
    if (p.statuses.length === 0) {
      score += 1;
    } else if (p.statuses.includes(state.status)) {
      score += 3;
      reasons.push("status");
    } else {
      score -= 4;
    }

    if (p.housing.length === 0) {
      score += 1;
    } else if (p.housing.includes(state.housing)) {
      score += 2;
      reasons.push("housing");
    } else {
      score -= 10; // 주거 요건(예: 월세 거주)이 필수인 제도는 미충족 시 제외
    }

    if (p.incomes.length === 0) {
      score += 1;
    } else if (p.incomes.includes(state.income)) {
      score += 2;
      reasons.push("income");
    } else if (state.income === "unknown") {
      score += 1; // 소득을 모르면 가능성을 열어두고 보여준다
    } else {
      score -= 5;
    }

    const hitKeywords = [];
    if (state.freeText) {
      const text = state.freeText.toLowerCase();
      p.keywords.forEach((kw) => {
        if (text.includes(kw.toLowerCase())) hitKeywords.push(kw);
      });
      score += hitKeywords.length * 4;
      if (hitKeywords.length > 0) reasons.push("keyword");
    }

    return { program: p, score, reasons, hitKeywords };
  }

  const AGE_LABEL = {
    "10s": "10대", "20s": "20대", "30s_early": "30대 초반(~34세)",
    "30s_late": "30대 후반(35~39세)", "40_50s": "40~50대", senior: "60대 이상",
  };
  const STATUS_LABEL = {
    schooler: "초·중·고 학생", student: "대학(원)생", jobseeker: "취업준비생", worker: "직장인",
    freelancer: "프리랜서·자영업", unemployed: "구직 비활동", senior_life: "어르신",
  };
  const HOUSING_LABEL = { alone_rent: "자취(월세/전세)", alone_own: "자취(자가)", with_family: "가족과 거주", dorm: "기숙사·고시원" };
  const INCOME_LABEL = {
    low: "기초수급·차상위", mid_low: "중위소득 100% 이하",
    mid: "중위소득 100~150%", unknown: "소득 미확인",
  };

  function buildReasonText(r) {
    const parts = [];
    if (r.reasons.includes("age") || r.reasons.includes("status")) {
      const ageTxt = AGE_LABEL[state.age] || "";
      const statusTxt = STATUS_LABEL[state.status] || "";
      parts.push(`${ageTxt} ${statusTxt}`.trim() + "에게 해당하는 제도예요");
    }
    if (r.reasons.includes("housing")) {
      parts.push(`${HOUSING_LABEL[state.housing]} 조건과 맞아요`);
    }
    if (r.reasons.includes("keyword")) {
      parts.push(`"${r.hitKeywords.slice(0, 2).join(", ")}" 라고 적어주신 내용과 관련 있어요`);
    }
    if (parts.length === 0) parts.push("폭넓은 대상에게 열려 있는 제도예요");
    return parts.join(" · ");
  }

  function runMatching() {
    showScreen("loading");
    const loadingMsgs = [
      "입력하신 상황을 분석하고 있어요…",
      "전국 지원제도 데이터와 대조하는 중…",
      "가장 잘 맞는 혜택을 정렬하는 중…",
    ];
    let i = 0;
    const loadingText = document.getElementById("loading-text");
    const interval = setInterval(() => {
      i = (i + 1) % loadingMsgs.length;
      loadingText.textContent = loadingMsgs[i];
    }, 550);

    setTimeout(() => {
      clearInterval(interval);
      // 자격이 맞는 제도만 보여준다. 개수를 채우려고 자격 미달 제도를 끼워 넣지 않는다 —
      // "지금 신청 가능한 혜택"이라고 말해놓고 못 받는 걸 보여주면 서비스의 신뢰가 깨진다.
      const scored = PROGRAMS.map(scoreProgram).sort((a, b) => b.score - a.score);
      const results = scored.filter((r) => r.score > 2).slice(0, 8);
      renderResults(results);
      showScreen("result");
      tryUpgradeSummaryWithLLM(results);
    }, 1700);
  }

  // [확장 훅] Netlify 배포 + GEMINI_API_KEY 등록 시에만 동작.
  // 실패하면 조용히 무시하고 내장 요약을 유지한다 (개인정보는 이 경우에도 프로필 요약값만 전송).
  function tryUpgradeSummaryWithLLM(results) {
    if (!location.hostname.endsWith("netlify.app")) return;
    const profile = {
      age: AGE_LABEL[state.age], status: STATUS_LABEL[state.status],
      housing: HOUSING_LABEL[state.housing], income: INCOME_LABEL[state.income],
      concern: state.freeText,
    };
    const programs = results.map((r) => ({ name: r.program.name, tagline: r.program.tagline }));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    fetch("/.netlify/functions/ai-summary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile, programs }),
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => {
        if (data.summary) {
          document.getElementById("result-persona").textContent = data.summary;
          document.querySelector(".persona-badge").textContent = "AI 상담사 요약";
        }
      })
      .catch(() => { /* 내장 요약 유지 */ })
      .finally(() => clearTimeout(timer));
  }

  // 결과 상단 개인화 요약: 입력값을 근거로 브라우저 안에서 문장을 조립한다 (외부 전송 없음)
  function buildPersonaSummary(results) {
    const profile = [AGE_LABEL[state.age], STATUS_LABEL[state.status], HOUSING_LABEL[state.housing]]
      .filter(Boolean).join(" · ");
    const income = INCOME_LABEL[state.income] || "";
    const child = state.child === "yes" ? " · 부양 자녀 있음" : "";

    if (!results.length) {
      return `${profile}${income ? ` (${income})` : ""}${child} 상황으로 19개 제도의 자격 요건을 대조했어요. ` +
        `조건이 어긋나는 제도를 억지로 추천하지 않기 위해, 지금은 딱 맞는 항목을 비워 두었어요.`;
    }

    const allHits = [...new Set(results.flatMap((r) => r.hitKeywords))];
    const concern = allHits.length
      ? `적어주신 고민 중 "${allHits.slice(0, 3).join(", ")}"에 초점을 맞춰, `
      : "";

    const agencies = [...new Set(results.map((r) => r.program.agency))];
    return `${profile}${income ? ` (${income})` : ""}${child} 상황을 분석했어요. ${concern}` +
      `${agencies.slice(0, 3).join("·")} 등 ${agencies.length}개 기관의 제도 중에서 ` +
      `지금 조건이 맞는 ${results.length}개를 골랐어요. 위에서부터 매칭 점수가 높은 순서예요.`;
  }

  let lastResults = []; // 복사·인쇄용으로 마지막 결과를 보관 (브라우저 메모리에만 존재)

  function renderResults(results) {
    lastResults = results;
    document.getElementById("result-count").textContent = results.length;
    document.getElementById("result-persona").textContent = buildPersonaSummary(results);
    document.getElementById("empty-state").hidden = results.length > 0;
    renderExtras();
    const list = document.getElementById("result-list");
    list.innerHTML = "";

    results.forEach((r, idx) => {
      const p = r.program;
      const card = document.createElement("article");
      card.className = "result-card";
      card.style.animationDelay = `${idx * 60}ms`;
      card.innerHTML = `
        <div class="result-card-top">
          <span class="agency-badge">${escapeHtml(p.agency)}</span>
          <span class="match-badge">${escapeHtml(buildReasonText(r))}</span>
        </div>
        <h3 class="result-card-title">${escapeHtml(p.name)}</h3>
        <p class="result-card-tagline">${escapeHtml(p.tagline)}</p>
        <span class="benefit-badge">${escapeHtml(p.benefit)}</span>
        <p class="result-card-summary">${escapeHtml(p.summary)}</p>
        <div class="result-card-footer">
          <div class="howto"><strong>신청 방법</strong><span>${escapeHtml(p.howTo)}</span></div>
          <a class="source-link" href="${safeHref(p.sourceUrl)}" target="_blank" rel="noopener noreferrer">
            ${escapeHtml(p.sourceName)}에서 확인하기 ↗
          </a>
        </div>
      `;
      list.appendChild(card);
    });
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // href="..." 처럼 속성값 컨텍스트에 넣을 때는 escapeHtml만으로는 부족하다
  // (따옴표를 이스케이프하지 않아 속성 탈출이 가능함). 여기서 추가로 따옴표를 인코딩하고,
  // http(s)가 아닌 스킴(javascript: 등)은 통째로 차단한다.
  // data-extra.js는 사람 검토 없이 매주 외부 API로 자동 갱신되는 데이터라 특히 중요하다.
  function safeHref(url) {
    if (!/^https:\/\//i.test(url || "")) return "#";
    return escapeHtml(url).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  // ===== 공공데이터 추가 제도 (data-extra.js — GitHub Actions가 주 1회 자동 갱신) =====
  // 자동 수집분은 요약·링크만 신뢰하고, 금액 등 세부 표기는 하지 않는다.
  const LIFE_BY_AGE = {
    "10s": ["청소년", "아동"], "20s": ["청년"],
    "30s_early": ["청년", "중장년"], "30s_late": ["청년", "중장년"],
    "40_50s": ["중장년"], senior: ["노년"],
  };

  function renderExtras() {
    const wrap = document.getElementById("extra-wrap");
    if (typeof EXTRA_PROGRAMS === "undefined" || !EXTRA_PROGRAMS.length) {
      wrap.hidden = true;
      return;
    }
    const curatedNames = PROGRAMS.map((p) => p.name.replace(/\s/g, ""));
    const lifeWants = LIFE_BY_AGE[state.age] || [];
    const tokens = state.freeText
      ? state.freeText.split(/[\s,.!?~에가이은는을를도의로]+/).filter((t) => t.length >= 2)
      : [];

    const picked = EXTRA_PROGRAMS.map((x) => {
      let s = 0;
      // 생애주기가 5개 이상(사실상 전 연령 대상)이면 "나이 맞춤" 신호로 보지 않는다 —
      // 그런 제도는 나이와 무관한 사유(사고 피해, 재난 등)로 열려 있는 경우가 대부분이라
      // 매칭 근거로 삼으면 엉뚱한 추천이 된다.
      const stages = x.life ? x.life.split(",").map((v) => v.trim()).filter(Boolean) : [];
      if (stages.length > 0 && stages.length < 5) {
        s += lifeWants.some((w) => stages.includes(w)) ? 3 : -6;
      }
      if (x.target && x.target.includes("저소득")) {
        if (state.income === "low" || state.income === "mid_low") s += 2;
        else if (state.income !== "unknown") s -= 4;
      }
      const hay = (x.name + " " + x.summary + " " + (x.theme || "") + " " + (x.content || "")).toLowerCase();
      tokens.forEach((t) => { if (hay.includes(t.toLowerCase())) s += 2; });
      return { x, s };
    })
      .filter((r) => r.s >= 5) // 소득 조건 단독 일치(+2)만으로는 노출하지 않는다
      .filter((r) => {
        const n = r.x.name.replace(/\s/g, "");
        return !curatedNames.some((c) => c.includes(n) || n.includes(c));
      })
      .sort((a, b) => b.s - a.s)
      .slice(0, 6);

    if (!picked.length) {
      wrap.hidden = true;
      return;
    }
    const list = document.getElementById("extra-list");
    list.innerHTML = "";
    picked.forEach(({ x }) => {
      const item = document.createElement("article");
      item.className = "extra-item";
      item.innerHTML = `
        <div class="browse-item-head">
          <strong>${escapeHtml(x.name)}</strong>
          <span class="agency-badge">${escapeHtml(x.agency || "중앙부처")}</span>
        </div>
        <p>${escapeHtml(x.summary)}</p>
        ${x.content ? `<p class="extra-detail"><strong>지원내용</strong> ${escapeHtml(x.content)}</p>` : ""}
        ${x.target_detail ? `<p class="extra-detail"><strong>지원대상</strong> ${escapeHtml(x.target_detail)}</p>` : ""}
        ${x.criteria ? `<p class="extra-detail"><strong>선정기준</strong> ${escapeHtml(x.criteria)}</p>` : ""}
        ${x.link ? `<a class="source-link" href="${safeHref(x.link)}" target="_blank" rel="noopener noreferrer">복지로에서 자세히 보기</a>` : ""}
      `;
      list.appendChild(item);
    });
    wrap.hidden = false;
  }

  // ===== 결과 복사 (가족·친구 대신 진단해주고 공유하는 용도) =====
  document.getElementById("btn-copy").addEventListener("click", () => {
    // 공유 링크에는 선택 답변만 담고, 자유 고민 텍스트는 넣지 않는다 (프라이버시)
    const shareURL = `${location.origin}${location.pathname}` +
      `?age=${state.age}&status=${state.status}&housing=${state.housing}&income=${state.income}` +
      (state.child ? `&child=${state.child}` : "");
    const lines = [
      "[받을각] 맞춤 지원제도 진단 결과",
      document.getElementById("result-persona").textContent,
      "",
      ...lastResults.map((r, i) => {
        const p = r.program;
        return `${i + 1}. ${p.name} (${p.agency})\n   혜택: ${p.benefit}\n   신청: ${p.howTo}\n   확인: ${p.sourceUrl}`;
      }),
      "",
      `같은 조건으로 직접 진단해보기: ${shareURL}`,
      "※ 세부 자격과 모집 여부는 공식 신청처에서 꼭 확인하세요.",
    ].join("\n");
    const btn = document.getElementById("btn-copy");
    const orig = btn.textContent;
    navigator.clipboard.writeText(lines)
      .then(() => { btn.textContent = "복사 완료"; })
      .catch(() => { btn.textContent = "복사 실패 — 브라우저 권한을 확인해주세요"; })
      .finally(() => setTimeout(() => (btn.textContent = orig), 1800));
  });

  // ===== 결과 인쇄 (어르신께 종이로 뽑아드리기) =====
  document.getElementById("btn-print").addEventListener("click", () => window.print());

  // ===== 큰 글씨 모드 =====
  document.getElementById("btn-fontsize").addEventListener("click", () => {
    const on = document.documentElement.classList.toggle("large-text");
    document.getElementById("btn-fontsize").setAttribute("aria-pressed", on);
  });

  // ===== 공유 링크로 진입 시 진단 조건 복원 =====
  // (가족·친구가 보내준 링크 — 선택 답변만 담기며 고민 텍스트는 포함되지 않음)
  function restoreFromURL() {
    const q = new URLSearchParams(location.search);
    const vals = {
      age: q.get("age"), status: q.get("status"),
      housing: q.get("housing"), income: q.get("income"),
    };
    const valid = AGE_LABEL[vals.age] && STATUS_LABEL[vals.status] &&
      HOUSING_LABEL[vals.housing] && INCOME_LABEL[vals.income];
    if (!valid) return;
    Object.assign(state, vals);
    const child = q.get("child");
    if (child === "yes" || child === "no") state.child = child;
    ["age", "status", "housing", "income", "child"].forEach((field) => {
      const grid = document.querySelector(`.choice-grid[data-field="${field}"]`);
      const card = grid && grid.querySelector(`.choice-card[data-value="${state[field]}"]`);
      if (card) card.classList.add("selected");
    });
    runMatching();
  }
  restoreFromURL();

  // ===== 전체 제도 둘러보기 =====
  const browseList = document.getElementById("browse-list");
  PROGRAMS.forEach((p) => {
    const item = document.createElement("div");
    item.className = "browse-item";
    item.innerHTML = `
      <div class="browse-item-head">
        <strong>${escapeHtml(p.name)}</strong>
        <span class="agency-badge">${escapeHtml(p.agency)}</span>
      </div>
      <p>${escapeHtml(p.tagline)} · <span class="benefit-badge">${escapeHtml(p.benefit)}</span></p>
    `;
    browseList.appendChild(item);
  });
})();

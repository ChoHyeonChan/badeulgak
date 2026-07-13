// 받을각 - 매칭 엔진 & UI 로직
(function () {
  "use strict";

  const state = { age: null, status: null, housing: null, income: null, freeText: "" };
  let currentStep = 1;
  const TOTAL_STEPS = 5;

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

  function goToStep(n) {
    currentStep = n;
    document.querySelectorAll(".q-block").forEach((el) => {
      el.classList.toggle("active", Number(el.dataset.step) === n);
    });
    document.getElementById("step-label").textContent = `${n} / ${TOTAL_STEPS}`;
    document.getElementById("progress-fill").style.width = `${(n / TOTAL_STEPS) * 100}%`;
    document.getElementById("btn-back").disabled = n === 1;
  }

  document.getElementById("btn-start").addEventListener("click", () => {
    showScreen("form");
    goToStep(1);
  });

  document.getElementById("btn-back").addEventListener("click", () => {
    if (currentStep > 1) goToStep(currentStep - 1);
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
        if (currentStep < TOTAL_STEPS) goToStep(currentStep + 1);
      }, 220);
    });
  });

  document.getElementById("btn-submit").addEventListener("click", () => {
    state.freeText = document.getElementById("free-text").value.trim();
    runMatching();
  });

  document.getElementById("btn-restart").addEventListener("click", () => {
    state.age = state.status = state.housing = state.income = null;
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

  const AGE_LABEL = { "10s": "10대", "20s": "20대", "30s": "30대", "40s": "40대", senior: "60대 이상" };
  const STATUS_LABEL = {
    student: "대학(원)생", jobseeker: "취업준비생", worker: "직장인",
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
      const scored = PROGRAMS.map(scoreProgram).sort((a, b) => b.score - a.score);
      let results = scored.filter((r) => r.score > 2);
      if (results.length < 3) results = scored.slice(0, 4);
      results = results.slice(0, 8);
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

    const allHits = [...new Set(results.flatMap((r) => r.hitKeywords))];
    const concern = allHits.length
      ? `적어주신 고민 중 "${allHits.slice(0, 3).join(", ")}"에 초점을 맞춰, `
      : "";

    const agencies = [...new Set(results.map((r) => r.program.agency))];
    return `${profile}${income ? ` (${income})` : ""} 상황을 분석했어요. ${concern}` +
      `${agencies.slice(0, 3).join("·")} 등 ${agencies.length}개 기관의 제도 중에서 ` +
      `지금 조건이 맞는 ${results.length}개를 골랐어요. 위에서부터 매칭 점수가 높은 순서예요.`;
  }

  function renderResults(results) {
    document.getElementById("result-count").textContent = results.length;
    document.getElementById("result-persona").textContent = buildPersonaSummary(results);
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
          <span class="match-badge">매칭 이유: ${escapeHtml(buildReasonText(r))}</span>
        </div>
        <h3 class="result-card-title">${escapeHtml(p.name)}</h3>
        <p class="result-card-tagline">${escapeHtml(p.tagline)}</p>
        <p class="result-card-summary">${escapeHtml(p.summary)}</p>
        <div class="result-card-footer">
          <div class="howto"><strong>신청 방법</strong><span>${escapeHtml(p.howTo)}</span></div>
          <a class="source-link" href="${p.sourceUrl}" target="_blank" rel="noopener noreferrer">
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
})();

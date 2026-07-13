// [확장 훅] Gemini 개인화 요약 서버리스 함수
// Netlify에 배포하고 환경변수 GEMINI_API_KEY를 등록하면 활성화됩니다.
// 키가 없거나 호출이 실패하면 앱은 브라우저 내장 분석 요약으로 자동 폴백하므로
// 이 함수가 없어도 서비스는 100% 동작합니다. (API 키는 서버에만 존재 — 클라이언트 노출 없음)

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "not_configured" }, { status: 503 });
  }

  const { profile, programs } = await req.json();

  const prompt = [
    "너는 복지 정보를 아주 쉬운 말로 설명해주는 상담사야.",
    "아래 사용자의 상황과 매칭된 지원제도 목록을 보고,",
    "친구에게 말하듯 따뜻하고 쉬운 한국어 3~4문장으로 요약해줘.",
    "과장 없이, 어떤 제도부터 확인하면 좋을지 우선순위를 짚어줘.",
    `사용자 상황: ${JSON.stringify(profile)}`,
    `매칭된 제도: ${JSON.stringify(programs)}`,
  ].join("\n");

  const res = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    }
  );
  if (!res.ok) {
    return Response.json({ error: "upstream_error" }, { status: 502 });
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  return Response.json({ summary: text });
};

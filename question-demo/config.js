// 공개 가능한 설정만 둡니다. ANTHROPIC_API_KEY는 절대 여기에 넣지 마세요.
window.QUESTION_DEMO_CONFIG = {
  // 예: "https://abcdefgh.supabase.co/functions/v1"
  apiBaseUrl: "",
  analyzeFunction: "analyze-question",
  trackFunction: "track-event",
  healthFunction: "health",
  // verify_jwt=false 배포에서는 비워도 됩니다. 필요 시 Supabase publishable/anon key만 입력합니다.
  supabasePublishableKey: "",
  // API 연결 전 화면 흐름을 바로 시험할 수 있는 모드입니다.
  demoMode: true,
  requestTimeoutMs: 10000
};

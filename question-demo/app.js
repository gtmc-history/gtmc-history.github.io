const CONFIG = window.QUESTION_DEMO_CONFIG || {};
const STORAGE_KEY = "questionGrowing3min:v1";
const STEPS = ["START", "MATERIAL", "INITIAL", "FEEDBACK", "REVISION", "COMPARISON", "RESOURCES"];
const RULE_ENGINE_ID = "PROVISIONAL_RULE_ENGINE";

let content;
let activeRequest = null;
let delayedLoadingTimer = null;

const sourceFromUrl = () => new URLSearchParams(location.search).get("source")?.trim() || "direct";
const defaultState = ({ source = sourceFromUrl(), contentId = "", contentVersion = "" } = {}) => ({
  sessionId: crypto.randomUUID(),
  source,
  contentId,
  contentVersion,
  currentStep: "START",
  originalQuestion: "",
  firstFeedback: null,
  revisedQuestion: "",
  comparison: null
});

let state = loadState();

const $ = (id) => document.getElementById(id);
const screens = [...document.querySelectorAll(".screen")];

init().catch((error) => {
  console.error("초기화 실패", error);
  alert("체험 화면을 불러오지 못했습니다. 페이지를 새로고침해 주세요.");
});

async function init() {
  content = await fetch("./content.json", { cache: "no-store" }).then((r) => {
    if (!r.ok) throw new Error("CONTENT_LOAD_FAILED");
    return r.json();
  });
  const contentIdentity = getContentIdentity(content);
  if (!matchesContentIdentity(state, contentIdentity)) {
    discardStoredState();
    state = defaultState({ source: sourceFromUrl(), ...contentIdentity });
  } else {
    state = { ...state, source: sourceFromUrl(), ...contentIdentity };
  }
  saveState();

  $("materialText").textContent = content.material;
  $("materialPrompt").textContent = content.prompt;
  $("sourceBadge").textContent = content.sourceLabels?.[state.source] || "공개 체험";
  renderResources();
  bindEvents();
  restoreFields();
  renderStep(state.currentStep);
}

function bindEvents() {
  $("startButton").addEventListener("click", () => {
    state = { ...defaultState({ source: state.source, ...getContentIdentity(content) }), currentStep: "MATERIAL" };
    saveState();
    trackEvent("demo_started");
    renderStep("MATERIAL");
  });

  $("materialNext").addEventListener("click", () => {
    trackEvent("material_viewed");
    goTo("INITIAL");
    setTimeout(() => $("initialQuestion").focus(), 50);
  });

  $("initialQuestion").addEventListener("input", () => {
    state.originalQuestion = $("initialQuestion").value;
    saveState();
    updateQuestionField("initial");
  });

  $("revisedQuestion").addEventListener("input", () => {
    state.revisedQuestion = $("revisedQuestion").value;
    saveState();
    updateQuestionField("revision");
  });

  $("analyzeInitial").addEventListener("click", submitInitial);
  $("goRevision").addEventListener("click", () => {
    $("originalQuestionView").textContent = state.originalQuestion;
    goTo("REVISION");
    setTimeout(() => $("revisedQuestion").focus(), 50);
  });
  $("analyzeRevision").addEventListener("click", submitRevision);
  $("goResources").addEventListener("click", () => {
    trackEvent("completed");
    goTo("RESOURCES");
  });
  $("restartButton").addEventListener("click", restartDemo);

  $("privacyOpen").addEventListener("click", () => $("privacyDialog").showModal());
  $("privacyClose").addEventListener("click", () => $("privacyDialog").close());
  $("privacyDialog").addEventListener("click", (event) => {
    if (event.target === $("privacyDialog")) $("privacyDialog").close();
  });
}

function restoreFields() {
  $("initialQuestion").value = state.originalQuestion || "";
  $("revisedQuestion").value = state.revisedQuestion || "";
  updateQuestionField("initial");
  updateQuestionField("revision");
  if (state.firstFeedback) renderFeedback(state.firstFeedback);
  if (state.comparison) renderComparison(state.comparison);
}

function renderStep(step) {
  if (!STEPS.includes(step)) step = "START";
  state.currentStep = step;
  saveState();
  screens.forEach((screen) => { screen.hidden = screen.dataset.step !== step; });
  const index = STEPS.indexOf(step);
  $("progressBar").style.width = `${Math.max(0, (index / (STEPS.length - 1)) * 100)}%`;
  document.querySelector("main").focus?.();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function goTo(step) { renderStep(step); }

function updateQuestionField(kind) {
  const isInitial = kind === "initial";
  const textarea = $(isInitial ? "initialQuestion" : "revisedQuestion");
  const count = $(isInitial ? "initialCount" : "revisionCount");
  const error = $(isInitial ? "initialError" : "revisionError");
  const button = $(isInitial ? "analyzeInitial" : "analyzeRevision");
  const value = textarea.value.trim();
  count.textContent = `${textarea.value.length} / 150`;
  const result = validateQuestion(value, isInitial ? null : state.originalQuestion);
  error.textContent = value && !result.ok ? result.message : "";
  button.disabled = Boolean(activeRequest) || !result.ok;
}

function validateQuestion(question, originalQuestion = null) {
  if (question.length < 10) return { ok: false, message: "10자 이상 작성해 주세요." };
  if (question.length > 150) return { ok: false, message: "150자 이내로 작성해 주세요." };
  if (!/[가-힣A-Za-z0-9]/.test(question)) return { ok: false, message: "질문 문장을 작성해 주세요." };
  if (containsPersonalInfo(question)) return { ok: false, message: "이메일·전화번호 등 개인정보를 삭제해 주세요." };
  if (originalQuestion && normalized(question) === normalized(originalQuestion)) return { ok: false, message: "처음 질문과 다른 내용을 3자 이상 반영해 주세요." };
  if (originalQuestion && editDistance(normalized(question), normalized(originalQuestion)) < 3) return { ok: false, message: "처음 질문에서 3자 이상 바꿔 주세요." };

  const related = content?.keywords?.some((keyword) => question.includes(keyword));
  const historicalQuestion = /(왜|어떻게|무엇|어떤|누가|언제|영향|원인|결과|차이|비교|의미|관계|근거|관점|만약|얼마나)/.test(question);
  if (!related && !historicalQuestion) return { ok: false, message: "자료와 연결된 역사 질문으로 작성해 주세요." };
  return { ok: true, message: "" };
}

function containsPersonalInfo(value) {
  const email = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
  const phone = /(?:01[016789])[-.\s]?\d{3,4}[-.\s]?\d{4}/;
  const explicit = /(내\s*이름은|제\s*이름은|학교는\s*\S+학교|학번은\s*\d+)/;
  return email.test(value) || phone.test(value) || explicit.test(value);
}

async function submitInitial() {
  const question = $("initialQuestion").value.trim();
  const validation = validateQuestion(question);
  if (!validation.ok) return updateQuestionField("initial");
  state.originalQuestion = question;
  saveState();
  const requestId = beginRequest("initial", "질문에서 탐구 대상을 찾고 있습니다.");
  trackEvent("initial_submitted");
  let completionError = "";

  try {
    const response = await analyze({ stage: "initial", question, requestId });
    if (!isCurrentRequest(requestId)) return;
    state.firstFeedback = response;
    saveState();
    renderFeedback(response);
    trackEvent("initial_feedback_shown", response);
    goTo("FEEDBACK");
  } catch (error) {
    if (!isCurrentRequest(requestId)) return;
    console.error("초기 질문 분석 실패", safeClientErrorCode(error));
    if (error?.serverResponded) {
      completionError = "분석 서버의 응답을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.";
      return;
    }
    const fallback = buildLocalInitialFeedback(question, requestId, true);
    state.firstFeedback = fallback;
    saveState();
    renderFeedback(fallback);
    trackEvent("api_fallback", fallback);
    goTo("FEEDBACK");
  } finally {
    finishRequest(requestId, completionError);
  }
}

async function submitRevision() {
  const question = $("revisedQuestion").value.trim();
  const validation = validateQuestion(question, state.originalQuestion);
  if (!validation.ok) return updateQuestionField("revision");
  state.revisedQuestion = question;
  saveState();
  const requestId = beginRequest("revision", "두 질문 사이의 변화를 찾고 있습니다.");
  trackEvent("revision_submitted");
  let completionError = "";

  try {
    const response = await analyze({ stage: "revision", question, originalQuestion: state.originalQuestion, requestId });
    if (!isCurrentRequest(requestId)) return;
    state.comparison = response;
    saveState();
    renderComparison(response);
    trackEvent("comparison_shown", response);
    goTo("COMPARISON");
  } catch (error) {
    if (!isCurrentRequest(requestId)) return;
    console.error("수정 질문 분석 실패", safeClientErrorCode(error));
    if (error?.serverResponded) {
      completionError = "분석 서버의 응답을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.";
      return;
    }
    const fallback = buildLocalComparison(state.originalQuestion, question, requestId, true);
    state.comparison = fallback;
    saveState();
    renderComparison(fallback);
    trackEvent("api_fallback", fallback);
    goTo("COMPARISON");
  } finally {
    finishRequest(requestId, completionError);
  }
}

async function analyze(payload) {
  if (CONFIG.demoMode || !CONFIG.apiBaseUrl) {
    await sleep(850);
    return payload.stage === "initial"
      ? buildLocalInitialFeedback(payload.question, payload.requestId, true)
      : buildLocalComparison(payload.originalQuestion, payload.question, payload.requestId, true);
  }

  const endpoint = `${CONFIG.apiBaseUrl.replace(/\/$/, "")}/${CONFIG.analyzeFunction}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONFIG.requestTimeoutMs || 10000);
  const headers = { "Content-Type": "application/json" };
  if (CONFIG.supabasePublishableKey) {
    headers.apikey = CONFIG.supabasePublishableKey;
    headers.Authorization = `Bearer ${CONFIG.supabasePublishableKey}`;
  }
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        sessionId: state.sessionId,
        requestId: payload.requestId,
        source: state.source,
        contentId: content.contentId,
        ...payload
      })
    });
    if (!response.ok) throw serverResponseError(`API_${response.status}`);
    let data;
    try {
      data = await response.json();
    } catch {
      throw serverResponseError("INVALID_SERVER_JSON");
    }
    if (data?.requestId !== payload.requestId) throw serverResponseError("REQUEST_ID_MISMATCH");
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

function renderFeedback(feedback) {
  $("initialLevel").textContent = `${feedback.levelCode} · ${feedback.levelLabel}`;
  $("initialLevelDescription").textContent = levelDescription(feedback.levelCode);
  $("strengthText").textContent = feedback.strength;
  $("nextStepText").textContent = feedback.nextStep;
  $("hintText").textContent = feedback.rewriteHint;
  $("fallbackNote").hidden = !feedback.fallbackUsed;
  $("originalQuestionView").textContent = state.originalQuestion;
}

function renderComparison(result) {
  $("compareOriginal").textContent = state.originalQuestion;
  $("compareRevised").textContent = state.revisedQuestion;
  $("compareOriginalLevel").textContent = `${result.initialLevelCode} · ${result.initialLevelLabel}`;
  $("compareRevisedLevel").textContent = `${result.revisedLevelCode} · ${result.revisedLevelLabel}`;
  $("comparisonText").textContent = result.comparison;
  $("nextTryText").textContent = result.nextTry ? `다음에 한 번 더 고친다면: ${result.nextTry}` : "";
  $("changeTags").replaceChildren(...(result.changeTags || []).map((tag) => {
    const el = document.createElement("span");
    el.className = "change-tag";
    el.textContent = tag;
    return el;
  }));
}

function buildLocalInitialFeedback(question, requestId, fallbackUsed = false) {
  const analysis = ruleAnalyze(question);
  const copy = {
    L1: {
      strength: "자료에 제시된 구체적인 사실에 주목했습니다.",
      nextStep: "행방을 확인하는 데서 나아가, 그 선택의 이유나 이후의 영향으로 탐구 범위를 넓혀 보세요.",
      rewriteHint: "‘합류한 이유’와 ‘합류 이후의 변화’ 중 한 요소를 골라 반영해 보세요."
    },
    L2: {
      strength: "사건의 원인이나 영향을 연결해 보려는 방향이 드러납니다.",
      nextStep: "어떤 주체의 선택인지, 어떤 조건에서 생긴 변화인지 좁혀 보세요.",
      rewriteHint: "행위자 · 조건 · 영향 범위 중 하나를 더 구체화해 보세요."
    },
    L3: {
      strength: "대상과 관계가 드러나 자료를 통해 검토할 수 있는 탐구 방향이 보입니다.",
      nextStep: "비교 기준이나 확인할 근거를 더 분명히 하면 탐구 범위가 선명해집니다.",
      rewriteHint: "비교 기준 · 자료 근거 · 관점 중 하나를 선택해 정교화해 보세요."
    }
  }[analysis.levelCode];
  return { requestId, ruleEngine: RULE_ENGINE_ID, ...analysis, ...copy, fallbackUsed };
}

function buildLocalComparison(original, revised, requestId, fallbackUsed = false) {
  const before = ruleAnalyze(original);
  const after = ruleAnalyze(revised);
  const changeTags = detectChanges(original, revised);
  const positive = changeTags.length ? changeTags.join(", ") : "표현이 정리됨";
  return {
    requestId,
    ruleEngine: RULE_ENGINE_ID,
    initialLevelCode: before.levelCode,
    initialLevelLabel: before.levelLabel,
    revisedLevelCode: after.levelCode,
    revisedLevelLabel: after.levelLabel,
    changeTags: changeTags.length ? changeTags : ["표현 정리"],
    comparison: `수정 질문에는 ${positive}이(가) 드러납니다. 수준 표시보다 질문의 대상과 관계가 이전보다 어떻게 선명해졌는지 확인해 보세요.`,
    nextTry: after.levelCode === "L3" ? "확인할 자료나 비교 기준을 한 가지 더 정해 보세요." : "조건·관점·근거 중 한 가지를 더해 보세요.",
    fallbackUsed
  };
}

// PROVISIONAL_RULE_ENGINE: 박람회 현장 데모용 임시 규칙입니다.
function ruleAnalyze(question) {
  const q = normalized(question);
  const directMaterialAnswer = asksForDirectFact(q) && hasMaterialAnchor(q);
  let levelCode = "L1";
  if (asksForComparisonOrJudgement(q)) levelCode = "L3";
  else if (directMaterialAnswer) levelCode = "L1";
  else if (asksForCauseOrRelation(q)) levelCode = "L2";
  const labels = { L1: "사실·정보 확인형", L2: "관계 탐색형", L3: "비교·평가·해석형" };
  return { levelCode, levelLabel: labels[levelCode] };
}

function asksForDirectFact(q) {
  return /(누가|언제|어디로갔|어디에갔|어디에서|어디인가|몇명|무슨일|어떤일|행방|무엇을했|어떻게되었|결과는무엇)/.test(q);
}

function hasMaterialAnchor(q) {
  return Boolean(content?.keywords?.some((keyword) => q.includes(normalized(keyword))));
}

function asksForCauseOrRelation(q) {
  const cause = /(왜|이유|원인|때문)/.test(q);
  const influence = /(어떤영향|영향을?주|영향을?미치|효과가|결과로|초래|이어지|관계가)/.test(q);
  const change = /(어떻게.*(?:바꾸|변화|달라)|시간.*(?:변화|달라)|전후.*(?:변화|달라))/.test(q);
  const actionAndResult = /(조건|선택|행동).*(결과|영향|변화)/.test(q);
  return cause || influence || change || actionAndResult;
}

function asksForComparisonOrJudgement(q) {
  const comparison = /(비교하면|비교했을때|차이점|공통점)/.test(q)
    || /(?:와|과).+중.+더(?:큰|많은|적은|중요한|효과적인)?/.test(q);
  const evaluation = /(얼마나|어느정도).*(효과적|타당|정당|성공|실패|중요|기여)/.test(q)
    || /(효과적|타당|정당).*(평가|판단|볼수|이었을까|인가)/.test(q);
  const interpretation = /(역사적의미|의미와한계|의미는무엇|한계는무엇)/.test(q);
  const perspective = /(관점|입장|이해관계).*(비교|평가|판단|다르)/.test(q);
  const counterfactual = /(만약.+(?:다면|했을까|되었을까)|않았다면|없었다면|대안은)/.test(q);
  const evidenceJudgement = /(근거|자료|사료).*(판단|평가|타당|해석)/.test(q);
  return comparison || evaluation || interpretation || perspective || counterfactual || evidenceJudgement;
}

function detectChanges(original, revised) {
  const tags = [];
  const checks = [
    [/(1907|언제|시기|당시)/, "시기 추가"],
    [/(고종|일제|대한제국|군인|의병|주체|누가)/, "대상 구체화"],
    [/(왜|원인|영향|결과|과정|관계|어떻게)/, "관계 드러남"],
    [/(근거|자료|사료|기록|관점)/, "근거·관점 연결"],
    [/(비교|차이|공통|평가|타당|한계)/, "비교·평가 기준 추가"]
  ];
  for (const [regex, label] of checks) {
    if (!regex.test(original) && regex.test(revised)) tags.push(label);
  }
  if (revised.length < original.length * 0.85) tags.push("범위 축소");
  if (revised.length > original.length * 1.25) tags.push("조건 확장");
  return [...new Set(tags)].slice(0, 4);
}

function levelDescription(levelCode) {
  return {
    L1: "자료에서 직접 확인할 수 있는 사실·정보를 묻는 질문입니다. 다음에는 그 선택의 이유나 이후의 영향으로 확장할 수 있습니다.",
    L2: "원인·영향·선택·변화를 연결하려는 질문입니다. 다음에는 조건·관점·근거를 명료하게 해 볼 수 있습니다.",
    L3: "비교·평가·해석을 위해 여러 대상과 판단 기준을 연결한 질문입니다. 근거 자료와 비교 기준을 더 정교화할 수 있습니다."
  }[levelCode] || "질문의 탐구 방향을 확인했습니다.";
}

function renderResources() {
  const nodes = content.resources.map((resource) => {
    const link = document.createElement("a");
    const available = resource.url && resource.url !== "#";
    link.className = `resource-card${available ? "" : " disabled"}`;
    link.href = available ? resource.url : "#";
    link.target = available ? "_blank" : "_self";
    link.rel = "noopener noreferrer";
    link.innerHTML = `<span><strong>${escapeHtml(resource.title)}</strong><small>${escapeHtml(available ? resource.description : "링크 입력 필요")}</small></span><span class="resource-arrow">→</span>`;
    if (available) link.addEventListener("click", () => trackEvent(resource.id === "form" ? "resource_form_clicked" : "resource_file_clicked", { resourceId: resource.id }));
    return link;
  });
  $("resourceList").replaceChildren(...nodes);
}

function showLoading(initialText) {
  $("loadingText").textContent = initialText;
  $("loadingLayer").hidden = false;
  clearTimeout(delayedLoadingTimer);
  delayedLoadingTimer = setTimeout(() => {
    $("loadingText").textContent = "피드백을 정리하고 있습니다. 잠시만 기다려 주세요.";
  }, 3000);
}

function hideLoading() {
  clearTimeout(delayedLoadingTimer);
  $("loadingLayer").hidden = true;
}

function beginRequest(stage, loadingText) {
  const requestId = crypto.randomUUID();
  activeRequest = { requestId, stage };
  updateQuestionField("initial");
  updateQuestionField("revision");
  showLoading(loadingText);
  return requestId;
}

function isCurrentRequest(requestId) {
  return activeRequest?.requestId === requestId;
}

function finishRequest(requestId, message = "") {
  if (!isCurrentRequest(requestId)) return;
  const stage = activeRequest.stage;
  activeRequest = null;
  hideLoading();
  updateQuestionField("initial");
  updateQuestionField("revision");
  if (message) $(stage === "initial" ? "initialError" : "revisionError").textContent = message;
}

function serverResponseError(code) {
  const error = new Error(code);
  error.serverResponded = true;
  return error;
}

function safeClientErrorCode(error) {
  const message = error instanceof Error ? error.message : "UNKNOWN";
  return /^[A-Z0-9_]+$/.test(message) ? message : "REQUEST_FAILED";
}

function restartDemo() {
  const source = state.source;
  discardStoredState();
  state = defaultState({ source, ...getContentIdentity(content) });
  $("initialQuestion").value = "";
  $("revisedQuestion").value = "";
  updateQuestionField("initial");
  updateQuestionField("revision");
  trackEvent("demo_restarted");
  renderStep("START");
}

async function trackEvent(eventType, detail = {}) {
  if (!CONFIG.apiBaseUrl || CONFIG.demoMode || !CONFIG.trackFunction) return;
  const requestId = crypto.randomUUID();
  const endpoint = `${CONFIG.apiBaseUrl.replace(/\/$/, "")}/${CONFIG.trackFunction}`;
  const headers = { "Content-Type": "application/json" };
  if (CONFIG.supabasePublishableKey) {
    headers.apikey = CONFIG.supabasePublishableKey;
    headers.Authorization = `Bearer ${CONFIG.supabasePublishableKey}`;
  }
  const safeDetail = {
    initialLevel: detail.levelCode || detail.initialLevelCode || null,
    revisedLevel: detail.revisedLevelCode || null,
    fallbackUsed: Boolean(detail.fallbackUsed),
    resourceId: detail.resourceId || null
  };
  try {
    await fetch(endpoint, {
      method: "POST",
      headers,
      keepalive: true,
      body: JSON.stringify({ requestId, sessionId: state.sessionId, source: state.source, contentId: content.contentId, eventType, ...safeDetail })
    });
  } catch { /* 체험 흐름에 영향을 주지 않음 */ }
}

function loadState() {
  const source = sourceFromUrl();
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY));
    if (!saved?.sessionId || saved.source !== source) {
      discardStoredState();
      return defaultState({ source });
    }
    return { ...defaultState({ source }), ...saved, source };
  } catch {
    discardStoredState();
    return defaultState({ source });
  }
}
function saveState() {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* 메모리 모드 */ }
}
function discardStoredState() {
  try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* 메모리 모드 */ }
}
function getContentIdentity(value) {
  return {
    contentId: String(value?.contentId || ""),
    contentVersion: String(value?.contentVersion || "")
  };
}
function matchesContentIdentity(savedState, identity) {
  return Boolean(identity.contentId && identity.contentVersion)
    && savedState.contentId === identity.contentId
    && savedState.contentVersion === identity.contentVersion;
}
function normalized(value) { return value.replace(/\s+/g, "").replace(/[?？!.。,]/g, "").toLowerCase(); }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function escapeHtml(value) { return value.replace(/[&<>'"]/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[char])); }

function editDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

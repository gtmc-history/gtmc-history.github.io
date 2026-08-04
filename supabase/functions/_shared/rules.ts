export type LevelCode = "L1" | "L2" | "L3";

export type QuestionFeatures = {
  directlyAnswerable: boolean;
  hasCause: boolean;
  hasRelation: boolean;
  hasComparison: boolean;
  hasEvaluation: boolean;
  hasPerspective: boolean;
  hasHistoricalMeaning: boolean;
  hasCounterfactual: boolean;
  requiresEvidence: boolean;
};

export type RuleResult = {
  levelCode: LevelCode;
  levelLabel: string;
  features: QuestionFeatures;
  fallback: { strength: string; nextStep: string; rewriteHint: string };
};

export type QuestionContent = {
  contentId: string;
  material: string;
  keywords: string[];
  blockedAnswerPhrases: string[];
};

export const PROVISIONAL_RULE_ENGINE_ID = "PROVISIONAL_RULE_ENGINE";

const QUESTION_CONTENT: Record<string, QuestionContent> = {
  "demo-uibyeong-01": {
    contentId: "demo-uibyeong-01",
    material: "1907년 일제는 고종을 강제로 퇴위시키고 한일 신협약을 체결한 뒤 대한제국 군대를 해산하였다. 해산 군인 일부는 무기를 들고 의병에 합류하였다.",
    keywords: ["1907", "일제", "고종", "한일 신협약", "대한제국", "군대", "해산", "군인", "의병", "정미의병"],
    blockedAnswerPhrases: [
      "고종을 강제로 퇴위",
      "한일 신협약을 체결",
      "대한제국 군대를 해산",
      "무기를 들고 의병에 합류",
    ],
  },
};

const LABELS: Record<LevelCode, string> = {
  L1: "사실·정보 확인형",
  L2: "관계 탐색형",
  L3: "비교·평가·해석형"
};

export function getQuestionContent(contentId: string): QuestionContent | undefined {
  return QUESTION_CONTENT[contentId];
}

export function analyzeByRules(question: string, content: QuestionContent = QUESTION_CONTENT["demo-uibyeong-01"]): RuleResult {
  const q = normalize(question);
  const features: QuestionFeatures = {
    directlyAnswerable: asksForDirectFact(q) && content.keywords.some((keyword) => q.includes(normalize(keyword))),
    hasCause: /(왜|이유|원인|때문)/.test(q),
    hasRelation: /(어떤영향|영향을?주|영향을?미치|효과가|결과로|초래|이어지|관계가)/.test(q)
      || /(어떻게.*(?:바꾸|변화|달라)|시간.*(?:변화|달라)|전후.*(?:변화|달라))/.test(q)
      || /(조건|선택|행동).*(결과|영향|변화)/.test(q),
    hasComparison: /(비교하면|비교했을때|차이점|공통점)/.test(q)
      || /(?:와|과).+중.+더(?:큰|많은|적은|중요한|효과적인)?/.test(q),
    hasEvaluation: /(얼마나|어느정도).*(효과적|타당|정당|성공|실패|중요|기여)/.test(q)
      || /(효과적|타당|정당).*(평가|판단|볼수|이었을까|인가)/.test(q),
    hasPerspective: /(관점|입장|이해관계).*(비교|평가|판단|다르)/.test(q),
    hasHistoricalMeaning: /(역사적의미|의미와한계|의미는무엇|한계는무엇)/.test(q),
    hasCounterfactual: /(만약.+(?:다면|했을까|되었을까)|않았다면|없었다면|대안은)/.test(q),
    requiresEvidence: /(근거|자료|사료).*(판단|평가|타당|해석)/.test(q),
  };

  let levelCode: LevelCode = "L1";
  const higher = features.hasComparison || features.hasEvaluation || features.hasPerspective
    || features.hasHistoricalMeaning || features.hasCounterfactual || features.requiresEvidence;
  const relation = features.hasCause || features.hasRelation;
  if (higher) levelCode = "L3";
  else if (features.directlyAnswerable) levelCode = "L1";
  else if (relation) levelCode = "L2";

  const fallbackByLevel: Record<LevelCode, RuleResult["fallback"]> = {
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
  };

  return { levelCode, levelLabel: LABELS[levelCode], features, fallback: fallbackByLevel[levelCode] };
}

function asksForDirectFact(q: string) {
  return /(누가|언제|어디로갔|어디에갔|어디에서|어디인가|몇명|무슨일|어떤일|행방|무엇을했|어떻게되었|결과는무엇)/.test(q);
}

export function detectChanges(original: string, revised: string): string[] {
  const tags: string[] = [];
  const checks: Array<[RegExp, string]> = [
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

export function fallbackComparison(original: string, revised: string, content?: QuestionContent) {
  const before = analyzeByRules(original, content);
  const after = analyzeByRules(revised, content);
  const changeTags = detectChanges(original, revised);
  const changeText = changeTags.length ? changeTags.join(", ") : "표현이 정리됨";
  return {
    initialLevelCode: before.levelCode,
    initialLevelLabel: before.levelLabel,
    revisedLevelCode: after.levelCode,
    revisedLevelLabel: after.levelLabel,
    changeTags: changeTags.length ? changeTags : ["표현 정리"],
    comparison: `수정 질문에는 ${changeText}이(가) 드러납니다. 수준 표시보다 질문의 대상과 관계가 이전보다 어떻게 선명해졌는지 확인해 보세요.`,
    nextTry: after.levelCode === "L3" ? "확인할 자료나 비교 기준을 한 가지 더 정해 보세요." : "조건·관점·근거 중 한 가지를 더해 보세요."
  };
}

function normalize(value: string) {
  return value.replace(/\s+/g, "").replace(/[?？!.。,]/g, "").toLowerCase();
}

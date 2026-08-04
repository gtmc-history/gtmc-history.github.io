export type LevelCode = "L1" | "L2" | "L3";

export type RuleResult = {
  levelCode: LevelCode;
  levelLabel: string;
  features: Record<string, boolean>;
  fallback: { strength: string; nextStep: string; rewriteHint: string };
};

const LABELS: Record<LevelCode, string> = {
  L1: "정보 확인형",
  L2: "관계 탐색형",
  L3: "근거 기반 탐구형"
};

export function analyzeByRules(question: string): RuleResult {
  const q = normalize(question);
  const features = {
    hasTime: /(1907|언제|시기|당시)/.test(q),
    hasActor: /(고종|일제|대한제국|군인|의병|주체|누가)/.test(q),
    hasCause: /(왜|원인|이유)/.test(q),
    hasRelation: /(영향|결과|과정|변화|관계|어떻게|합류|해산)/.test(q),
    hasComparison: /(비교|차이|공통)/.test(q),
    hasEvaluation: /(평가|타당|정당|의미|한계|가장)/.test(q),
    hasEvidence: /(근거|자료|사료|기록|관점)/.test(q),
    hasCounterfactual: /(만약|가정|였다면|라면)/.test(q),
    hasSpecificTopic: /(1907|고종|한일신협약|대한제국|군대|해산군인|의병|정미의병|일제)/.test(q)
  };

  let levelCode: LevelCode = "L1";
  const higher = features.hasComparison || features.hasEvaluation || features.hasEvidence || features.hasCounterfactual;
  const relation = features.hasCause || features.hasRelation;
  if (higher && (relation || features.hasSpecificTopic || q.length >= 28)) levelCode = "L3";
  else if (relation) levelCode = "L2";

  const fallbackByLevel: Record<LevelCode, RuleResult["fallback"]> = {
    L1: {
      strength: "사건의 핵심 내용을 확인하려는 출발점이 드러납니다.",
      nextStep: "질문의 대상과 시기, 행위자 중 하나를 더 분명히 해 보세요.",
      rewriteHint: "누가 · 언제 · 어떤 조건에서 중 하나를 골라 추가해 보세요."
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

export function fallbackComparison(original: string, revised: string) {
  const before = analyzeByRules(original);
  const after = analyzeByRules(revised);
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

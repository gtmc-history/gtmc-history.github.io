# Hub and dashboard operations

## Source of truth

게임 목록과 lifecycle, SAVE/DASH 판정, renderer, alias는 sibling games repository의 `games.manifest.json`을 기준으로 한다. 이 저장소에는 복제 manifest를 두지 않는다.

## 새 published 게임 반영

1. games repo에서 구현·SAVE/DASH 판정·payload 검사를 마친다.
2. 필요한 `game_meta` migration과 renderer를 준비한다.
3. games manifest를 `published`로 전환한다.
4. 허브에 canonical slug·title 카드 하나를 추가한다.
5. DASH-A/B는 `CANONICAL_GAME_LABELS`에 mapping한다.
6. generic으로 부족할 때만 `CUSTOM_RENDERERS`를 추가한다.
7. legacy ID가 있으면 client와 Edge alias를 같은 canonical ID로 맞춘다.
8. cross-repo audit를 통과시킨 뒤 배포한다.

## Cross-repo audit

Games repo에서 다음을 실행한다.

```text
npm run audit:games -- --hub-repo "../gtmc-history.github.io"
```

이 검사는 published 허브 카드, canonical dashboard label, custom renderer 지정, legacy alias의 client/Edge 정합성을 확인한다. HTML의 설명 문구나 시각적 품질까지 판정하지 않으므로 브라우저 회귀검사를 대체하지 않는다.

## 변경 금지선

- 미공개 게임 선노출 금지
- manifest 수동 복제 금지
- legacy 학생 행 자동 rewrite 금지
- service-role client 노출 금지
- production 감사 INSERT 금지
- 승인 없는 RLS·migration history 변경 금지

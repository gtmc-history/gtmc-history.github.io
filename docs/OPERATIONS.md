# Hub and dashboard operations

## Source of truth

게임 목록과 lifecycle, SAVE/DASH 판정, renderer, alias는 sibling games repository의 `games.manifest.json`을 기준으로 한다. 이 저장소에는 복제 manifest를 두지 않는다.

`data/games.json`은 허브 렌더링용 projection이다. canonical inventory가 아니며 다음 계약을 지킨다.

- `published` slug와 path 집합은 manifest의 `published` 집합과 정확히 같아야 한다.
- `title`은 manifest의 canonical title과 정확히 같아야 한다.
- 허브용 축약 표기는 optional `displayTitle`에 두고 UI는 `displayTitle || title`을 사용한다.
- 검색 태그 필드는 `tags`만 사용한다.
- 근거가 확정되지 않은 수업 위치와 시간은 추정하지 않고 빈 값과 `unconfirmed` 상태를 함께 기록한다.

## 새 published 게임 반영

1. games repo에서 구현·SAVE/DASH 판정·payload 검사를 마친다.
2. 필요한 `game_meta` migration과 renderer를 준비한다.
3. games manifest를 `published`로 전환한다.
4. `data/games.json`에 canonical slug·path·title과 허브 표시 메타데이터를 추가한다.
5. DASH-A/B는 `CANONICAL_GAME_LABELS`에 mapping한다.
6. generic으로 부족할 때만 `CUSTOM_RENDERERS`를 추가한다.
7. legacy ID가 있으면 client와 Edge alias를 같은 canonical ID로 맞춘다.
8. cross-repo audit를 통과시킨 뒤 배포한다.

## Cross-repo audit

Games repo에서 다음을 실행한다.

```text
npm run audit:games -- --hub-repo "../gtmc-history.github.io"
```

이 검사는 manifest와 `data/games.json`의 published slug/path 집합 및 canonical title, dashboard label, custom renderer 지정, legacy alias의 client/Edge 정합성을 확인한다. runtime DOM 카드 수와 href, HTML의 시각적 품질은 브라우저 회귀검사에서 별도로 확인한다.

## 변경 금지선

- 미공개 게임 선노출 금지
- manifest 수동 복제 금지
- legacy 학생 행 자동 rewrite 금지
- service-role client 노출 금지
- production 감사 INSERT 금지
- 승인 없는 RLS·migration history 변경 금지

# Dashboard rules

루트 `AGENTS.md`와 `docs/OPERATIONS.md`를 먼저 따른다.

## Mapping

- canonical ID는 games repo manifest 기준이다.
- `CANONICAL_GAME_LABELS`는 교사 화면 표시명 mapping이다.
- `CUSTOM_RENDERERS`는 실제로 generic chart로 표현할 수 없는 게임만 등록한다.
- renderer 추가·삭제 시 games manifest와 cross-repo audit를 함께 갱신한다.
- legacy alias는 `GAME_ID_ALIASES`에서 canonical ID로 정규화한다.
- alias 원본 학생 행을 DB에서 자동 rewrite하지 않는다.

## Data

- Edge Function이 `results`와 `meta`를 제공하는 현재 권한 경계를 유지한다.
- client에서 service-role key를 사용하지 않는다.
- 기존 `choices`, `comment`, attempt 병합 규칙을 임의 변경하지 않는다.
- 게임별 payload가 다르면 먼저 generic renderer로 처리 가능한지 확인한다.

## 변경 안전

- 기존 renderer를 수정하면 해당 게임과 generic 게임을 함께 회귀검사한다.
- fixture/mock으로 chart를 검사하고 production 학생 데이터를 만들지 않는다.
- 인증 token 값이나 secret을 코드·문서·로그에 기록하지 않는다.
- 대시보드 기능 확장은 별도 요청 없이 수행하지 않는다.

## 완료 gate

- inline script 구문 검사
- 인증 prompt와 Edge 오류 처리 확인
- canonical labels, custom renderers, legacy aliases cross-repo audit PASS
- `git diff --check`

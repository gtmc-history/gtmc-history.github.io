# AGENTS.md — 게임 허브·대시보드 운영 지도

이 저장소는 공개 게임 허브와 교사 대시보드를 운영한다.
canonical game registry는 이 저장소에 복사하지 않고 sibling 게임 저장소의 `games.manifest.json`만 사용한다.

## 작업 시작

1. `git remote -v`, branch, `git status`, HEAD, `origin/main` ahead/behind를 확인한다.
2. 사용자 변경과 dirty 파일을 먼저 확인한다.
3. `docs/OPERATIONS.md`를 읽는다.
4. dashboard 작업이면 `dashboard/AGENTS.md`를 읽는다.
5. Supabase 작업이면 `supabase/AGENTS.md`를 읽는다.
6. 가능하면 sibling games repo에서 cross-repo audit를 먼저 실행한다.

## Canonical registry

- source of truth: games repo의 `games.manifest.json`.
- 이 저장소에 manifest 수동 복제본을 만들지 않는다.
- folder slug, public URL slug, saved game ID는 canonical slug와 일치해야 한다.
- legacy alias를 canonical ID로 취급하지 않는다.
- 현재 `gabo1894`는 `gabo-reform`의 legacy alias다.

## 허브

- manifest `status: published` 게임만 카드로 노출한다.
- draft, tested, archived 게임을 선노출하지 않는다.
- 새 카드는 canonical slug와 현재 title을 사용한다.
- 기존 정상 카드, 필터, 디자인을 불필요하게 수정하지 않는다.
- 허브 디자인 개편은 별도 요청 없이 수행하지 않는다.

## 대시보드

- DASH-A/B만 교사 결과 표시 대상으로 본다.
- generic renderer로 충분하면 custom renderer를 추가하지 않는다.
- custom renderer 관계는 중앙 `CUSTOM_RENDERERS`와 manifest가 일치해야 한다.
- canonical label은 중앙 mapping에서 관리하고 게임별 조건문을 난립시키지 않는다.
- legacy alias는 client와 Edge 정규화 양쪽을 함께 유지한다.
- 기존 결과 payload와 과거 행을 임의 변환하지 않는다.

## 절대 규칙

- 기존 정상 게임 카드·renderer를 단순 공통화를 위해 리팩터링하지 않는다.
- service-role key나 운영자 secret을 브라우저 코드에 넣지 않는다.
- production 학생 데이터를 테스트용으로 INSERT하지 않는다.
- RLS나 migration history를 명시적 승인 없이 변경하지 않는다.
- games manifest와 불일치한 상태로 통합 작업을 완료했다고 보고하지 않는다.

## 검증

Sibling games repo에서 실행:

`npm run audit:games -- --hub-repo "../gtmc-history.github.io"`

배포 후 읽기 전용 HTTP까지 확인할 때:

`npm run audit:games -- --hub-repo "../gtmc-history.github.io" --production`

완료 전 `git diff --check`와 두 저장소 status를 확인한다.

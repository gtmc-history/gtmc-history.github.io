# STUDY ROOM — 오션뷰 30석 학급형 기능·설계 검수

> 판정: **CONDITIONAL PASS for isolated code/database test; NOT APPROVED for public student launch**.
> 기존 운영판 v0.5.2 및 v0.6-B/C/D, v0.6-D.1, Ocean View 2.0 파일은 변경하지 않음.

- 실행: https://gtmc-history.github.io/studyroom-class30-preview/
- 코드: https://github.com/gtmc-history/gtmc-history.github.io/blob/main/studyroom-class30-preview/index.html
- 기반: `studyroom-ocean20-preview/index.html`

## 1. 요구·구현
- 학급 전체 25명 이상 대비 **30석** 확보. 1인석 12 + 2인 공동 테이블 9개(18석). 공유 좌석의 점유·공부 기록은 사용자별 독립.
- 30석 전용 공용 방 `public-3p`, 선택한 학교의 30석 방 `sch-{school_code}-4`. 기존 공용 1~5호와 기존 학교 1~3호는 **12석 그대로 유지**.
- PC: 6열 × 5행. 모바일 세로: 3열 × 10행. 이 레이아웃은 방향 회전 시 다시 생성하며, 0..29의 좌석 식별자는 고정.
- 30석 **번호별 자리 선택 UI** 제공: 전체 30석을 한 화면에서 확인하고 비어 있는 자리를 선택, 3D 카메라가 먼 줄을 놓치더라도 입장 가능.
- 30석 전용 배치에서 **Three.js InstancedMesh**로 공유 머티리얼 정적 박스를 한 번에 렌더링, 모바일 저사양 기본 적용(그림자 OFF, 픽셀 비율 1, 목표 최대 30fps).
- 오션뷰 2.0의 테마, 바다·파도·돛단배·섬·등대·새, 책상 시점, 공부 중 스탠드, 휴식 바다 감상, 사용자 선택형 환경음 유지.

## 2. Supabase 백엔드 범위
마이그레이션 두 건:
1. `studyroom_classroom_30seat_isolated_preview`
   - `public.seats6` CHECK에서 새 preview room ID와 0..29 좌석 인덱스 허용.
   - **기존 `sr6_claim` 수정 없음**, 여전히 0..11만 허용.
   - 새 `public.sr7_preview_claim(...)`은 `public-3p` 또는 현재 인증 사용자가 선택한 학교의 `sch-{school_code}-4`에서만 0..29 허용.
   - `rls6.can_read_preview30(text)`로 인증 사용자·학교 소속 일치 검증. RPC EXECUTE는 authenticated만.
2. `studyroom_class30_merge_read_policies`
   - 원래 `seats6_read` 정책 + 미리보기 열람실 접근 정책의 논리를 하나의 USING 절로 결합하여 중복 permissive 정책 경고 제거.

## 3. 완료된 검증 (사용자 데이터 오염 없음)
- Postgres 제약조건·RPC 인증 실행권한·기존 함수의 0..11 거부·새 함수의 0..29 허용 확인.
- **트랜잭션 롤백 테스트**: `public-3p` 29번 좌석(표시 30번) 신규 착석·owner row 삽입, 좌석 30 이상 거부, 기존 함수가 preview 좌석을 거부함을 확인. 학교에 소속된 본인만 학교 room4의 마지막 자리에 착석 가능, 임의 타교 room4 거부.
- 인증 사용자 역할로 preview 좌석 SELECT가 RLS를 통과하는지 트랜잭션 내 검사, 전체 ROLLBACK. 시험 좌석 0건 유지.
- PC 1200×800 및 모바일 390×844 각각 room 30석 + room 12석 배치: 30석은 **6×5 / 3×10**, 모두 고유 좌표/좌석번호, 공유석 18·1인석 12. 각 공유 테이블에 두 개의 같은 행 인접 좌석이 연결되는지도 검사.
- Three.js mock geometry에서 반복 방 전환: 30석 모델 총 707(PC) 또는 736(모바일) 지오메트리 생성, 이전 방 dispose, 현재 해안 테마 텍스처 2개 유지(풍경 1 + 간판 1). 정적 instancing 함수에 대해 32개 박스를 2개 묶음으로 압축하고 hitbox를 보존하는 별도 모의 검사.
- JS 문법 검사 PASS (코드는 GitHub에서 재-fetch 후 확인).

## 4. 공개 전에 반드시 남은 검증
1. **실제 Chrome/WebGL 렌더링**: PC/모바일 오션뷰 30석 화면 캡처. 멀리 있는 책상 겹침·시야·바다 풍경 가림, 자리 선택 UI와 타이머 가림 확인.
2. **실제 성능 측정**: 크롬북/안드로이드/iPhone에서 30개 캐릭터 기준 FPS, draw calls, memory.geometries, memory.textures, 20회 방 전환. InstancedMesh 동작, 렌더링 등가성.
3. **30명 동시 접속**: 서로 다른 로그인 세션 30개로 모든 좌석 점유, 31번째 거부, 탈퇴와 자동 자리 정리, 응원·Presence·Realtime 갱신. 테스트용 계정/환경 및 부하 제한을 정한 뒤 시행.
4. **실제 누적 공부 기록 회귀**: 30석 방에서 1~3분 집중 → 중단/복귀 → 정상 종료 → 새로고침 후 기록 유지. 실제 인증·CAPTCHA. 기존 인증 서비스와 같은 사용자 스토리지를 공유하므로 **구형 시험판과 같은 계정으로 동시에 열지 말 것**.
5. **출시 보안·정책**: 기존 레거시 `sr_*` definer RPC에 대한 Supabase advisory 경고, 학교 Realtime channel 접근 제어, 개인정보 안내·삭제·미성년자 운영 기준 등을 정식 공개 전에 점검.

## 테스트 원칙
- 서버에서 자리를 차지하는 동시성 실측은 아직 수행하지 않았음. SQL 경계 테스트는 모두 `BEGIN ... ROLLBACK`으로 되돌림.
- 정적 mock 객체 개수는 실제 GPU draw-call 또는 FPS가 아님.
- 구글 계정 연결은 후순위.
- 기존 12석 room 이용자는 코드·room ID·활성 자리 모두 그대로 사용.

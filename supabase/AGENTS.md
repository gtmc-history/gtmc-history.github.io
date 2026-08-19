# Supabase rules for hub and dashboard

루트 `AGENTS.md`와 games repo의 `docs/SECURITY.md`를 함께 따른다.

## Edge Functions

- dashboard service-role key는 server 환경에만 둔다.
- browser에는 운영자 token 입력 UI와 공개 설정만 둔다.
- 인증 방식이나 `verify_jwt` 설정을 바꿀 때 기존 dashboard 호출과 함께 검증한다.
- 배포 전 TypeScript 구문과 shared security module 의존성을 확인한다.

## Database

- production 학생 결과를 감사용으로 INSERT하지 않는다.
- RLS/grant 변경은 현재 policy를 먼저 조회하고 명시적 승인을 받는다.
- migration history를 추측하거나 임의 repair하지 않는다.
- metadata 쓰기는 일반 게임 client가 아니라 migration/서버 운영 경로를 사용한다.

## 완료 gate

- secret 값은 출력하지 않는다.
- Edge deploy와 Git push를 별도 상태로 구분한다.
- games repo의 cross-repo audit로 canonical mapping과 alias를 확인한다.
- 수행한 production 변경과 미적용 proposal을 명확히 보고한다.

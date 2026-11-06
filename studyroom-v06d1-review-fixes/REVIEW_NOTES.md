# STUDY ROOM v0.6-D.1 — Claude REVISE 대응 내역

> 범위: 시각·카메라·리소스 수정만. 기존 v0.5.2 / v0.6-B / v0.6-C / v0.6-D 미수정. 운영 Supabase DB 및 기존 RPC 미변경. 학생 공개 금지.

- 실행 주소: https://gtmc-history.github.io/studyroom-v06d1-review-fixes/
- 소스: https://github.com/gtmc-history/gtmc-history.github.io/blob/main/studyroom-v06d1-review-fixes/index.html

| 검수 항목 | 반영 내용 | 재검증 요청 |
|---|---|---|
| H1 조명·간판 가림 | 창밖 관찰 시 높이 1.85m, 중앙 통로 z=-halfD+3.25 기반의 별도 시점. 간판은 입구 쪽 측벽으로 이동 | 5개 테마 모바일/PC 스크린샷으로 시야 확인 |
| H2 핀치 확대 불능 | 원래 두 손가락 거리 / 현재 거리로 배율 계산 | 2손가락 벌리기·모으기 확대/축소 |
| H3 앞줄 좌석 접근 | 모바일 세로 스와이프는 앞뒤 이동, 가로 스와이프는 시선 회전. ▲앞/▼뒤 버튼 추가 | 12석 모두 화면에 접근·클릭 가능한지 |
| M1 조명과 카메라 겹침 | 창밖 모드 카메라를 y=1.85m, z=-halfD+(1.75~5.2)m로 제한 | 확대·이동 경계에서 장면 클리핑 없는지 |
| M2 시야 과도 회전 | 일반 모드 yaw ±0.39rad, 창밖 모드 ±0.65rad | 실내 구도·창밖 가시성 |
| M3 GPU 리소스 | 방 전환 시 geometry + 캐시 외 material/texture 해제; 떠난 캐릭터 해제; 비동기 간판 갱신 guard | renderer.info.memory.textures 장시간 반복 확인 |
| M4 성능 | 외부 배경 shadow off, 픽셀 비율 상한 축소, 절전 토글(픽셀비율1·그림자OFF·최대30fps), 화면 숨김 시 렌더 skip | 실제 저가 기기 FPS 측정 필요, 정적 메시 통합은 미구현 |
| L1 HTML 메타 오류 | 실제 줄바꿈으로 수정 | DOM head/body 확인 |
| L2 UI 가림 | 시점 도구 기본 접힘, 시험 표시를 상단 텍스트로 이동 | 소형 모바일 좌석 말풍선 확인 |
| L3 창밖 이동 점프 | 일반 camZ와 창밖 전용 windowShift 별도 관리 | 창밖 상태에서 pan/zoom 후 정면 복귀 |
| L4 드래그 방향 | 기존 방향 유지(UX 취향 문제) | 사용자 조작 선호 조사 |

## 모의 테스트 결과 (코드 실행, 실제 Chrome 렌더링 아님)
- 1200×800 PC / 390×844 모바일 × 5개 공용 + 학교별 3개 방: **16건 모두 12좌석(0~11) 보존**
- 같은 검증에서 CanvasTexture: 생성 16 / 이전 방 해제 15 / 현재 방만 1개 유지. geometry 생성 6,018 / 5,632 해제 / 마지막 방 386개 유지. 해당 수치는 **Three.js를 흉내 낸 테스트 객체의 카운트**이며 실제 GPU 메트릭은 아님.
- 카메라/합성 포인터 모의 시험: 창밖 높이 약 1.85m, 핀치 zoomTarget 1→0.667, 세로 스와이프 camZTarget 변경, 좌석 단일 탭 1회, 기본 회전 최대 0.39rad 확인
- 전체 삽입 스크립트 JS 문법 검사 PASS
- **실제 headless Chrome 렌더 스크린샷·실서버 Supabase 인증·공부 기록 회귀 테스트는 이 작업에서 수행하지 않음**

## Claude에게 재검수 요청
기존 headless Chrome mock-Supabase 렌더링 하네스에서 **기존 v0.6-D와 v0.6-D.1을 동일 환경으로 비교**하십시오.
특히 (1) 5개 테마의 모바일 창밖 시야, (2) front/back 12석 접근, (3) 합성 두 포인터 핀치 줌, (4) 20회 방 변경 후 renderer.info.memory.textures/geometry, (5) 저사양 모드 전후 draw calls/FPS, (6) 360px 기기에서 접힌 패널과 펼친 패널의 레이블 겹침을 점검해 주세요.

## 안전
구글 계정 연결은 후순위. 학교별 Realtime 채널 접근 제한, 개인정보 안내, 실제 다중 사용자 및 기기 시험 등 기존 배포 차단 조건은 이 디자인 수정으로 해결되지 않았습니다.

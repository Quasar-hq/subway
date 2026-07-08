# 막차 레일

성균관대역과 혜화역 사이의 막차를 양방향으로 계산하는 웹앱입니다.

## 구성

- `index.html`: 화면 구조
- `styles.css`: 디자인
- `app.js`: 시간표 계산 및 JSON 정규화
- `schedule-data.js`: 실제 시간표 데이터
- `refresh-schedule.ps1`: 시간표 데이터 갱신 스크립트

## 실행

브라우저에서 `index.html`을 열면 됩니다.

## 시간표 데이터 연결

앱은 `schedule-data.js`에 들어 있는 실제 시간표 데이터를 사용합니다.

## 동작 방식

- 성균관대역, 혜화역, 금정역의 실제 시간표 데이터를 사용합니다.
- 양방향 막차를 같은 화면에서 보여줍니다.
- 환승 시간과 도보 시간은 코드 안에서 고정값으로 처리합니다.

## 갱신

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\refresh-schedule.ps1
```

이 스크립트가 `SubwayInfo`의 실시간 시간표를 다시 받아 `schedule-data.js`를 덮어씁니다.

## Supabase 저장

기준 시각 변경 기록은 `supabase-config.js`에 Supabase URL과 anon key를 넣으면 `public.reference_time_events` 테이블로 저장됩니다.

1. `supabase-schema.sql`을 Supabase SQL Editor에서 실행합니다.
2. `supabase-config.js`를 아래 형식으로 채웁니다.

```js
window.SUPABASE_CONFIG = {
  url: "https://YOUR_PROJECT_ID.supabase.co",
  anonKey: "YOUR_SUPABASE_ANON_KEY",
};
```

3. 앱에서 `현재 시각` 또는 `갱신`을 누르면 기록이 저장됩니다.

## 다음 단계

- 실제 시간표가 안 보이면 브라우저에서 API 호출이 막힌 것일 수 있으니, 그때는 알려주면 대체 방식으로 바로 바꿔드릴게요.

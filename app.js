const TRANSFER_MINUTES = 4;
const WALK_MINUTES = 5;

const routeTemplates = {
  outbound: {
    id: "outbound",
    label: "성균관대역 → 혜화역",
    legs: [
      {
        from: "성균관대역",
        to: "금정역",
        line: "1호선",
        direction: "서울 방면",
        travelMinutes: 17,
        departures: ["22:45", "23:02", "23:18", "23:35", "23:52", "00:08", "00:18"],
      },
      {
        from: "금정역",
        to: "혜화역",
        line: "4호선",
        direction: "당고개 방면",
        travelMinutes: 29,
        departures: ["23:07", "23:20", "23:36", "23:51", "00:06", "00:16", "00:31"],
      },
    ],
  },
  inbound: {
    id: "inbound",
    label: "혜화역 → 성균관대역",
    legs: [
      {
        from: "혜화역",
        to: "금정역",
        line: "4호선",
        direction: "당고개 방면",
        travelMinutes: 27,
        departures: ["22:50", "23:07", "23:22", "23:37", "23:53", "00:08", "00:23"],
      },
      {
        from: "금정역",
        to: "성균관대역",
        line: "1호선",
        direction: "서울/광운대 방면",
        travelMinutes: 16,
        departures: ["23:03", "23:17", "23:32", "23:48", "00:02", "00:18", "00:33"],
      },
    ],
  },
};

const fallbackSchedule = {
  meta: {
    title: "막타 시간표",
    updatedAt: new Date().toISOString(),
  },
  routes: [routeTemplates.outbound, routeTemplates.inbound],
};

function mergeScheduleData(source) {
  const mergedRoutes = [routeTemplates.outbound, routeTemplates.inbound].map(
    (templateRoute, routeIndex) => {
      const sourceRoute = source?.routes?.[routeIndex] || {};
      return {
        ...templateRoute,
        ...sourceRoute,
        legs: templateRoute.legs.map((templateLeg, legIndex) => ({
          ...templateLeg,
          ...(sourceRoute.legs?.[legIndex] || {}),
          departures: sourceRoute.legs?.[legIndex]?.departures || templateLeg.departures,
        })),
      };
    },
  );

  return {
    meta: source?.meta || fallbackSchedule.meta,
    routes: mergedRoutes,
  };
}

const state = {
  referenceTime: new Date(),
  schedule: null,
};

const els = {
  baseTime: document.getElementById("base-time"),
  nowTime: document.getElementById("now-time"),
  recalc: document.getElementById("recalc"),
  syncStatus: document.getElementById("sync-status"),
  timelineOutbound: document.getElementById("timeline-outbound"),
  timelineInbound: document.getElementById("timeline-inbound"),
  outboundDeparture: document.getElementById("outbound-departure"),
  outboundArrival: document.getElementById("outbound-arrival"),
  outboundStatus: document.getElementById("outbound-status"),
  inboundDeparture: document.getElementById("inbound-departure"),
  inboundArrival: document.getElementById("inbound-arrival"),
  inboundStatus: document.getElementById("inbound-status"),
};

function getSupabaseConfig() {
  return window.SUPABASE_CONFIG || {};
}

function initGoogleAnalytics(measurementId) {
  if (!measurementId || window.__gaInitialized) {
    return;
  }

  window.__gaInitialized = true;
  window.dataLayer = window.dataLayer || [];
  window.gtag =
    window.gtag ||
    function gtag() {
      window.dataLayer.push(arguments);
    };

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
  document.head.appendChild(script);

  window.gtag("js", new Date());
  window.gtag("config", measurementId);
}

function setSyncStatus(message, tone = "muted") {
  if (!els.syncStatus) {
    return;
  }

  els.syncStatus.textContent = message;
  els.syncStatus.className = `sync-status ${tone}`;
}

function pad(num) {
  return String(num).padStart(2, "0");
}

function parseClock(value) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function formatInputDate(date) {
  const tzOffset = date.getTimezoneOffset() * 60000;
  const local = new Date(date.getTime() - tzOffset);
  return local.toISOString().slice(0, 16);
}

function syncReferenceTime(date) {
  state.referenceTime = date;
  els.baseTime.value = formatInputDate(date);
}

async function persistReferenceEvent(actionType) {
  const { url, anonKey } = getSupabaseConfig();
  if (!url || !anonKey) {
    setSyncStatus("Supabase 설정이 비어 있어 저장하지 않았습니다.", "warn");
    return;
  }

  const restEndpoint = `${url.replace(/\/$/, "")}/rest/v1/reference_time_events`;
  const endpoint = `${url.replace(/\/$/, "")}/rest/v1/rpc/log_reference_time_event`;
  const payload = {
    p_action_type: actionType,
    p_reference_time: state.referenceTime.toISOString(),
    p_local_reference_time: formatInputDate(state.referenceTime),
    p_day_type: getDayTypeKey(state.referenceTime),
    p_source: "web",
  };

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const responseText = await response.text();
    let insertedRow = null;
    if (responseText) {
      try {
        insertedRow = JSON.parse(responseText);
      } catch {
        insertedRow = null;
      }
    }

    if (!response.ok) {
      if (response.status === 404) {
        const fallbackResponse = await fetch(restEndpoint, {
          method: "POST",
          headers: {
            apikey: anonKey,
            Authorization: `Bearer ${anonKey}`,
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          },
          body: JSON.stringify({
            action_type: actionType,
            reference_time: state.referenceTime.toISOString(),
            local_reference_time: formatInputDate(state.referenceTime),
            day_type: getDayTypeKey(state.referenceTime),
            source: "web",
          }),
        });

        if (fallbackResponse.ok) {
          setSyncStatus(`Supabase에 저장됨 · ${actionType}`, "good");
          return;
        }

        setSyncStatus("Supabase 테이블이 아직 없어요. supabase-schema.sql을 실행해 주세요.", "warn");
      } else {
        setSyncStatus(`Supabase 저장 실패 (${response.status})`, "warn");
      }
      return;
    }

    if (insertedRow && typeof insertedRow === "object") {
      const createdAt = insertedRow.created_at
        ? new Date(insertedRow.created_at).toLocaleString("ko-KR", {
            dateStyle: "short",
            timeStyle: "short",
          })
        : "";
      setSyncStatus(
        createdAt
          ? `Supabase에 저장됨 · ${actionType} · ${createdAt}`
          : `Supabase에 저장됨 · ${actionType}`,
        "good",
      );
      return;
    }

    setSyncStatus(`Supabase에 저장됨 · ${actionType}`, "good");
  } catch {
    setSyncStatus("Supabase 연결 실패", "warn");
  }
}

function getDayTypeKey(date) {
  const day = date.getDay();
  if (day === 0) {
    return "sunday";
  }

  if (day === 6) {
    return "saturday";
  }

  return "weekday";
}

function getScheduleForDate(date) {
  const source = window.REAL_TIMETABLE || fallbackSchedule;
  const key = getDayTypeKey(date);
  return source?.schedules?.[key] || source;
}

function getReferenceMinutes() {
  const selected = new Date(els.baseTime.value);
  if (Number.isNaN(selected.getTime())) {
    return state.referenceTime.getHours() * 60 + state.referenceTime.getMinutes();
  }

  state.referenceTime = selected;
  return selected.getHours() * 60 + selected.getMinutes();
}

function minutesToLabel(minutes) {
  const sameDayMinutes = ((minutes % 1440) + 1440) % 1440;
  const hours = Math.floor(sameDayMinutes / 60);
  const mins = sameDayMinutes % 60;
  const period = hours < 12 ? "오전" : "오후";
  const hour12 = hours % 12 || 12;
  return `${period} ${hour12}:${pad(mins)}`;
}

function computeRoute(route, referenceMinutes) {
  let bestPlan = null;

  function search(legIndex, earliestMinutes, currentPlan) {
    if (legIndex >= route.legs.length) {
      const firstDeparture = currentPlan[0]?.departure ?? null;
      const lastArrival = currentPlan[currentPlan.length - 1]?.arrival ?? null;
      const plan = {
        feasible: true,
        chosenDeparture: firstDeparture,
        lastArrival,
        steps: [...currentPlan],
      };

      if (!bestPlan || firstDeparture > bestPlan.chosenDeparture) {
        bestPlan = plan;
      }
      return;
    }

    const leg = route.legs[legIndex];
    const candidates = leg.departures
      .map((value) => parseClock(value))
      .sort((a, b) => a - b)
      .filter((minutes) => minutes >= earliestMinutes);

    for (const departure of candidates) {
      const arrival = departure + leg.travelMinutes;
      const nextEarliest =
        legIndex === route.legs.length - 1
          ? arrival
          : arrival + TRANSFER_MINUTES + WALK_MINUTES;

      search(legIndex + 1, nextEarliest, [
        ...currentPlan,
        {
          title: `${leg.from} → ${leg.to}`,
          departure,
          arrival,
          detail: `${minutesToLabel(departure)} 출발, ${minutesToLabel(arrival)} 도착 · ${leg.line} ${leg.direction}`,
        },
      ]);
    }
  }

  search(0, referenceMinutes, []);

  if (!bestPlan) {
    return {
      feasible: false,
      chosenDeparture: null,
      lastArrival: null,
      steps: route.legs.map((leg) => ({
        title: `${leg.from} → ${leg.to}`,
        detail: "오늘 시간표에서 이어지는 막차를 찾지 못했어요.",
      })),
      bufferMinutes: null,
    };
  }

  return {
    feasible: true,
    chosenDeparture: bestPlan.chosenDeparture,
    lastArrival: bestPlan.lastArrival,
    steps: bestPlan.steps,
    bufferMinutes: null,
  };
}

function createTimelineMarkup(route, result) {
  return route.legs
    .map((leg, index) => {
      const step = result.steps[index];
      return `
        <div class="timeline-step">
          <div class="timeline-rail">
            <div class="node"></div>
          </div>
          <div class="timeline-body">
            <strong>${leg.from} → ${leg.to}</strong>
            <span>${step.detail}</span>
          </div>
        </div>
      `;
    })
    .join("");
}

function applyResult(prefix, result) {
  const departureEl = els[`${prefix}Departure`];
  const arrivalEl = els[`${prefix}Arrival`];
  const statusEl = els[`${prefix}Status`];

  if (!result.feasible) {
    departureEl.textContent = "-";
    arrivalEl.textContent = "-";
    statusEl.textContent = "막차 없음";
    statusEl.className = "warn";
    return;
  }

  departureEl.textContent = minutesToLabel(result.chosenDeparture);
  arrivalEl.textContent = minutesToLabel(result.lastArrival);
  statusEl.textContent = "막차 확인";
  statusEl.className = "good";
}

function render() {
  const referenceMinutes = getReferenceMinutes();
  const schedule = mergeScheduleData(getScheduleForDate(state.referenceTime));
  state.schedule = schedule;
  const outbound = computeRoute(schedule.routes[0], referenceMinutes);
  const inbound = computeRoute(schedule.routes[1], referenceMinutes);

  els.timelineOutbound.innerHTML = createTimelineMarkup(
    state.schedule.routes[0],
    outbound,
  );
  els.timelineInbound.innerHTML = createTimelineMarkup(
    state.schedule.routes[1],
    inbound,
  );

  applyResult("outbound", outbound);
  applyResult("inbound", inbound);
}

function hydrateForm() {
  syncReferenceTime(state.referenceTime);
  setSyncStatus("Supabase 연결 대기 중");
}

els.baseTime.addEventListener("change", () => {
  const selected = new Date(els.baseTime.value);
  if (!Number.isNaN(selected.getTime())) {
    state.referenceTime = selected;
  }
  render();
});

els.nowTime.addEventListener("click", () => {
  syncReferenceTime(new Date());
  render();
  void persistReferenceEvent("current_time");
});

els.recalc.addEventListener("click", () => {
  render();
  void persistReferenceEvent("recalc");
});

hydrateForm();
initGoogleAnalytics(getSupabaseConfig().gaMeasurementId);
render();

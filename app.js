const TRANSFER_MINUTES = 4;
const WALK_MINUTES = 5;
const DAY_MINUTES = 24 * 60;
const MAX_TRANSFER_WAIT_MINUTES = 60;

const STATIONS = {
  skku: "성균관대역",
  hyehwa: "혜화역",
};

const ROUTE_TEMPLATES = {
  outbound: {
    id: "outbound",
    origin: "skku",
    destination: "hyehwa",
    label: "성균관대역 → 혜화역",
    direction: "1호선 → 4호선",
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
        direction: "혜화 방면",
        travelMinutes: 29,
        departures: ["23:07", "23:20", "23:36", "23:51", "00:06", "00:16", "00:31"],
      },
    ],
  },
  inbound: {
    id: "inbound",
    origin: "hyehwa",
    destination: "skku",
    label: "혜화역 → 성균관대역",
    direction: "4호선 → 1호선",
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
        direction: "수원/광운대 방면",
        travelMinutes: 16,
        departures: ["23:03", "23:17", "23:32", "23:48", "00:02", "00:18", "00:33"],
      },
    ],
  },
};

const fallbackSchedule = {
  schedules: {
    weekday: { routes: [ROUTE_TEMPLATES.outbound, ROUTE_TEMPLATES.inbound] },
    saturday: { routes: [ROUTE_TEMPLATES.outbound, ROUTE_TEMPLATES.inbound] },
    sunday: { routes: [ROUTE_TEMPLATES.outbound, ROUTE_TEMPLATES.inbound] },
  },
};

const state = {
  referenceTime: new Date(),
  schedule: null,
  routeKey: null,
  origin: null,
  destination: null,
  renderTimer: null,
};

const els = {
  routePicker: document.getElementById("route-picker"),
  routeForm: document.getElementById("route-form"),
  originStation: document.getElementById("origin-station"),
  destinationStation: document.getElementById("destination-station"),
  pickerStatus: document.getElementById("picker-status"),
  mainContent: document.getElementById("main-content"),
  editRoute: document.getElementById("edit-route"),
  countdownValue: document.getElementById("countdown-value"),
  countdownLabel: document.getElementById("countdown-label"),
  routeSummary: document.getElementById("route-summary"),
  routeTitle: document.getElementById("route-title"),
  routeDirection: document.getElementById("route-direction"),
  timeline: document.getElementById("timeline"),
  routeDeparture: document.getElementById("route-departure"),
  routeArrival: document.getElementById("route-arrival"),
  routeStatus: document.getElementById("route-status"),
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

function trackGoogleAnalyticsEvent(eventName, params = {}) {
  if (typeof window.gtag !== "function") {
    return;
  }

  window.gtag("event", eventName, params);
}

function formatInputDate(date) {
  const tzOffset = date.getTimezoneOffset() * 60000;
  const local = new Date(date.getTime() - tzOffset);
  return local.toISOString().slice(0, 16);
}

async function persistSelectionEvent(actionType, details = {}) {
  const { url, anonKey } = getSupabaseConfig();
  if (!url || !anonKey) {
    return;
  }

  const now = new Date();
  const endpoint = `${url.replace(/\/$/, "")}/rest/v1/rpc/log_reference_time_event`;
  const fallbackEndpoint = `${url.replace(/\/$/, "")}/rest/v1/reference_time_events`;
  const payload = {
    p_action_type: actionType,
    p_reference_time: now.toISOString(),
    p_local_reference_time: formatInputDate(now),
    p_day_type: getDayTypeKey(now),
    p_source: "web",
    p_origin_station: details.originStation || null,
    p_destination_station: details.destinationStation || null,
    p_route_key: details.routeKey || null,
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

    if (!response.ok && response.status === 404) {
      await fetch(fallbackEndpoint, {
        method: "POST",
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          action_type: actionType,
          reference_time: now.toISOString(),
          local_reference_time: formatInputDate(now),
          day_type: getDayTypeKey(now),
          source: "web",
          origin_station: details.originStation || null,
          destination_station: details.destinationStation || null,
          route_key: details.routeKey || null,
        }),
      });
    }
  } catch {
    // Ignore analytics/storage failures.
  }
}

function trackStationSelection(role, station) {
  if (!station) {
    return;
  }

  const eventName = `${role}_selected_${station}`;
  trackGoogleAnalyticsEvent(eventName, {
    event_category: "route",
    event_label: station,
  });
}

function setPickerStatus(message, tone = "muted") {
  els.pickerStatus.textContent = message;
  els.pickerStatus.className = `picker-status ${tone}`;
}

function pad(num) {
  return String(num).padStart(2, "0");
}

function parseClock(value) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function getDayTypeKey(date) {
  const day = date.getDay();
  if (day === 0) return "sunday";
  if (day === 6) return "saturday";
  return "weekday";
}

function getScheduleForDate(date) {
  const source = window.REAL_TIMETABLE || fallbackSchedule;
  const key = getDayTypeKey(date);
  return source?.schedules?.[key] || fallbackSchedule.schedules.weekday;
}

function getRouteKey(origin, destination) {
  if (origin === "skku" && destination === "hyehwa") return "outbound";
  if (origin === "hyehwa" && destination === "skku") return "inbound";
  return null;
}

function getRouteMeta(routeKey) {
  return ROUTE_TEMPLATES[routeKey] || null;
}

function applyStationConstraints() {
  const origin = els.originStation.value;
  const destination = els.destinationStation.value;

  if (origin && destination && origin === destination) {
    if (document.activeElement === els.originStation) {
      els.destinationStation.value = "";
    } else {
      els.originStation.value = "";
    }
    setPickerStatus("출발지와 목적지는 서로 다르게 선택해 주세요.", "warn");
  }

  [...els.originStation.options].forEach((option) => {
    option.disabled = option.value !== "" && option.value === destination;
  });

  [...els.destinationStation.options].forEach((option) => {
    option.disabled = option.value !== "" && option.value === origin;
  });
}

function showMainContent() {
  els.routePicker.hidden = true;
  els.mainContent.hidden = false;
  window.scrollTo({ top: 0, behavior: "auto" });
}

function showPicker() {
  els.routePicker.hidden = false;
  els.mainContent.hidden = true;
  window.scrollTo({ top: 0, behavior: "auto" });

  state.referenceTime = new Date();
  state.schedule = null;
  state.routeKey = null;
  state.origin = null;
  state.destination = null;
  els.originStation.value = "";
  els.destinationStation.value = "";
  setPickerStatus("", "muted");
  updateCountdownDisplay(null);
}

function minutesToLabel(minutes) {
  const normalized = ((minutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  const hours = Math.floor(normalized / 60);
  const mins = normalized % 60;
  const period = hours < 12 ? "오전" : "오후";
  const hour12 = hours % 12 || 12;
  const prefix = minutes >= DAY_MINUTES ? "익일 " : "";
  return `${prefix}${period} ${hour12}:${pad(mins)}`;
}

function mergeRouteData(sourceRoute, templateRoute) {
  return {
    ...templateRoute,
    ...(sourceRoute || {}),
    legs: templateRoute.legs.map((templateLeg, legIndex) => ({
      ...templateLeg,
      ...(sourceRoute?.legs?.[legIndex] || {}),
      departures: sourceRoute?.legs?.[legIndex]?.departures || templateLeg.departures,
    })),
  };
}

function getSelectedRoute(date, routeKey) {
  const schedule = getScheduleForDate(date);
  const routeIndex = routeKey === "outbound" ? 0 : 1;
  const sourceRoute = schedule?.routes?.[routeIndex] || {};
  const templateRoute = ROUTE_TEMPLATES[routeKey];
  return mergeRouteData(sourceRoute, templateRoute);
}

function getSameDayCandidates(departures, earliestMinutes = 0) {
  return [...new Set(departures.map((value) => parseClock(value)))].filter(
    (minutes) => minutes >= earliestMinutes && minutes < DAY_MINUTES,
  );
}

function getConnectionCandidates(departures, earliestMinutes = 0) {
  const latestAllowed = earliestMinutes + MAX_TRANSFER_WAIT_MINUTES;

  return [...new Set(departures.flatMap((value) => {
    const base = parseClock(value);
    return [base, base + DAY_MINUTES];
  }))].filter((minutes) => minutes >= earliestMinutes && minutes <= latestAllowed);
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
    const candidates =
      legIndex === 0
        ? getSameDayCandidates(leg.departures, earliestMinutes)
        : getConnectionCandidates(leg.departures, earliestMinutes).sort((a, b) => a - b);

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
        detail: "현재 시간 기준으로 이어지는 막차를 찾지 못했습니다.",
      })),
    };
  }

  return bestPlan;
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

function formatCountdown(targetDeparture) {
  if (targetDeparture == null) {
    return { value: "-", label: "-" };
  }

  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  const diff = targetDeparture - nowMinutes;

  if (diff <= 0) {
    return { value: "막차 종료", label: "오늘 막차가 지났습니다" };
  }

  const totalSeconds = Math.round(diff * 60);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const value = `${hours > 0 ? `${hours}시간 ` : ""}${pad(minutes)}분 ${pad(seconds)}초`;
  const label = hours > 0 ? "남은 시간" : "곧 막차가 출발합니다";

  return { value, label };
}

function updateCountdownDisplay(targetDeparture) {
  if (!els.countdownValue || !els.countdownLabel) {
    return;
  }

  const { value, label } = formatCountdown(targetDeparture);
  els.countdownValue.textContent = value;
  els.countdownLabel.textContent = label;
}

function applyResult(result) {
  if (!result.feasible) {
    els.routeDeparture.textContent = "-";
    els.routeArrival.textContent = "-";
    els.routeStatus.textContent = "막차 없음";
    els.routeStatus.className = "warn";
    updateCountdownDisplay(null);
    return;
  }

  els.routeDeparture.textContent = minutesToLabel(result.chosenDeparture);
  els.routeArrival.textContent = minutesToLabel(result.lastArrival);
  els.routeStatus.textContent = "막차 확인";
  els.routeStatus.className = "good";
  updateCountdownDisplay(result.chosenDeparture);
}

function renderSelectedRoute() {
  if (!state.routeKey) {
    return;
  }

  const now = new Date();
  state.referenceTime = now;
  const referenceMinutes = now.getHours() * 60 + now.getMinutes();
  const routeMeta = getRouteMeta(state.routeKey);
  const route = getSelectedRoute(now, state.routeKey);

  state.schedule = route;
  const result = computeRoute(route, referenceMinutes);

  els.routeSummary.textContent = "환승시간까지 고려한 막차시간";
  els.routeTitle.textContent = "막차 정보";
  els.routeDirection.textContent = routeMeta.direction;
  els.timeline.innerHTML = createTimelineMarkup(route, result);
  applyResult(result);
}

function startRoute(origin, destination, options = {}) {
  const routeKey = getRouteKey(origin, destination);
  if (!routeKey) {
    setPickerStatus("출발지와 목적지는 서로 다르게 선택해 주세요.", "warn");
    return false;
  }

  state.origin = origin;
  state.destination = destination;
  state.routeKey = routeKey;
  setPickerStatus("", "muted");
  showMainContent();
  renderSelectedRoute();
  trackStationSelection("origin", origin);
  trackStationSelection("destination", destination);
  void persistSelectionEvent("route_submit", {
    originStation: origin,
    destinationStation: destination,
    routeKey,
  });

  if (options.track !== false) {
    trackGoogleAnalyticsEvent("route_selected", {
      event_category: "route",
      event_label: `${origin}_to_${destination}`,
    });
  }

  return true;
}

function hydrateRouteSelection() {
  showPicker();
}

function startRenderLoop() {
  if (state.renderTimer) {
    clearInterval(state.renderTimer);
  }

  state.renderTimer = window.setInterval(() => {
    if (state.routeKey && !els.mainContent.hidden) {
      renderSelectedRoute();
    }
  }, 1000);
}

els.originStation.addEventListener("change", () => {
  applyStationConstraints();
});

els.destinationStation.addEventListener("change", () => {
  applyStationConstraints();
});

els.routeForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const origin = els.originStation.value;
  const destination = els.destinationStation.value;

  if (!origin || !destination) {
    setPickerStatus("출발지와 목적지를 모두 선택해 주세요.", "warn");
    return;
  }

  startRoute(origin, destination);
});

els.editRoute.addEventListener("click", () => {
  trackGoogleAnalyticsEvent("back_to_picker", {
    event_category: "navigation",
    event_label: "back_to_picker",
  });
  void persistSelectionEvent("back_to_picker", {
    originStation: state.origin,
    destinationStation: state.destination,
    routeKey: state.routeKey,
  });
  showPicker();
});

initGoogleAnalytics(getSupabaseConfig().gaMeasurementId);
hydrateRouteSelection();
startRenderLoop();

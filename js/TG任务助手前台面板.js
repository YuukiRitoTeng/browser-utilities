// ==UserScript==
// @name         TG任务助手前台面板
// @namespace    tg-task-monitor-ui
// @version      3.4
// @updateURL    https://raw.githubusercontent.com/YuukiRitoTeng/browser-utilities/main/js/TG任务助手前台面板.js
// @downloadURL  https://raw.githubusercontent.com/YuukiRitoTeng/browser-utilities/main/js/TG任务助手前台面板.js
// @description  读取 TG任务状态后台扫描器 的共享结果，在 TG 页面右下角显示任务助手抽屉
// @author       Mea
// @match        https://tg.zcst.edu.cn/*
// @match        https://www.educoder.net/*
// @match        http://172.16.36.150/*
// @storageName  tg-exam-monitor-shared
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const MANUAL_LOGIN = "";
  const TG_INTRANET_HOST = "172.16.36.150";
  const TG_INTRANET_ORIGIN = "http://172.16.36.150";
  const TG_EXTERNAL_ORIGIN = "https://tg.zcst.edu.cn";

  const STORE_KEY = "TG_EXAM_MONITOR_RESULT";
  const STORE_KEY_TG_RESULT = "TG_EXAM_MONITOR_TG_RESULT";
  const STORE_KEY_EDUCODER_RESULT = "TG_EXAM_MONITOR_EDUCODER_RESULT";
  const STORE_KEY_LAST_ERROR = "TG_EXAM_MONITOR_LAST_ERROR";
  const STORE_KEY_LAST_RUNNING = "TG_EXAM_MONITOR_LAST_RUNNING";
  const STORE_KEY_FILTER_YEAR_MONTH = "TG_TASK_FILTER_YEAR_MONTH";
  const STORE_KEY_AUTO_LOGIN = "TG_TASK_MONITOR_AUTO_LOGIN";
  const STORE_KEY_COURSE_COLLAPSE = "TG_TASK_COURSE_COLLAPSE";
  const STORE_KEY_SECTION_COLLAPSE = "TG_TASK_SECTION_COLLAPSE";
  const STORE_KEY_PANEL_STATE = "TG_TASK_PANEL_STATE";
  const STORE_KEY_REFRESH_REQUEST = "TG_TASK_ASSISTANT_REFRESH_REQUEST";
  const STORE_KEY_REFRESH_STATUS = "TG_TASK_ASSISTANT_REFRESH_STATUS";
  const STORE_KEY_REFRESH_HANDLED = "TG_TASK_REFRESH_HANDLED";
  const STORE_KEY_SEMESTER_SETTINGS = "TG_TASK_SEMESTER_SETTINGS";
  const STORE_KEY_IGNORED_TASKS = "TG_TASK_ASSISTANT_IGNORED_TASKS";
  const STORE_KEY_PINNED_COURSES = "TG_TASK_ASSISTANT_PINNED_COURSES";
  const STORE_KEY_LAUNCHER_SETTINGS = "TG_TASK_ASSISTANT_LAUNCHER_SETTINGS";
  const STORE_KEY_SHORTCUT = "TG_TASK_ASSISTANT_SHORTCUT";
  const STORE_KEY_LATENCY = "TG_TASK_ASSISTANT_LATENCY";
  const STORE_KEY_PENDING_TASK_NAVIGATION = "TG_TASK_ASSISTANT_PENDING_TASK_NAVIGATION";
  const STORE_KEY_AUTO_OPEN_SETTINGS = "TG_TASK_ASSISTANT_AUTO_OPEN_SETTINGS";
  const DANGER_DAYS_THRESHOLD = 10;
  const DANGER_NOTIFY_KEY = "TG_TASK_ASSISTANT_DANGER_NOTIFY_KEY";

  const ROOT_ID = "__tg_task_assistant_root__";
  const BUTTON_ID = "__tg_task_assistant_button__";
  const DRAWER_ID = "__tg_task_assistant_drawer__";
  const SVG_FILTER_ID = "__tg_liquid_glass_filter__";
  const FILTER_KEY = "TG_TASK_ASSISTANT_FILTER";
  const COURSE_FOCUS_KEY = "TG_TASK_ASSISTANT_COURSE_FOCUS";
  let countdownIntervalId = null;
  let pollTimerId = null;
  let resizeObserverAttached = false;
  let cacheDeletedNotice = "";
  let latestResultLogin = "";
  let jumpTaskRegistry = new Map();
  let jumpTaskSeq = 0;
  let pollWasRunning = false;
  let latestRenderedScanTimestamp = 0;
  let resizeApplyTimer = null;
  let activeRefreshRequestId = "";
  let activeRefreshStartedAt = 0;
  let lastLoggedRefreshStatusKey = "";
  let panelAutoRefreshTimerId = null;
  let panelAutoRefreshRequested = false;
  let latestTaskRegistry = new Map();
  let hasLoggedTaskKeySample = false;
  let hasLoggedDeadlineSample = false;
  let resizeObserver = null;
  let fullscreenListenerAttached = false;
  let visibilityListenerAttached = false;
  let shortcutListenerAttached = false;
  let shortcutCaptureActive = false;
  let launcherIdleTimerId = null;
  let latencyTestSerial = 0;
  let latestLatencyState = null;
  let initialLatencyTestRequested = false;
  let suppressNextLauncherClick = false;
  let lastRefreshDebugSignature = "";
  let adaptiveBackdropMode = "neutral";
  let adaptiveCandidateMode = "neutral";
  let adaptiveCandidateHits = 0;
  let adaptiveCandidateSince = 0;
  let adaptiveDetectTimerId = null;
  let adaptiveScrollTimerId = null;
  let adaptiveListenersAttached = false;
  let pendingNavigationResolvePromise = null;
  const sameParentNavigationFlights = new Map();
  let pageOpen = false;
  let initialHydrationTraceActive = true;
  const initialHydrationTraceOnce = new Set();
  const LAUNCHER_IDLE_MS = 11000;
  const LAUNCHER_DRAG_THRESHOLD = 7;
  const INITIAL_HYDRATION_TIMEOUT_MS = 8000;
  const DEFAULT_LAUNCHER_SETTINGS = {
    size: "auto",
    visualMode: "auto",
    locked: false,
    y: null
  };
  const PANEL_AUTO_REFRESH_DELAY_MS = 2000;

  function logInitialHydrationCheckpoint(label, details = {}) {
    if (!initialHydrationTraceActive || initialHydrationTraceOnce.has(label)) return;
    initialHydrationTraceOnce.add(label);
    console.info("[TG init]", label, {
      performanceNow: Math.round(performance.now() * 100) / 100,
      ...details
    });
  }

  function logInitialStorageCheckpoint(key, api, phase, details = {}) {
    if (!initialHydrationTraceActive) return;
    console.info("[TG storage]", {
      key,
      api,
      phase,
      ...details
    });
  }

  async function withInitialHydrationTimeout(promise) {
    let timeoutId = null;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error("初始化状态读取超时")), INITIAL_HYDRATION_TIMEOUT_MS);
        })
      ]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  const css = `
    #${BUTTON_ID}, #${DRAWER_ID} {
      --tg-cyan: #67e8f9;
      --tg-cyan-soft: rgba(103, 232, 249, .22);
      --tg-violet: #8b5cf6;
      --tg-violet-soft: rgba(139, 92, 246, .2);
      --tg-pink: #f0abfc;
      --tg-pink-soft: rgba(240, 171, 252, .18);
      --tg-red: #fb7185;
      --tg-amber: #fbbf24;
      --tg-green: #86efac;
      --tg-text: rgba(244, 247, 251, .94);
      --tg-muted: rgba(203, 213, 225, .68);
      --tg-faint: rgba(148, 163, 184, .48);
      --tg-glass: rgba(12, 18, 30, .64);
      --tg-glass-strong: rgba(15, 23, 42, .76);
      --tg-line: rgba(148, 227, 255, .18);
      font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, "Microsoft YaHei", sans-serif;
      color: var(--tg-text);
      box-sizing: border-box;
      letter-spacing: 0;
    }

    #${BUTTON_ID} *, #${DRAWER_ID} * {
      box-sizing: border-box;
      letter-spacing: 0;
    }

    #${BUTTON_ID} {
      position: fixed;
      right: 22px;
      bottom: 24px;
      z-index: 2147483646;
      width: 62px;
      height: 62px;
      border: 1px solid rgba(103, 232, 249, .34);
      border-radius: 50%;
      background:
        radial-gradient(circle at 32% 24%, rgba(255,255,255,.34), transparent 24%),
        radial-gradient(circle at 70% 76%, rgba(139,92,246,.34), transparent 34%),
        linear-gradient(145deg, rgba(12,18,30,.82), rgba(8,12,22,.66));
      color: rgba(242, 251, 255, .96);
      box-shadow:
        0 22px 52px rgba(0, 0, 0, .44),
        0 0 34px rgba(103, 232, 249, .18),
        inset 0 1px 0 rgba(255,255,255,.24),
        inset 0 -18px 42px rgba(139,92,246,.12);
      backdrop-filter: blur(22px) saturate(145%);
      -webkit-backdrop-filter: blur(22px) saturate(145%);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: 760;
      line-height: 1.16;
      text-align: center;
      overflow: visible;
      user-select: none;
      touch-action: none;
      transition: transform .38s cubic-bezier(.16, 1, .3, 1), border-color .38s ease, box-shadow .38s ease;
      animation: tgFloatButton 7s ease-in-out infinite;
    }

    #${BUTTON_ID}::before {
      content: "";
      position: absolute;
      inset: -9px;
      border-radius: inherit;
      background: conic-gradient(from 140deg, transparent, rgba(103,232,249,.22), transparent, rgba(240,171,252,.16), transparent);
      filter: blur(12px);
      opacity: .7;
      z-index: -1;
    }

    #${BUTTON_ID}:hover {
      transform: translateY(-4px) scale(1.035);
      border-color: rgba(103, 232, 249, .62);
      box-shadow:
        0 28px 70px rgba(0, 0, 0, .52),
        0 0 48px rgba(103, 232, 249, .26),
        0 0 58px rgba(139, 92, 246, .16),
        inset 0 1px 0 rgba(255,255,255,.32);
    }

    #${BUTTON_ID} .tg-task-button-badge {
      position: absolute;
      right: -4px;
      top: -5px;
      min-width: 22px;
      height: 22px;
      padding: 0 6px;
      border-radius: 999px;
      border: 1px solid rgba(255,255,255,.44);
      background: linear-gradient(135deg, rgba(251,113,133,.94), rgba(240,171,252,.74));
      color: #fff;
      font-size: 11px;
      line-height: 20px;
      box-shadow: 0 0 20px rgba(251,113,133,.34);
    }

    #${DRAWER_ID} {
      position: fixed;
      right: 18px;
      top: 18px;
      z-index: 2147483647;
      width: min(520px, calc(100vw - 28px));
      height: min(760px, calc(100vh - 48px));
      min-width: 390px;
      min-height: 480px;
      max-width: calc(100vw - 40px);
      max-height: calc(100vh - 40px);
      resize: both;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border-radius: 30px;
      color: var(--tg-text);
      background:
        linear-gradient(145deg, rgba(14, 21, 36, .72), rgba(6, 10, 18, .68)),
        radial-gradient(circle at 18% 0%, rgba(103,232,249,.12), transparent 38%),
        radial-gradient(circle at 92% 8%, rgba(139,92,246,.16), transparent 42%);
      border: 1px solid rgba(160, 231, 255, .2);
      box-shadow:
        -34px 28px 90px rgba(0,0,0,.56),
        0 0 0 1px rgba(255,255,255,.035) inset,
        0 0 56px rgba(103,232,249,.12),
        0 0 88px rgba(139,92,246,.1);
      backdrop-filter: blur(34px) saturate(150%);
      -webkit-backdrop-filter: blur(34px) saturate(150%);
      transform: translateX(calc(100% + 38px)) scale(.985);
      opacity: .42;
      transition:
        transform .58s cubic-bezier(.16, 1, .3, 1),
        opacity .38s ease,
        box-shadow .45s ease;
    }

    #${DRAWER_ID}.tg-open {
      transform: translateX(0) scale(1);
      opacity: 1;
    }

    #${DRAWER_ID}::before {
      content: "";
      position: absolute;
      inset: 0;
      pointer-events: none;
      background-image:
        radial-gradient(circle at 14% 16%, rgba(103,232,249,.22) 0 1px, transparent 2px),
        radial-gradient(circle at 84% 22%, rgba(240,171,252,.18) 0 1px, transparent 2px),
        radial-gradient(circle at 64% 74%, rgba(139,92,246,.16) 0 1px, transparent 2px),
        linear-gradient(rgba(255,255,255,.035) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,.024) 1px, transparent 1px);
      background-size: 128px 128px, 184px 184px, 148px 148px, 44px 44px, 44px 44px;
      mask-image: linear-gradient(to bottom, rgba(0,0,0,.92), rgba(0,0,0,.26));
      opacity: .42;
      animation: tgParticleDrift 22s linear infinite;
    }

    #${DRAWER_ID}::after {
      content: "";
      position: absolute;
      inset: 1px;
      pointer-events: none;
      border-radius: 29px;
      background:
        linear-gradient(135deg, rgba(255,255,255,.18), transparent 24%),
        linear-gradient(315deg, rgba(103,232,249,.1), transparent 28%),
        radial-gradient(circle at 78% 14%, rgba(240,171,252,.12), transparent 34%);
      mix-blend-mode: screen;
      opacity: .55;
    }

    #${DRAWER_ID} .tg-ambient {
      position: absolute;
      inset: 0;
      overflow: hidden;
      pointer-events: none;
      z-index: 0;
    }

    #${DRAWER_ID} .tg-orb,
    #${DRAWER_ID} .tg-ring {
      position: absolute;
      display: block;
      border-radius: 999px;
      filter: blur(.2px);
      opacity: .7;
      transform: translate3d(0,0,0);
    }

    #${DRAWER_ID} .tg-orb-a {
      width: 150px;
      height: 150px;
      right: -42px;
      top: 70px;
      background: radial-gradient(circle at 34% 30%, rgba(255,255,255,.38), rgba(103,232,249,.18) 28%, rgba(103,232,249,.04) 68%, transparent 74%);
      filter: blur(1px);
      animation: tgSlowFloatA 15s ease-in-out infinite;
    }

    #${DRAWER_ID} .tg-orb-b {
      width: 92px;
      height: 92px;
      left: 32px;
      bottom: 92px;
      background: radial-gradient(circle at 34% 28%, rgba(255,255,255,.25), rgba(240,171,252,.18) 38%, transparent 72%);
      filter: blur(1.5px);
      animation: tgSlowFloatB 18s ease-in-out infinite;
    }

    #${DRAWER_ID} .tg-ring-a {
      width: 178px;
      height: 178px;
      left: -78px;
      top: 178px;
      border: 1px solid rgba(103,232,249,.16);
      box-shadow: inset 0 0 34px rgba(103,232,249,.08), 0 0 30px rgba(139,92,246,.08);
      transform: rotate(-18deg);
      animation: tgRingDrift 21s ease-in-out infinite;
    }

    #${DRAWER_ID} .tg-header,
    #${DRAWER_ID} .tg-body,
    #${DRAWER_ID} .tg-actions {
      position: relative;
      z-index: 1;
    }

    #${DRAWER_ID} .tg-header {
      flex: 0 0 auto;
      min-height: 78px;
      padding: 18px 18px 14px;
      border-bottom: 1px solid rgba(148, 227, 255, .13);
      background: linear-gradient(180deg, rgba(255,255,255,.055), rgba(255,255,255,.018));
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
    }

    #${DRAWER_ID} .tg-title {
      min-width: 0;
    }

    #${DRAWER_ID} .tg-title-main {
      font-size: 22px;
      font-weight: 760;
      line-height: 1.15;
      color: rgba(248, 250, 252, .98);
      text-shadow: 0 0 22px rgba(103,232,249,.12);
    }

    #${DRAWER_ID} .tg-title-sub {
      margin-top: 6px;
      color: var(--tg-muted);
      font-size: 12px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    #${DRAWER_ID} .tg-header-actions {
      display: flex;
      gap: 8px;
      flex: 0 0 auto;
    }

    #${DRAWER_ID} .tg-icon-btn {
      width: 34px;
      height: 34px;
      border: 1px solid rgba(148, 227, 255, .18);
      background: rgba(255,255,255,.055);
      color: rgba(235, 245, 255, .9);
      border-radius: 12px;
      cursor: pointer;
      font-size: 13px;
      line-height: 32px;
      text-align: center;
      box-shadow: inset 0 1px 0 rgba(255,255,255,.12);
      transition: transform .28s cubic-bezier(.16, 1, .3, 1), border-color .28s ease, background .28s ease, box-shadow .28s ease;
    }

    #${DRAWER_ID} .tg-icon-btn:hover {
      transform: translateY(-2px);
      border-color: rgba(103,232,249,.44);
      background: rgba(103,232,249,.09);
      box-shadow: 0 0 22px rgba(103,232,249,.12), inset 0 1px 0 rgba(255,255,255,.18);
    }

    #${DRAWER_ID} .tg-top-refresh {
      width: auto;
      min-width: 74px;
      padding: 0 11px;
      font-size: 12px;
      white-space: nowrap;
    }

    #${DRAWER_ID} .tg-body {
      flex: 1 1 auto;
      overflow-y: auto;
      padding: 16px;
      scrollbar-width: thin;
      scrollbar-color: rgba(103,232,249,.28) transparent;
    }

    #${DRAWER_ID} .tg-body::-webkit-scrollbar {
      width: 9px;
    }

    #${DRAWER_ID} .tg-body::-webkit-scrollbar-thumb {
      background: rgba(103,232,249,.2);
      border: 3px solid transparent;
      border-radius: 999px;
      background-clip: padding-box;
    }

    #${DRAWER_ID} .tg-meta,
    #${DRAWER_ID} .tg-alert,
    #${DRAWER_ID} .tg-empty,
    #${DRAWER_ID} .tg-date-filter,
    #${DRAWER_ID} .tg-summary-item,
    #${DRAWER_ID} .tg-card {
      position: relative;
      overflow: hidden;
      border: 1px solid rgba(148, 227, 255, .15);
      background:
        linear-gradient(145deg, rgba(255,255,255,.09), rgba(255,255,255,.035)),
        rgba(8, 13, 24, .42);
      box-shadow:
        0 18px 42px rgba(0,0,0,.25),
        inset 0 1px 0 rgba(255,255,255,.09),
        inset 0 -1px 0 rgba(255,255,255,.035);
      backdrop-filter: blur(20px) saturate(145%);
      -webkit-backdrop-filter: blur(20px) saturate(145%);
    }

    #${DRAWER_ID} .tg-meta::before,
    #${DRAWER_ID} .tg-alert::before,
    #${DRAWER_ID} .tg-empty::before,
    #${DRAWER_ID} .tg-date-filter::before,
    #${DRAWER_ID} .tg-summary-item::before,
    #${DRAWER_ID} .tg-card::before {
      content: "";
      position: absolute;
      inset: 0;
      pointer-events: none;
      background-image:
        radial-gradient(circle at 18% 0%, rgba(255,255,255,.12), transparent 34%),
        repeating-linear-gradient(0deg, rgba(255,255,255,.025) 0 1px, transparent 1px 4px);
      opacity: .38;
      mix-blend-mode: screen;
    }

    #${DRAWER_ID} .tg-meta,
    #${DRAWER_ID} .tg-alert,
    #${DRAWER_ID} .tg-empty {
      border-radius: 22px;
      padding: 14px;
      margin-bottom: 12px;
      color: var(--tg-muted);
      font-size: 12px;
      line-height: 1.65;
    }

    #${DRAWER_ID} .tg-meta {
      padding: 15px;
    }

    #${DRAWER_ID} .tg-refresh-status {
      border-radius: 20px;
      padding: 12px;
      margin-bottom: 12px;
      border: 1px solid rgba(148, 227, 255, .14);
      background:
        linear-gradient(145deg, rgba(255,255,255,.075), rgba(255,255,255,.025)),
        rgba(8, 13, 24, .38);
      box-shadow: 0 16px 36px rgba(0,0,0,.22), inset 0 1px 0 rgba(255,255,255,.08);
      backdrop-filter: blur(18px) saturate(140%);
      -webkit-backdrop-filter: blur(18px) saturate(140%);
    }

    #${DRAWER_ID} .tg-refresh-row {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 9px;
    }

    #${DRAWER_ID} .tg-refresh-title {
      color: rgba(245,250,255,.92);
      font-size: 12px;
      font-weight: 760;
    }

    #${DRAWER_ID} .tg-refresh-stage {
      color: var(--tg-muted);
      font-size: 11px;
      line-height: 1.5;
      overflow-wrap: anywhere;
    }

    #${DRAWER_ID} .tg-progress-track {
      height: 7px;
      overflow: hidden;
      border-radius: 999px;
      border: 1px solid rgba(148, 227, 255, .12);
      background: rgba(255,255,255,.045);
      box-shadow: inset 0 1px 4px rgba(0,0,0,.28);
    }

    #${DRAWER_ID} .tg-progress-fill {
      height: 100%;
      width: 0%;
      border-radius: inherit;
      background: linear-gradient(90deg, rgba(103,232,249,.72), rgba(139,92,246,.62), rgba(240,171,252,.52));
      box-shadow: 0 0 18px rgba(103,232,249,.22);
      transition: width .42s cubic-bezier(.16, 1, .3, 1);
    }

    #${DRAWER_ID} .tg-meta-kicker {
      color: rgba(103,232,249,.86);
      font-size: 11px;
      font-weight: 720;
      margin-bottom: 12px;
    }

    #${DRAWER_ID} .tg-meta-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 9px;
    }

    #${DRAWER_ID} .tg-meta-chip {
      border: 1px solid rgba(148, 227, 255, .12);
      background: rgba(255,255,255,.045);
      border-radius: 16px;
      padding: 9px 10px;
      min-width: 0;
    }

    #${DRAWER_ID} .tg-meta-label {
      display: block;
      color: var(--tg-faint);
      font-size: 11px;
      margin-bottom: 4px;
    }

    #${DRAWER_ID} .tg-meta-value {
      display: block;
      color: var(--tg-text);
      font-size: 12px;
      font-weight: 680;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    #${DRAWER_ID} .tg-alert {
      color: rgba(255, 228, 230, .95);
      background:
        linear-gradient(145deg, rgba(251,113,133,.16), rgba(255,255,255,.035)),
        rgba(40, 9, 20, .34);
      border-color: rgba(251,113,133,.26);
      box-shadow: 0 18px 44px rgba(77, 10, 30, .25), inset 0 1px 0 rgba(255,255,255,.09);
    }

    #${DRAWER_ID} .tg-empty {
      color: rgba(203, 213, 225, .74);
      text-align: center;
      padding: 18px;
    }

    #${DRAWER_ID} .tg-summary {
      display: grid;
      grid-template-columns: repeat(6, minmax(0, 1fr));
      gap: 9px;
      margin-bottom: 12px;
    }

    #${DRAWER_ID} .tg-summary-item {
      min-width: 0;
      width: 100%;
      border-radius: 20px;
      padding: 12px 8px 11px;
      text-align: left;
      cursor: pointer;
      color: inherit;
      font: inherit;
      appearance: none;
      -webkit-appearance: none;
      transition: transform .36s cubic-bezier(.16, 1, .3, 1), border-color .36s ease, box-shadow .36s ease, background .36s ease;
    }

    #${DRAWER_ID} .tg-summary-item:hover {
      transform: translateY(-4px);
      border-color: rgba(103,232,249,.34);
      background:
        linear-gradient(145deg, rgba(103,232,249,.1), rgba(255,255,255,.04)),
        rgba(9, 16, 28, .54);
      box-shadow: 0 24px 54px rgba(0,0,0,.3), 0 0 26px rgba(103,232,249,.1), inset 0 1px 0 rgba(255,255,255,.13);
    }

    #${DRAWER_ID} .tg-summary-item.tg-selected {
      border-color: rgba(103,232,249,.48);
      background:
        linear-gradient(145deg, rgba(103,232,249,.16), rgba(139,92,246,.09)),
        rgba(9, 16, 28, .62);
      box-shadow:
        0 24px 58px rgba(0,0,0,.34),
        0 0 32px rgba(103,232,249,.18),
        0 0 34px rgba(139,92,246,.11),
        inset 0 1px 0 rgba(255,255,255,.15);
    }

    #${DRAWER_ID} .tg-summary-item.tg-selected .tg-summary-num {
      color: rgba(165,243,252,.98);
      text-shadow: 0 0 18px rgba(103,232,249,.18);
    }

    #${DRAWER_ID} .tg-summary-item[data-tooltip]::after {
      content: attr(data-tooltip);
      position: absolute;
      left: 50%;
      bottom: calc(100% + 10px);
      width: min(230px, 72vw);
      transform: translate(-50%, 8px);
      opacity: 0;
      pointer-events: none;
      color: rgba(235,245,255,.94);
      background:
        linear-gradient(145deg, rgba(18, 27, 44, .94), rgba(8, 13, 24, .9)),
        rgba(8, 13, 24, .92);
      border: 1px solid rgba(148, 227, 255, .18);
      border-radius: 12px;
      padding: 8px 10px;
      font-size: 11px;
      line-height: 1.45;
      box-shadow: 0 16px 36px rgba(0,0,0,.38), 0 0 24px rgba(103,232,249,.1), inset 0 1px 0 rgba(255,255,255,.08);
      backdrop-filter: blur(18px) saturate(145%);
      -webkit-backdrop-filter: blur(18px) saturate(145%);
      transition: opacity .22s ease, transform .22s cubic-bezier(.16, 1, .3, 1);
      z-index: 6;
    }

    #${DRAWER_ID} .tg-summary-item[data-tooltip]:hover::after {
      opacity: 1;
      transform: translate(-50%, 0);
    }

    #${DRAWER_ID} .tg-summary-num {
      position: relative;
      font-size: 24px;
      font-weight: 780;
      line-height: 1;
      margin-bottom: 8px;
      color: rgba(248,250,252,.96);
    }

    #${DRAWER_ID} .tg-summary-label {
      position: relative;
      color: var(--tg-muted);
      font-size: 11px;
      white-space: nowrap;
    }

    #${DRAWER_ID} .tg-current-filter {
      margin: -2px 2px 12px;
      color: rgba(203, 213, 225, .76);
      font-size: 12px;
      font-weight: 650;
    }

    #${DRAWER_ID} .tg-current-filter strong {
      color: rgba(165,243,252,.94);
      font-weight: 760;
    }

    #${DRAWER_ID} .tg-date-filter {
      border-radius: 22px;
      padding: 13px;
      margin-bottom: 12px;
    }

    #${DRAWER_ID} .tg-date-filter-row {
      position: relative;
      display: flex;
      align-items: center;
      gap: 8px;
      color: rgba(235,245,255,.9);
      font-size: 12px;
      font-weight: 650;
    }

    #${DRAWER_ID} .tg-time-mark {
      position: relative;
      width: 28px;
      height: 28px;
      flex: 0 0 auto;
      border-radius: 10px;
      border: 1px solid rgba(103,232,249,.22);
      background:
        linear-gradient(180deg, rgba(103,232,249,.14), rgba(139,92,246,.08)),
        rgba(255,255,255,.04);
      box-shadow: 0 0 18px rgba(103,232,249,.1), inset 0 1px 0 rgba(255,255,255,.16);
    }

    #${DRAWER_ID} .tg-time-mark::before,
    #${DRAWER_ID} .tg-time-mark::after {
      content: "";
      position: absolute;
      display: block;
    }

    #${DRAWER_ID} .tg-time-mark::before {
      left: 7px;
      right: 7px;
      top: 8px;
      height: 2px;
      border-radius: 999px;
      background: rgba(103,232,249,.62);
      box-shadow: 0 7px 0 rgba(103,232,249,.2);
    }

    #${DRAWER_ID} .tg-time-mark::after {
      left: 8px;
      top: 6px;
      width: 12px;
      height: 14px;
      border: 1px solid rgba(245,250,255,.28);
      border-radius: 4px;
    }

    #${DRAWER_ID} .tg-date-filter select {
      height: 34px;
      min-width: 84px;
      border: 1px solid rgba(148, 227, 255, .18);
      background: rgba(2, 6, 23, .42);
      color: rgba(245, 250, 255, .94);
      border-radius: 12px;
      padding: 0 10px;
      font-size: 12px;
      outline: none;
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08);
      transition: border-color .24s ease, box-shadow .24s ease, background .24s ease;
    }

    #${DRAWER_ID} .tg-date-filter select:focus,
    #${DRAWER_ID} .tg-date-filter select:hover {
      border-color: rgba(103,232,249,.42);
      box-shadow: 0 0 24px rgba(103,232,249,.1), inset 0 1px 0 rgba(255,255,255,.12);
    }

    #${DRAWER_ID} .tg-date-filter select option {
      background: #0f172a;
      color: rgba(245,250,255,.94);
    }

    #${DRAWER_ID} .tg-date-filter-hint {
      position: relative;
      margin-top: 9px;
      color: var(--tg-muted);
      font-size: 12px;
    }

    #${DRAWER_ID} .tg-action-btn,
    #${DRAWER_ID} .tg-detail-link {
      min-height: 34px;
      border: 1px solid rgba(148, 227, 255, .14);
      background: rgba(255,255,255,.045);
      color: rgba(226, 232, 240, .86);
      border-radius: 14px;
      cursor: pointer;
      padding: 0 9px;
      font-size: 12px;
      font-weight: 650;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      box-shadow: inset 0 1px 0 rgba(255,255,255,.07);
      transition: transform .28s cubic-bezier(.16, 1, .3, 1), border-color .28s ease, background .28s ease, box-shadow .28s ease, color .28s ease;
    }

    #${DRAWER_ID} .tg-action-btn:hover,
    #${DRAWER_ID} .tg-detail-link:hover {
      transform: translateY(-2px);
      border-color: rgba(103,232,249,.42);
      color: rgba(245,250,255,.98);
      background:
        linear-gradient(135deg, rgba(103,232,249,.14), rgba(139,92,246,.1)),
        rgba(255,255,255,.055);
      box-shadow: 0 0 24px rgba(103,232,249,.12), inset 0 1px 0 rgba(255,255,255,.12);
    }

    #${DRAWER_ID} .tg-section {
      margin-bottom: 16px;
    }

    #${DRAWER_ID} .tg-course-group {
      margin-bottom: 16px;
      border: 1px solid rgba(148, 227, 255, .13);
      background:
        linear-gradient(145deg, rgba(255,255,255,.06), rgba(255,255,255,.025)),
        rgba(8, 13, 24, .34);
      border-radius: 24px;
      padding: 12px;
      box-shadow: 0 18px 42px rgba(0,0,0,.22), inset 0 1px 0 rgba(255,255,255,.07);
      backdrop-filter: blur(18px) saturate(135%);
      -webkit-backdrop-filter: blur(18px) saturate(135%);
    }

    #${DRAWER_ID} .tg-course-head {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 12px;
      align-items: center;
      color: rgba(248,250,252,.96);
      font-size: 14px;
      font-weight: 760;
      margin: 2px 2px 10px;
      overflow-wrap: anywhere;
      cursor: pointer;
    }

    #${DRAWER_ID} .tg-course-title {
      min-width: 0;
      overflow-wrap: anywhere;
    }

    #${DRAWER_ID} .tg-course-stats {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 8px;
    }

    #${DRAWER_ID} .tg-course-stat {
      color: rgba(203,213,225,.76);
      background: rgba(255,255,255,.045);
      border: 1px solid rgba(148, 227, 255, .1);
      border-radius: 999px;
      padding: 3px 7px;
      font-size: 11px;
      font-weight: 620;
    }

    #${DRAWER_ID} .tg-course-toggle {
      width: 34px;
      height: 34px;
      border-radius: 13px;
      border: 1px solid rgba(148, 227, 255, .16);
      background: rgba(255,255,255,.045);
      color: rgba(235,245,255,.9);
      cursor: pointer;
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08);
      transition: transform .28s cubic-bezier(.16, 1, .3, 1), border-color .28s ease, box-shadow .28s ease;
    }

    #${DRAWER_ID} .tg-course-toggle:hover {
      transform: translateY(-2px);
      border-color: rgba(103,232,249,.4);
      box-shadow: 0 0 22px rgba(103,232,249,.12), inset 0 1px 0 rgba(255,255,255,.12);
    }

    #${DRAWER_ID} .tg-course-content {
      display: grid;
      grid-template-rows: 1fr;
      transition: grid-template-rows .34s cubic-bezier(.16, 1, .3, 1), opacity .28s ease;
      opacity: 1;
    }

    #${DRAWER_ID} .tg-course-content-inner {
      overflow: hidden;
    }

    #${DRAWER_ID} .tg-course-group.tg-course-collapsed .tg-course-content {
      grid-template-rows: 0fr;
      opacity: 0;
    }

    #${DRAWER_ID} .tg-course-subgroup {
      margin-top: 10px;
      border: 1px solid rgba(148, 227, 255, .09);
      border-radius: 18px;
      background: rgba(255,255,255,.025);
      padding: 9px;
    }

    #${DRAWER_ID} .tg-subgroup-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      color: rgba(203,213,225,.76);
      font-size: 12px;
      font-weight: 720;
      margin: 0 2px;
      cursor: pointer;
      user-select: none;
    }

    #${DRAWER_ID} .tg-subgroup-title-main {
      min-width: 0;
      color: rgba(235,245,255,.88);
    }

    #${DRAWER_ID} .tg-subgroup-count {
      flex: 0 0 auto;
      color: var(--tg-muted);
      border: 1px solid rgba(148, 227, 255, .1);
      background: rgba(255,255,255,.04);
      border-radius: 999px;
      padding: 2px 7px;
      font-size: 11px;
    }

    #${DRAWER_ID} .tg-subgroup-content {
      display: grid;
      grid-template-rows: 1fr;
      margin-top: 8px;
      transition: grid-template-rows .32s cubic-bezier(.16, 1, .3, 1), opacity .26s ease;
      opacity: 1;
    }

    #${DRAWER_ID} .tg-subgroup-content-inner {
      overflow: hidden;
    }

    #${DRAWER_ID} .tg-section-collapsed .tg-subgroup-content {
      grid-template-rows: 0fr;
      opacity: 0;
    }

    #${DRAWER_ID} .tg-section-title {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 8px;
      color: rgba(245,250,255,.92);
      font-size: 13px;
      font-weight: 760;
      margin: 15px 3px 9px;
    }

    #${DRAWER_ID} .tg-section-title::before {
      content: "";
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--tg-cyan);
      box-shadow: 0 0 14px rgba(103,232,249,.52);
      margin-right: 1px;
    }

    #${DRAWER_ID} .tg-section-title span:first-child {
      flex: 1 1 auto;
    }

    #${DRAWER_ID} .tg-section-count {
      color: var(--tg-muted);
      font-size: 12px;
      font-weight: 560;
    }

    #${DRAWER_ID} .tg-section-urgent .tg-section-title::before {
      background: var(--tg-red);
      box-shadow: 0 0 16px rgba(251,113,133,.42);
    }

    #${DRAWER_ID} .tg-card {
      border-radius: 22px;
      padding: 13px;
      margin-bottom: 10px;
      line-height: 1.55;
      transition: transform .36s cubic-bezier(.16, 1, .3, 1), border-color .36s ease, box-shadow .36s ease, background .36s ease;
    }

    #${DRAWER_ID} .tg-card:hover {
      transform: translateY(-4px);
      border-color: rgba(103,232,249,.32);
      background:
        linear-gradient(145deg, rgba(255,255,255,.105), rgba(255,255,255,.045)),
        rgba(10, 17, 30, .54);
      box-shadow: 0 28px 64px rgba(0,0,0,.34), 0 0 34px rgba(103,232,249,.1), inset 0 1px 0 rgba(255,255,255,.13);
    }

    #${DRAWER_ID} .tg-card.tg-state-ok {
      border-color: rgba(134,239,172,.18);
    }

    #${DRAWER_ID} .tg-card.tg-state-warn {
      border-color: rgba(251,191,36,.22);
    }

    #${DRAWER_ID} .tg-card.tg-state-bad {
      border-color: rgba(251,113,133,.28);
      box-shadow: 0 20px 48px rgba(54, 8, 24, .26), 0 0 32px rgba(251,113,133,.08), inset 0 1px 0 rgba(255,255,255,.1);
    }

    #${DRAWER_ID} .tg-card.tg-state-muted {
      border-color: rgba(148,163,184,.14);
    }

    #${DRAWER_ID} .tg-card-head {
      position: relative;
      display: flex;
      gap: 10px;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 9px;
    }

    #${DRAWER_ID} .tg-card-top {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 10px;
    }

    #${DRAWER_ID} .tg-card-top-actions {
      display: inline-flex;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
      flex: 0 0 auto;
    }

    #${DRAWER_ID} .tg-card-title {
      min-width: 0;
      color: rgba(248,250,252,.96);
      font-size: 14px;
      font-weight: 720;
      line-height: 1.45;
      overflow-wrap: anywhere;
    }

    #${DRAWER_ID} .tg-card-title a {
      color: inherit;
      text-decoration: none;
    }

    #${DRAWER_ID} .tg-card-title a:hover {
      color: rgba(165,243,252,.98);
    }

    #${DRAWER_ID} .tg-type {
      flex: 0 0 auto;
      border: 1px solid rgba(148, 227, 255, .18);
      border-radius: 999px;
      padding: 3px 8px;
      color: rgba(225, 245, 255, .82);
      font-size: 11px;
      font-weight: 680;
      background: rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08);
    }

    #${DRAWER_ID} .tg-countdown {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 34px;
      border-radius: 999px;
      border: 1px solid rgba(251,191,36,.34);
      background:
        linear-gradient(135deg, rgba(251,191,36,.16), rgba(251,113,133,.1)),
        rgba(255,255,255,.045);
      color: rgba(255, 237, 213, .96);
      padding: 6px 12px;
      font-size: 16px;
      font-weight: 780;
      line-height: 1.2;
      box-shadow: 0 0 24px rgba(251,191,36,.13), inset 0 1px 0 rgba(255,255,255,.1);
      white-space: nowrap;
      animation: tgCountdownPulse 2.8s ease-in-out infinite;
    }

    #${DRAWER_ID} .tg-ignored-flag {
      display: inline-flex;
      align-items: center;
      min-height: 30px;
      padding: 0 11px;
      border-radius: 999px;
      border: 1px solid rgba(148, 163, 184, .18);
      background: rgba(255,255,255,.04);
      color: rgba(203, 213, 225, .82);
      font-size: 11px;
      font-weight: 760;
      white-space: nowrap;
    }

    #${DRAWER_ID} .tg-icon-action {
      width: 34px;
      height: 34px;
      border: 1px solid rgba(148, 227, 255, .14);
      background: rgba(255,255,255,.045);
      color: rgba(226, 232, 240, .86);
      border-radius: 12px;
      cursor: pointer;
      font-size: 16px;
      line-height: 1;
      box-shadow: inset 0 1px 0 rgba(255,255,255,.07);
      transition: transform .28s cubic-bezier(.16, 1, .3, 1), border-color .28s ease, background .28s ease, box-shadow .28s ease, color .28s ease;
    }

    #${DRAWER_ID} .tg-icon-action:hover {
      transform: translateY(-2px);
      border-color: rgba(251,191,36,.42);
      color: rgba(255, 245, 220, .98);
      background:
        linear-gradient(135deg, rgba(251,191,36,.14), rgba(251,113,133,.1)),
        rgba(255,255,255,.055);
      box-shadow: 0 0 24px rgba(251,191,36,.12), inset 0 1px 0 rgba(255,255,255,.12);
    }

    #${DRAWER_ID} .tg-restore-btn {
      min-width: 64px;
    }

    #${DRAWER_ID} .tg-status {
      position: relative;
      font-size: 13px;
      font-weight: 760;
      margin: 7px 0 6px;
    }

    #${DRAWER_ID} .tg-status-row {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      flex-wrap: wrap;
    }

    #${DRAWER_ID} .tg-ok { color: var(--tg-green); }
    #${DRAWER_ID} .tg-warn { color: var(--tg-amber); }
    #${DRAWER_ID} .tg-bad { color: var(--tg-red); }
    #${DRAWER_ID} .tg-muted { color: var(--tg-muted); }

    #${DRAWER_ID} .tg-card-note {
      margin-top: -2px;
      margin-bottom: 8px;
      color: rgba(203, 213, 225, .72);
      font-size: 12px;
    }

    #${DRAWER_ID} .tg-small,
    #${DRAWER_ID} .tg-task-meta {
      position: relative;
      color: var(--tg-muted);
      font-size: 12px;
      line-height: 1.7;
      overflow-wrap: anywhere;
    }

    #${DRAWER_ID} .tg-task-meta {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 7px;
      margin-top: 10px;
    }

    #${DRAWER_ID} .tg-task-meta span {
      display: block;
      border: 1px solid rgba(148, 227, 255, .1);
      background: rgba(255,255,255,.035);
      border-radius: 13px;
      padding: 7px 8px;
    }

    #${DRAWER_ID} .tg-card-footer {
      position: relative;
      display: flex;
      justify-content: flex-start;
      margin-top: 11px;
    }

    #${DRAWER_ID} .tg-detail-link {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 30px;
      text-decoration: none;
      padding: 0 12px;
      border: 1px solid rgba(103,232,249,.22);
      border-radius: 999px;
      color: rgba(225,245,255,.92);
      background: rgba(255,255,255,.045);
      cursor: pointer;
      font: inherit;
      font-size: 12px;
      transition: transform .25s cubic-bezier(.16, 1, .3, 1), border-color .25s ease, box-shadow .25s ease;
    }

    #${DRAWER_ID} .tg-detail-link:hover {
      transform: translateY(-1px);
      border-color: rgba(103,232,249,.45);
      box-shadow: 0 0 18px rgba(103,232,249,.12);
    }

    #${DRAWER_ID} .tg-actions {
      flex: 0 0 auto;
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1.25fr);
      gap: 10px;
      padding: 12px 16px 16px;
      border-top: 1px solid rgba(148, 227, 255, .13);
      background: linear-gradient(180deg, rgba(8,13,24,.44), rgba(8,13,24,.78));
      backdrop-filter: blur(24px) saturate(145%);
      -webkit-backdrop-filter: blur(24px) saturate(145%);
    }

    #${DRAWER_ID} .tg-action-btn {
      min-height: 40px;
      border-radius: 16px;
    }

    #${DRAWER_ID} [data-copy-all-json] {
      border-color: rgba(103,232,249,.28);
      background:
        linear-gradient(135deg, rgba(103,232,249,.13), rgba(139,92,246,.11)),
        rgba(255,255,255,.055);
      color: rgba(245,250,255,.96);
    }

    #${DRAWER_ID} [data-delete-cache] {
      border-color: rgba(251,113,133,.22);
      background:
        linear-gradient(135deg, rgba(251,113,133,.1), rgba(251,191,36,.06)),
        rgba(255,255,255,.045);
      color: rgba(255,228,230,.94);
    }

    #${DRAWER_ID} textarea.tg-json-box {
      width: 100%;
      height: 260px;
      margin-top: 10px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, Monaco, monospace;
      font-size: 12px;
      line-height: 1.5;
      border: 1px solid rgba(148, 227, 255, .16);
      border-radius: 18px;
      padding: 12px;
      resize: vertical;
      color: rgba(235,245,255,.94);
      background: rgba(2,6,23,.58);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08);
    }

    @keyframes tgFloatButton {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-5px); }
    }

    @keyframes tgParticleDrift {
      from { background-position: 0 0, 0 0, 0 0, 0 0, 0 0; }
      to { background-position: 128px 70px, -184px 120px, 148px -90px, 44px 44px, -44px 44px; }
    }

    @keyframes tgSlowFloatA {
      0%, 100% { transform: translate3d(0,0,0) scale(1); opacity: .58; }
      50% { transform: translate3d(-18px,24px,0) scale(1.06); opacity: .76; }
    }

    @keyframes tgSlowFloatB {
      0%, 100% { transform: translate3d(0,0,0) scale(1); opacity: .44; }
      50% { transform: translate3d(22px,-18px,0) scale(1.08); opacity: .66; }
    }

    @keyframes tgRingDrift {
      0%, 100% { transform: rotate(-18deg) translate3d(0,0,0); opacity: .36; }
      50% { transform: rotate(8deg) translate3d(18px,10px,0); opacity: .52; }
    }

    @keyframes tgCountdownPulse {
      0%, 100% { box-shadow: 0 0 20px rgba(251,191,36,.11), inset 0 1px 0 rgba(255,255,255,.1); }
      50% { box-shadow: 0 0 30px rgba(251,191,36,.22), 0 0 18px rgba(251,113,133,.12), inset 0 1px 0 rgba(255,255,255,.14); }
    }

    /* iOS 26 Liquid Glass practical skin */
    #${BUTTON_ID}, #${DRAWER_ID} {
      --tg-liquid-bg: rgba(255,255,255,.16);
      --tg-liquid-bg-strong: rgba(20, 25, 36, .72);
      --tg-liquid-card: rgba(255,255,255,.13);
      --tg-liquid-card-strong: rgba(255,255,255,.2);
      --tg-liquid-border: rgba(255,255,255,.35);
      --tg-liquid-border-soft: rgba(255,255,255,.22);
      --tg-liquid-shadow: 0 20px 60px rgba(0,0,0,.25);
      --tg-text: rgba(255,255,255,.96);
      --tg-muted: rgba(232,238,247,.76);
      --tg-faint: rgba(220,228,240,.58);
      --tg-cyan: #8ee8ff;
      --tg-violet: #b8a7ff;
      --tg-pink: #ffc5e8;
      --tg-red: #ff6b7f;
      --tg-amber: #ffd166;
      --tg-green: #8ce99a;
      text-shadow: 0 1px 1px rgba(0,0,0,.24);
    }

    #${BUTTON_ID} {
      width: auto;
      min-width: 132px;
      height: 48px;
      padding: 0 18px;
      border-radius: 999px;
      border: 1px solid var(--tg-liquid-border);
      background:
        linear-gradient(135deg, rgba(255,255,255,.32), rgba(255,255,255,.12)),
        rgba(255,255,255,.16);
      color: rgba(255,255,255,.96);
      box-shadow: var(--tg-liquid-shadow), inset 0 1px 0 rgba(255,255,255,.42), inset 0 -1px 0 rgba(255,255,255,.14);
      backdrop-filter: blur(22px) saturate(180%);
      -webkit-backdrop-filter: blur(22px) saturate(180%);
      font-size: 13px;
      font-weight: 780;
      line-height: 1;
      animation: none;
      transition: transform .18s cubic-bezier(.2, .8, .2, 1), border-color .18s ease, box-shadow .18s ease, background .18s ease;
    }

    #${BUTTON_ID}::before {
      inset: 1px;
      border-radius: 999px;
      background: linear-gradient(120deg, transparent 12%, rgba(255,255,255,.36) 32%, transparent 56%);
      filter: none;
      opacity: .34;
      transform: translateX(-42%);
      transition: transform .22s ease, opacity .18s ease;
    }

    #${BUTTON_ID}:hover {
      transform: translateY(-2px);
      border-color: rgba(255,255,255,.58);
      background:
        linear-gradient(135deg, rgba(255,255,255,.4), rgba(255,255,255,.18)),
        rgba(255,255,255,.2);
      box-shadow: 0 24px 64px rgba(0,0,0,.3), inset 0 1px 0 rgba(255,255,255,.5);
    }

    #${BUTTON_ID}:hover::before {
      transform: translateX(36%);
      opacity: .55;
    }

    #${BUTTON_ID} .tg-task-button-badge {
      right: 4px;
      top: -8px;
      min-width: 24px;
      height: 24px;
      border-radius: 999px;
      border: 1px solid rgba(255,255,255,.62);
      background: rgba(255, 78, 112, .84);
      color: #fff;
      line-height: 22px;
      box-shadow: 0 10px 24px rgba(255,78,112,.24), inset 0 1px 0 rgba(255,255,255,.38);
      backdrop-filter: blur(14px) saturate(180%);
      -webkit-backdrop-filter: blur(14px) saturate(180%);
    }

    #${DRAWER_ID} {
      border-radius: 28px;
      color: var(--tg-text);
      background:
        linear-gradient(180deg, rgba(22,27,38,.72), rgba(10,14,22,.68)),
        rgba(255,255,255,.16);
      border: 1px solid var(--tg-liquid-border);
      box-shadow: var(--tg-liquid-shadow), inset 0 1px 0 rgba(255,255,255,.32), inset 0 0 0 1px rgba(255,255,255,.08);
      backdrop-filter: blur(22px) saturate(180%);
      -webkit-backdrop-filter: blur(22px) saturate(180%);
      transition: transform .2s cubic-bezier(.2, .8, .2, 1), opacity .18s ease, box-shadow .18s ease;
    }

    #${DRAWER_ID}.tg-open {
      background:
        linear-gradient(180deg, rgba(20,25,36,.78), rgba(8,12,20,.74)),
        rgba(255,255,255,.18);
    }

    #${DRAWER_ID}::before {
      background:
        linear-gradient(115deg, rgba(255,255,255,.2), transparent 24%),
        radial-gradient(circle at 18% 0%, rgba(255,255,255,.16), transparent 30%);
      opacity: .55;
      animation: none;
      mask-image: none;
    }

    #${DRAWER_ID}::after {
      border-radius: 27px;
      background:
        linear-gradient(135deg, rgba(255,255,255,.2), transparent 28%),
        linear-gradient(315deg, rgba(255,255,255,.08), transparent 34%);
      opacity: .45;
    }

    #${DRAWER_ID} .tg-ambient {
      display: none;
    }

    #${DRAWER_ID} .tg-header {
      min-height: 76px;
      border-bottom: 1px solid rgba(255,255,255,.18);
      background: rgba(255,255,255,.08);
      backdrop-filter: blur(16px) saturate(160%);
      -webkit-backdrop-filter: blur(16px) saturate(160%);
    }

    #${DRAWER_ID} .tg-title-main,
    #${DRAWER_ID} .tg-card-title,
    #${DRAWER_ID} .tg-course-head,
    #${DRAWER_ID} .tg-section-title {
      color: rgba(255,255,255,.98);
      text-shadow: 0 1px 2px rgba(0,0,0,.28);
    }

    #${DRAWER_ID} .tg-icon-btn,
    #${DRAWER_ID} .tg-action-btn,
    #${DRAWER_ID} .tg-detail-link,
    #${DRAWER_ID} .tg-course-toggle,
    #${DRAWER_ID} .tg-subgroup-count,
    #${DRAWER_ID} .tg-course-stat,
    #${DRAWER_ID} .tg-type,
    #${DRAWER_ID} .tg-date-filter select {
      border-radius: 999px;
      border-color: var(--tg-liquid-border-soft);
      background: rgba(255,255,255,.13);
      color: rgba(255,255,255,.92);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.22);
      backdrop-filter: blur(14px) saturate(170%);
      -webkit-backdrop-filter: blur(14px) saturate(170%);
      transition: transform .16s ease, border-color .16s ease, background .16s ease, box-shadow .16s ease;
    }

    #${DRAWER_ID} .tg-top-refresh {
      min-width: 78px;
    }

    #${DRAWER_ID} .tg-icon-btn:hover,
    #${DRAWER_ID} .tg-action-btn:hover,
    #${DRAWER_ID} .tg-detail-link:hover,
    #${DRAWER_ID} .tg-course-toggle:hover,
    #${DRAWER_ID} .tg-date-filter select:hover,
    #${DRAWER_ID} .tg-date-filter select:focus {
      transform: translateY(-1px);
      border-color: rgba(255,255,255,.48);
      background: rgba(255,255,255,.2);
      box-shadow: 0 10px 26px rgba(0,0,0,.18), inset 0 1px 0 rgba(255,255,255,.34);
    }

    #${DRAWER_ID} .tg-meta,
    #${DRAWER_ID} .tg-alert,
    #${DRAWER_ID} .tg-empty,
    #${DRAWER_ID} .tg-date-filter,
    #${DRAWER_ID} .tg-summary-item,
    #${DRAWER_ID} .tg-refresh-status,
    #${DRAWER_ID} .tg-course-group,
    #${DRAWER_ID} .tg-course-subgroup,
    #${DRAWER_ID} .tg-card {
      border: 1px solid var(--tg-liquid-border-soft);
      background:
        linear-gradient(180deg, rgba(255,255,255,.16), rgba(255,255,255,.08)),
        rgba(255,255,255,.1);
      box-shadow: 0 12px 34px rgba(0,0,0,.18), inset 0 1px 0 rgba(255,255,255,.24);
      backdrop-filter: blur(18px) saturate(170%);
      -webkit-backdrop-filter: blur(18px) saturate(170%);
    }

    #${DRAWER_ID} .tg-meta::before,
    #${DRAWER_ID} .tg-alert::before,
    #${DRAWER_ID} .tg-empty::before,
    #${DRAWER_ID} .tg-date-filter::before,
    #${DRAWER_ID} .tg-summary-item::before,
    #${DRAWER_ID} .tg-card::before {
      background: linear-gradient(120deg, rgba(255,255,255,.18), transparent 38%);
      opacity: .42;
      mix-blend-mode: normal;
    }

    #${DRAWER_ID} .tg-summary-item,
    #${DRAWER_ID} .tg-card {
      transition: transform .18s cubic-bezier(.2, .8, .2, 1), border-color .18s ease, box-shadow .18s ease, background .18s ease;
    }

    #${DRAWER_ID} .tg-summary-item:hover,
    #${DRAWER_ID} .tg-card:hover {
      transform: translateY(-2px);
      border-color: rgba(255,255,255,.46);
      background:
        linear-gradient(180deg, rgba(255,255,255,.22), rgba(255,255,255,.1)),
        rgba(255,255,255,.14);
      box-shadow: 0 16px 42px rgba(0,0,0,.22), inset 0 1px 0 rgba(255,255,255,.3);
    }

    #${DRAWER_ID} .tg-summary-item.tg-selected {
      border-color: rgba(142,232,255,.62);
      background:
        linear-gradient(180deg, rgba(142,232,255,.2), rgba(255,255,255,.12)),
        rgba(255,255,255,.16);
      box-shadow: 0 16px 42px rgba(0,0,0,.22), 0 0 0 1px rgba(142,232,255,.18), inset 0 1px 0 rgba(255,255,255,.32);
    }

    #${DRAWER_ID} .tg-summary-item[data-tooltip]::after,
    #${DRAWER_ID} .tg-status[data-tooltip]::after {
      color: rgba(255,255,255,.96);
      background:
        linear-gradient(180deg, rgba(34,40,54,.86), rgba(12,16,25,.82)),
        rgba(255,255,255,.16);
      border: 1px solid rgba(255,255,255,.32);
      box-shadow: 0 16px 42px rgba(0,0,0,.24), inset 0 1px 0 rgba(255,255,255,.22);
      backdrop-filter: blur(18px) saturate(180%);
      -webkit-backdrop-filter: blur(18px) saturate(180%);
    }

    #${DRAWER_ID} .tg-status[data-tooltip] {
      cursor: help;
    }

    #${DRAWER_ID} .tg-status[data-tooltip]::after {
      content: attr(data-tooltip);
      position: absolute;
      left: 0;
      bottom: calc(100% + 8px);
      width: min(240px, 72vw);
      transform: translateY(6px);
      opacity: 0;
      pointer-events: none;
      border-radius: 14px;
      padding: 8px 10px;
      font-size: 11px;
      line-height: 1.45;
      font-weight: 560;
      transition: opacity .16s ease, transform .16s ease;
      z-index: 8;
    }

    #${DRAWER_ID} .tg-status[data-tooltip]:hover::after {
      opacity: 1;
      transform: translateY(0);
    }

    #${DRAWER_ID} .tg-progress-track {
      height: 5px;
      border-radius: 999px;
      border: 1px solid rgba(255,255,255,.2);
      background: rgba(255,255,255,.12);
    }

    #${DRAWER_ID} .tg-progress-fill {
      background: linear-gradient(90deg, rgba(142,232,255,.92), rgba(184,167,255,.82), rgba(255,197,232,.76));
      box-shadow: 0 0 16px rgba(142,232,255,.18);
      transition: width .18s ease, opacity .18s ease;
    }

    #${DRAWER_ID} .tg-refresh-status.tg-refresh-done {
      animation: tgProgressFade .9s ease .8s forwards;
    }

    #${DRAWER_ID} .tg-task-meta span {
      border-color: rgba(255,255,255,.16);
      background: rgba(255,255,255,.08);
      color: rgba(238,244,252,.82);
      backdrop-filter: blur(10px) saturate(150%);
      -webkit-backdrop-filter: blur(10px) saturate(150%);
    }

    #${DRAWER_ID} .tg-actions {
      border-top: 1px solid rgba(255,255,255,.18);
      background: rgba(10,14,22,.52);
      backdrop-filter: blur(18px) saturate(180%);
      -webkit-backdrop-filter: blur(18px) saturate(180%);
    }

    #${DRAWER_ID} textarea.tg-json-box {
      color: rgba(255,255,255,.94);
      background: rgba(12,16,25,.68);
      border-color: rgba(255,255,255,.22);
    }

    @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
      #${BUTTON_ID} {
        background: rgba(32, 38, 50, .94);
      }

      #${DRAWER_ID} {
        background: rgba(20, 24, 34, .96);
      }

      #${DRAWER_ID} .tg-meta,
      #${DRAWER_ID} .tg-alert,
      #${DRAWER_ID} .tg-empty,
      #${DRAWER_ID} .tg-date-filter,
      #${DRAWER_ID} .tg-summary-item,
      #${DRAWER_ID} .tg-refresh-status,
      #${DRAWER_ID} .tg-course-group,
      #${DRAWER_ID} .tg-course-subgroup,
      #${DRAWER_ID} .tg-card {
        background: rgba(35, 42, 56, .92);
      }
    }

    @keyframes tgProgressFade {
      to { opacity: .42; transform: translateY(-1px); }
    }

    /* Liquid Glass Pro light skin: CSS + SVG filter, optimized for white web pages */
    #${BUTTON_ID}, #${DRAWER_ID} {
      --tg-liquid-surface: rgba(255,255,255,.58);
      --tg-liquid-card: rgba(255,255,255,.42);
      --tg-liquid-card-hover: rgba(255,255,255,.58);
      --tg-liquid-border: rgba(255,255,255,.75);
      --tg-liquid-line: rgba(15,23,42,.08);
      --tg-liquid-shadow: 0 20px 60px rgba(15,23,42,.18);
      --tg-liquid-ease: cubic-bezier(.22, 1, .36, 1);
      --tg-text: #111827;
      --tg-muted: rgba(31,41,55,.72);
      --tg-faint: rgba(75,85,99,.58);
      --tg-cyan: #0891b2;
      --tg-violet: #6d28d9;
      --tg-pink: #be185d;
      --tg-red: #dc2626;
      --tg-amber: #b45309;
      --tg-green: #15803d;
      color: var(--tg-text);
      text-shadow: none;
    }

    #${BUTTON_ID} {
      min-width: 136px;
      height: 50px;
      border-radius: 999px;
      border: 1px solid var(--tg-liquid-border);
      background:
        radial-gradient(circle at var(--tg-mouse-x, 28%) var(--tg-mouse-y, 18%), rgba(255,255,255,.96), transparent 36%),
        linear-gradient(135deg, rgba(255,255,255,.78), rgba(255,255,255,.38)),
        rgba(255,255,255,.58);
      color: #111827;
      box-shadow: 0 18px 46px rgba(15,23,42,.16), inset 0 1px 0 rgba(255,255,255,.86), inset 0 -1px 0 rgba(255,255,255,.42);
      backdrop-filter: blur(26px) saturate(180%);
      -webkit-backdrop-filter: blur(26px) saturate(180%);
      transition: transform .18s var(--tg-liquid-ease), border-color .18s ease, box-shadow .18s ease, background .18s ease;
    }

    #${BUTTON_ID}::before {
      inset: -1px;
      border-radius: 999px;
      background:
        linear-gradient(120deg, transparent 18%, rgba(255,255,255,.82) 38%, transparent 58%),
        radial-gradient(circle at 50% 0%, rgba(255,255,255,.74), transparent 44%);
      filter: url(#${SVG_FILTER_ID});
      opacity: .48;
      transform: translateX(-28%);
      transition: transform .22s var(--tg-liquid-ease), opacity .18s ease;
    }

    #${BUTTON_ID}:hover {
      transform: translateY(-2px);
      border-color: rgba(255,255,255,.92);
      background:
        radial-gradient(circle at var(--tg-mouse-x, 28%) var(--tg-mouse-y, 18%), rgba(255,255,255,1), transparent 38%),
        linear-gradient(135deg, rgba(255,255,255,.86), rgba(255,255,255,.5)),
        rgba(255,255,255,.66);
      box-shadow: 0 22px 54px rgba(15,23,42,.2), inset 0 1px 0 rgba(255,255,255,.95);
    }

    #${BUTTON_ID}:active {
      transform: translateY(0) scale(.985);
    }

    #${BUTTON_ID}:hover::before {
      transform: translateX(22%);
      opacity: .68;
    }

    #${BUTTON_ID} .tg-task-button-badge {
      background: rgba(239, 68, 68, .88);
      color: #fff;
      border-color: rgba(255,255,255,.9);
      box-shadow: 0 8px 20px rgba(239,68,68,.24), inset 0 1px 0 rgba(255,255,255,.42);
    }

    #${DRAWER_ID} {
      color: #111827;
      background:
        radial-gradient(circle at var(--tg-mouse-x, 72%) var(--tg-mouse-y, 12%), rgba(255,255,255,.92), transparent 30%),
        linear-gradient(180deg, rgba(255,255,255,.68), rgba(255,255,255,.48)),
        rgba(255,255,255,.58);
      border: 1px solid var(--tg-liquid-border);
      box-shadow: var(--tg-liquid-shadow), inset 0 1px 0 rgba(255,255,255,.8), inset 0 -1px 0 rgba(255,255,255,.32);
      backdrop-filter: blur(26px) saturate(180%);
      -webkit-backdrop-filter: blur(26px) saturate(180%);
      transition: transform .28s var(--tg-liquid-ease), opacity .22s ease, box-shadow .22s ease;
    }

    #${DRAWER_ID}.tg-open {
      background:
        radial-gradient(circle at var(--tg-mouse-x, 72%) var(--tg-mouse-y, 12%), rgba(255,255,255,.98), transparent 32%),
        linear-gradient(180deg, rgba(255,255,255,.72), rgba(255,255,255,.54)),
        rgba(255,255,255,.58);
    }

    #${DRAWER_ID}::before {
      background:
        linear-gradient(125deg, rgba(255,255,255,.92), transparent 24%, rgba(255,255,255,.22) 58%, transparent 76%),
        radial-gradient(circle at var(--tg-mouse-x, 80%) var(--tg-mouse-y, 8%), rgba(255,255,255,.72), transparent 26%);
      filter: url(#${SVG_FILTER_ID});
      opacity: .48;
      mix-blend-mode: screen;
      animation: none;
      mask-image: none;
    }

    #${DRAWER_ID}::after {
      border-radius: 27px;
      background:
        linear-gradient(135deg, rgba(255,255,255,.72), transparent 26%),
        linear-gradient(315deg, rgba(255,255,255,.32), transparent 34%);
      opacity: .58;
      mix-blend-mode: screen;
    }

    #${DRAWER_ID} .tg-header {
      border-bottom: 1px solid rgba(15,23,42,.08);
      background: rgba(255,255,255,.36);
      backdrop-filter: blur(18px) saturate(180%);
      -webkit-backdrop-filter: blur(18px) saturate(180%);
    }

    #${DRAWER_ID} .tg-title-main,
    #${DRAWER_ID} .tg-card-title,
    #${DRAWER_ID} .tg-course-head,
    #${DRAWER_ID} .tg-section-title,
    #${DRAWER_ID} .tg-meta-value,
    #${DRAWER_ID} .tg-refresh-title {
      color: #111827;
      text-shadow: none;
    }

    #${DRAWER_ID} .tg-title-sub,
    #${DRAWER_ID} .tg-meta-label,
    #${DRAWER_ID} .tg-refresh-stage,
    #${DRAWER_ID} .tg-small,
    #${DRAWER_ID} .tg-task-meta,
    #${DRAWER_ID} .tg-summary-label,
    #${DRAWER_ID} .tg-date-filter-hint,
    #${DRAWER_ID} .tg-current-filter,
    #${DRAWER_ID} .tg-section-count,
    #${DRAWER_ID} .tg-course-stat,
    #${DRAWER_ID} .tg-subgroup-title,
    #${DRAWER_ID} .tg-subgroup-count {
      color: var(--tg-muted);
      text-shadow: none;
    }

    #${DRAWER_ID} .tg-meta,
    #${DRAWER_ID} .tg-alert,
    #${DRAWER_ID} .tg-empty,
    #${DRAWER_ID} .tg-date-filter,
    #${DRAWER_ID} .tg-summary-item,
    #${DRAWER_ID} .tg-refresh-status,
    #${DRAWER_ID} .tg-course-group,
    #${DRAWER_ID} .tg-course-subgroup,
    #${DRAWER_ID} .tg-card {
      color: #111827;
      border: 1px solid var(--tg-liquid-line);
      background: var(--tg-liquid-card);
      box-shadow: 0 10px 30px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.72);
      backdrop-filter: none;
      -webkit-backdrop-filter: none;
      transition: transform .18s var(--tg-liquid-ease), border-color .18s ease, box-shadow .18s ease, background .18s ease;
    }

    #${DRAWER_ID} .tg-meta,
    #${DRAWER_ID} .tg-alert,
    #${DRAWER_ID} .tg-empty,
    #${DRAWER_ID} .tg-date-filter,
    #${DRAWER_ID} .tg-summary-item,
    #${DRAWER_ID} .tg-refresh-status,
    #${DRAWER_ID} .tg-course-group {
      backdrop-filter: blur(12px) saturate(160%);
      -webkit-backdrop-filter: blur(12px) saturate(160%);
    }

    #${DRAWER_ID} .tg-meta::before,
    #${DRAWER_ID} .tg-alert::before,
    #${DRAWER_ID} .tg-empty::before,
    #${DRAWER_ID} .tg-date-filter::before,
    #${DRAWER_ID} .tg-summary-item::before,
    #${DRAWER_ID} .tg-card::before {
      background: linear-gradient(135deg, rgba(255,255,255,.68), transparent 38%);
      opacity: .45;
      mix-blend-mode: normal;
    }

    #${DRAWER_ID} .tg-summary-item:hover,
    #${DRAWER_ID} .tg-card:hover,
    #${DRAWER_ID} .tg-course-group:hover {
      transform: translateY(-2px);
      border-color: rgba(15,23,42,.13);
      background: var(--tg-liquid-card-hover);
      box-shadow: 0 14px 34px rgba(15,23,42,.12), inset 0 1px 0 rgba(255,255,255,.86);
    }

    #${DRAWER_ID} .tg-summary-item:active,
    #${DRAWER_ID} .tg-card:active {
      transform: translateY(0) scale(.995);
    }

    #${DRAWER_ID} .tg-summary-item.tg-selected {
      border-color: rgba(8,145,178,.28);
      background: rgba(236,254,255,.66);
      box-shadow: 0 14px 34px rgba(8,145,178,.12), inset 0 1px 0 rgba(255,255,255,.88);
    }

    #${DRAWER_ID} .tg-summary-item.tg-selected .tg-summary-num {
      color: #075985;
      text-shadow: none;
    }

    #${DRAWER_ID} .tg-icon-btn,
    #${DRAWER_ID} .tg-action-btn,
    #${DRAWER_ID} .tg-detail-link,
    #${DRAWER_ID} .tg-course-toggle,
    #${DRAWER_ID} .tg-type,
    #${DRAWER_ID} .tg-date-filter select {
      position: relative;
      overflow: hidden;
      color: #111827;
      border: 1px solid rgba(15,23,42,.1);
      background: rgba(255,255,255,.48);
      box-shadow: 0 8px 22px rgba(15,23,42,.07), inset 0 1px 0 rgba(255,255,255,.78);
      backdrop-filter: blur(14px) saturate(170%);
      -webkit-backdrop-filter: blur(14px) saturate(170%);
      transition: transform .18s var(--tg-liquid-ease), border-color .18s ease, background .18s ease, box-shadow .18s ease;
    }

    #${DRAWER_ID} .tg-icon-btn::before,
    #${DRAWER_ID} .tg-action-btn::before,
    #${DRAWER_ID} .tg-detail-link::before,
    #${DRAWER_ID} .tg-course-toggle::before {
      content: "";
      position: absolute;
      inset: 0;
      pointer-events: none;
      background: linear-gradient(120deg, transparent, rgba(255,255,255,.72), transparent);
      transform: translateX(-120%);
      transition: transform .22s var(--tg-liquid-ease);
    }

    #${DRAWER_ID} .tg-icon-btn:hover,
    #${DRAWER_ID} .tg-action-btn:hover,
    #${DRAWER_ID} .tg-detail-link:hover,
    #${DRAWER_ID} .tg-course-toggle:hover,
    #${DRAWER_ID} .tg-date-filter select:hover,
    #${DRAWER_ID} .tg-date-filter select:focus {
      transform: translateY(-1px);
      border-color: rgba(15,23,42,.16);
      background: rgba(255,255,255,.68);
      box-shadow: 0 12px 28px rgba(15,23,42,.11), inset 0 1px 0 rgba(255,255,255,.92);
    }

    #${DRAWER_ID} .tg-icon-btn:hover::before,
    #${DRAWER_ID} .tg-action-btn:hover::before,
    #${DRAWER_ID} .tg-detail-link:hover::before,
    #${DRAWER_ID} .tg-course-toggle:hover::before {
      transform: translateX(120%);
    }

    #${DRAWER_ID} .tg-icon-btn:active,
    #${DRAWER_ID} .tg-action-btn:active,
    #${DRAWER_ID} .tg-detail-link:active,
    #${DRAWER_ID} .tg-course-toggle:active {
      transform: translateY(0) scale(.98);
    }

    #${DRAWER_ID} .tg-liquid-ripple {
      position: absolute;
      width: 10px;
      height: 10px;
      border-radius: 999px;
      pointer-events: none;
      background: rgba(8,145,178,.16);
      transform: translate(-50%, -50%) scale(1);
      animation: tgLiquidRipple .55s var(--tg-liquid-ease) forwards;
      z-index: 0;
    }

    #${DRAWER_ID} .tg-progress-track {
      height: 5px;
      border: 1px solid rgba(15,23,42,.08);
      background: rgba(255,255,255,.48);
      box-shadow: inset 0 1px 2px rgba(15,23,42,.05);
    }

    #${DRAWER_ID} .tg-progress-fill {
      background: linear-gradient(90deg, rgba(8,145,178,.68), rgba(99,102,241,.58), rgba(190,24,93,.42));
      box-shadow: 0 0 16px rgba(8,145,178,.16);
      filter: url(#${SVG_FILTER_ID});
      transition: width .18s ease, opacity .18s ease;
    }

    #${DRAWER_ID} .tg-summary-item[data-tooltip]::after,
    #${DRAWER_ID} .tg-status[data-tooltip]::after {
      color: #111827;
      background:
        linear-gradient(180deg, rgba(255,255,255,.88), rgba(255,255,255,.72)),
        rgba(255,255,255,.78);
      border: 1px solid rgba(15,23,42,.1);
      box-shadow: 0 16px 40px rgba(15,23,42,.14), inset 0 1px 0 rgba(255,255,255,.88);
      backdrop-filter: blur(18px) saturate(180%);
      -webkit-backdrop-filter: blur(18px) saturate(180%);
      text-shadow: none;
    }

    #${DRAWER_ID} .tg-summary-item[data-tooltip]::before,
    #${DRAWER_ID} .tg-status[data-tooltip]::before {
      content: "";
      position: absolute;
      width: 9px;
      height: 9px;
      background: rgba(255,255,255,.78);
      border-right: 1px solid rgba(15,23,42,.08);
      border-bottom: 1px solid rgba(15,23,42,.08);
      transform: rotate(45deg);
      opacity: 0;
      pointer-events: none;
      transition: opacity .16s ease;
      z-index: 7;
    }

    #${DRAWER_ID} .tg-summary-item[data-tooltip]::before {
      left: 50%;
      bottom: calc(100% + 5px);
      margin-left: -4px;
    }

    #${DRAWER_ID} .tg-status[data-tooltip]::before {
      left: 18px;
      bottom: calc(100% + 3px);
    }

    #${DRAWER_ID} .tg-summary-item[data-tooltip]:hover::before,
    #${DRAWER_ID} .tg-status[data-tooltip]:hover::before {
      opacity: 1;
    }

    #${DRAWER_ID} .tg-alert {
      color: #7f1d1d;
      background: rgba(254,242,242,.72);
      border-color: rgba(220,38,38,.14);
    }

    #${DRAWER_ID} .tg-empty {
      color: #374151;
    }

    #${DRAWER_ID} .tg-task-meta span,
    #${DRAWER_ID} .tg-course-stat,
    #${DRAWER_ID} .tg-subgroup-count {
      border-color: rgba(15,23,42,.06);
      background: rgba(255,255,255,.38);
      color: rgba(31,41,55,.72);
      backdrop-filter: none;
      -webkit-backdrop-filter: none;
    }

    #${DRAWER_ID} .tg-actions {
      border-top: 1px solid rgba(15,23,42,.08);
      background: rgba(255,255,255,.38);
      backdrop-filter: blur(18px) saturate(180%);
      -webkit-backdrop-filter: blur(18px) saturate(180%);
    }

    #${DRAWER_ID} textarea.tg-json-box {
      color: #111827;
      background: rgba(255,255,255,.72);
      border-color: rgba(15,23,42,.1);
    }

    @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
      #${BUTTON_ID},
      #${DRAWER_ID} {
        background: rgba(255,255,255,.94);
      }

      #${DRAWER_ID} .tg-meta,
      #${DRAWER_ID} .tg-alert,
      #${DRAWER_ID} .tg-empty,
      #${DRAWER_ID} .tg-date-filter,
      #${DRAWER_ID} .tg-summary-item,
      #${DRAWER_ID} .tg-refresh-status,
      #${DRAWER_ID} .tg-course-group,
      #${DRAWER_ID} .tg-course-subgroup,
      #${DRAWER_ID} .tg-card {
        background: rgba(255,255,255,.9);
      }
    }

    @keyframes tgLiquidRipple {
      to {
        opacity: 0;
        transform: translate(-50%, -50%) scale(34);
      }
    }

    /* Readable dark console skin: higher contrast, less white haze */
    #${BUTTON_ID}, #${DRAWER_ID} {
      --tg-liquid-surface: rgba(10, 14, 24, .78);
      --tg-liquid-card: rgba(17, 24, 39, .74);
      --tg-liquid-card-hover: rgba(24, 34, 52, .86);
      --tg-liquid-border: rgba(125, 211, 252, .24);
      --tg-liquid-line: rgba(148, 163, 184, .2);
      --tg-liquid-shadow: 0 22px 70px rgba(0, 0, 0, .46);
      --tg-text: rgba(248, 250, 252, .96);
      --tg-muted: rgba(203, 213, 225, .78);
      --tg-faint: rgba(148, 163, 184, .7);
      --tg-cyan: #22d3ee;
      --tg-violet: #8b5cf6;
      --tg-pink: #f472b6;
      --tg-red: #fb7185;
      --tg-amber: #fbbf24;
      --tg-green: #4ade80;
      color: var(--tg-text);
    }

    #${BUTTON_ID} {
      border: 1px solid rgba(125, 211, 252, .32);
      background:
        radial-gradient(circle at var(--tg-mouse-x, 28%) var(--tg-mouse-y, 18%), rgba(34,211,238,.18), transparent 36%),
        linear-gradient(135deg, rgba(31,41,55,.92), rgba(8,13,24,.82)),
        rgba(10,14,24,.82);
      color: rgba(248,250,252,.96);
      box-shadow: 0 18px 48px rgba(0,0,0,.42), 0 0 0 1px rgba(255,255,255,.04) inset, inset 0 1px 0 rgba(255,255,255,.16);
      backdrop-filter: blur(24px) saturate(170%);
      -webkit-backdrop-filter: blur(24px) saturate(170%);
    }

    #${BUTTON_ID}::before {
      background:
        linear-gradient(120deg, transparent 18%, rgba(125,211,252,.28) 38%, transparent 58%),
        radial-gradient(circle at 50% 0%, rgba(167,139,250,.18), transparent 44%);
      opacity: .36;
    }

    #${BUTTON_ID}:hover {
      border-color: rgba(125, 211, 252, .56);
      background:
        radial-gradient(circle at var(--tg-mouse-x, 28%) var(--tg-mouse-y, 18%), rgba(34,211,238,.26), transparent 38%),
        linear-gradient(135deg, rgba(38,50,72,.96), rgba(12,18,31,.9)),
        rgba(12,18,31,.9);
      box-shadow: 0 24px 60px rgba(0,0,0,.5), 0 0 28px rgba(34,211,238,.14), inset 0 1px 0 rgba(255,255,255,.2);
    }

    #${DRAWER_ID} {
      color: var(--tg-text);
      background:
        radial-gradient(circle at var(--tg-mouse-x, 72%) var(--tg-mouse-y, 12%), rgba(34,211,238,.13), transparent 30%),
        radial-gradient(circle at 100% 0%, rgba(139,92,246,.12), transparent 34%),
        linear-gradient(145deg, rgba(17,24,39,.84), rgba(3,7,18,.82)),
        rgba(10,14,24,.78);
      border: 1px solid rgba(125, 211, 252, .26);
      box-shadow: var(--tg-liquid-shadow), 0 0 42px rgba(34,211,238,.08), 0 0 74px rgba(139,92,246,.07), inset 0 1px 0 rgba(255,255,255,.12);
      backdrop-filter: blur(24px) saturate(170%);
      -webkit-backdrop-filter: blur(24px) saturate(170%);
    }

    #${DRAWER_ID}.tg-open {
      background:
        radial-gradient(circle at var(--tg-mouse-x, 72%) var(--tg-mouse-y, 12%), rgba(34,211,238,.15), transparent 32%),
        radial-gradient(circle at 100% 0%, rgba(139,92,246,.14), transparent 35%),
        linear-gradient(145deg, rgba(17,24,39,.88), rgba(3,7,18,.86)),
        rgba(10,14,24,.84);
    }

    #${DRAWER_ID}::before {
      background:
        linear-gradient(125deg, rgba(255,255,255,.14), transparent 24%, rgba(34,211,238,.08) 58%, transparent 76%),
        radial-gradient(circle at var(--tg-mouse-x, 80%) var(--tg-mouse-y, 8%), rgba(125,211,252,.16), transparent 26%);
      opacity: .42;
      mix-blend-mode: screen;
    }

    #${DRAWER_ID}::after {
      background:
        linear-gradient(135deg, rgba(255,255,255,.13), transparent 28%),
        linear-gradient(315deg, rgba(34,211,238,.08), transparent 36%);
      opacity: .42;
    }

    #${DRAWER_ID} .tg-header {
      border-bottom: 1px solid rgba(148, 163, 184, .18);
      background: rgba(15, 23, 42, .58);
      backdrop-filter: blur(18px) saturate(160%);
      -webkit-backdrop-filter: blur(18px) saturate(160%);
    }

    #${DRAWER_ID} .tg-title-main,
    #${DRAWER_ID} .tg-card-title,
    #${DRAWER_ID} .tg-course-head,
    #${DRAWER_ID} .tg-section-title,
    #${DRAWER_ID} .tg-meta-value,
    #${DRAWER_ID} .tg-refresh-title,
    #${DRAWER_ID} .tg-summary-num {
      color: rgba(248,250,252,.98);
      text-shadow: none;
    }

    #${DRAWER_ID} .tg-title-sub,
    #${DRAWER_ID} .tg-meta-label,
    #${DRAWER_ID} .tg-refresh-stage,
    #${DRAWER_ID} .tg-small,
    #${DRAWER_ID} .tg-task-meta,
    #${DRAWER_ID} .tg-summary-label,
    #${DRAWER_ID} .tg-date-filter-hint,
    #${DRAWER_ID} .tg-current-filter,
    #${DRAWER_ID} .tg-section-count,
    #${DRAWER_ID} .tg-course-stat,
    #${DRAWER_ID} .tg-subgroup-title,
    #${DRAWER_ID} .tg-subgroup-count {
      color: var(--tg-muted);
      text-shadow: none;
    }

    #${DRAWER_ID} .tg-current-filter strong,
    #${DRAWER_ID} .tg-meta-kicker {
      color: #67e8f9;
    }

    #${DRAWER_ID} .tg-meta,
    #${DRAWER_ID} .tg-alert,
    #${DRAWER_ID} .tg-empty,
    #${DRAWER_ID} .tg-date-filter,
    #${DRAWER_ID} .tg-summary-item,
    #${DRAWER_ID} .tg-refresh-status,
    #${DRAWER_ID} .tg-course-group,
    #${DRAWER_ID} .tg-course-subgroup,
    #${DRAWER_ID} .tg-card {
      color: var(--tg-text);
      border: 1px solid var(--tg-liquid-line);
      background:
        linear-gradient(180deg, rgba(30,41,59,.72), rgba(15,23,42,.66)),
        rgba(15, 23, 42, .72);
      box-shadow: 0 12px 34px rgba(0,0,0,.28), inset 0 1px 0 rgba(255,255,255,.08);
      backdrop-filter: none;
      -webkit-backdrop-filter: none;
    }

    #${DRAWER_ID} .tg-meta,
    #${DRAWER_ID} .tg-alert,
    #${DRAWER_ID} .tg-empty,
    #${DRAWER_ID} .tg-date-filter,
    #${DRAWER_ID} .tg-summary-item,
    #${DRAWER_ID} .tg-refresh-status,
    #${DRAWER_ID} .tg-course-group {
      backdrop-filter: blur(10px) saturate(145%);
      -webkit-backdrop-filter: blur(10px) saturate(145%);
    }

    #${DRAWER_ID} .tg-meta::before,
    #${DRAWER_ID} .tg-alert::before,
    #${DRAWER_ID} .tg-empty::before,
    #${DRAWER_ID} .tg-date-filter::before,
    #${DRAWER_ID} .tg-summary-item::before,
    #${DRAWER_ID} .tg-card::before {
      background: linear-gradient(135deg, rgba(255,255,255,.1), transparent 38%);
      opacity: .32;
    }

    #${DRAWER_ID} .tg-summary-item:hover,
    #${DRAWER_ID} .tg-card:hover,
    #${DRAWER_ID} .tg-course-group:hover {
      border-color: rgba(125,211,252,.34);
      background:
        linear-gradient(180deg, rgba(38,50,72,.84), rgba(17,24,39,.78)),
        rgba(17,24,39,.82);
      box-shadow: 0 16px 42px rgba(0,0,0,.36), 0 0 26px rgba(34,211,238,.08), inset 0 1px 0 rgba(255,255,255,.12);
    }

    #${DRAWER_ID} .tg-summary-item.tg-selected {
      border-color: rgba(34,211,238,.5);
      background:
        linear-gradient(180deg, rgba(14,116,144,.32), rgba(17,24,39,.82)),
        rgba(17,24,39,.86);
      box-shadow: 0 16px 42px rgba(0,0,0,.36), 0 0 28px rgba(34,211,238,.16), inset 0 1px 0 rgba(255,255,255,.14);
    }

    #${DRAWER_ID} .tg-summary-item.tg-selected .tg-summary-num {
      color: #67e8f9;
    }

    #${DRAWER_ID} .tg-icon-btn,
    #${DRAWER_ID} .tg-action-btn,
    #${DRAWER_ID} .tg-detail-link,
    #${DRAWER_ID} .tg-course-toggle,
    #${DRAWER_ID} .tg-type,
    #${DRAWER_ID} .tg-date-filter select {
      color: rgba(248,250,252,.94);
      border: 1px solid rgba(148,163,184,.22);
      background: rgba(15,23,42,.7);
      box-shadow: 0 8px 22px rgba(0,0,0,.24), inset 0 1px 0 rgba(255,255,255,.08);
      backdrop-filter: blur(12px) saturate(145%);
      -webkit-backdrop-filter: blur(12px) saturate(145%);
    }

    #${DRAWER_ID} .tg-icon-btn::before,
    #${DRAWER_ID} .tg-action-btn::before,
    #${DRAWER_ID} .tg-detail-link::before,
    #${DRAWER_ID} .tg-course-toggle::before {
      background: linear-gradient(120deg, transparent, rgba(125,211,252,.2), transparent);
    }

    #${DRAWER_ID} .tg-icon-btn:hover,
    #${DRAWER_ID} .tg-action-btn:hover,
    #${DRAWER_ID} .tg-detail-link:hover,
    #${DRAWER_ID} .tg-course-toggle:hover,
    #${DRAWER_ID} .tg-date-filter select:hover,
    #${DRAWER_ID} .tg-date-filter select:focus {
      border-color: rgba(125,211,252,.42);
      background: rgba(30,41,59,.82);
      box-shadow: 0 12px 30px rgba(0,0,0,.32), 0 0 22px rgba(34,211,238,.08), inset 0 1px 0 rgba(255,255,255,.12);
    }

    #${DRAWER_ID} .tg-date-filter select option {
      background: #0f172a;
      color: rgba(248,250,252,.94);
    }

    #${DRAWER_ID} [data-copy-all-json] {
      border-color: rgba(34,211,238,.36);
      background: rgba(8,47,73,.72);
      color: rgba(236,254,255,.98);
    }

    #${DRAWER_ID} [data-delete-cache] {
      border-color: rgba(251,113,133,.36);
      background: rgba(76, 29, 38, .72);
      color: rgba(255,228,230,.96);
    }

    #${DRAWER_ID} .tg-task-meta span,
    #${DRAWER_ID} .tg-course-stat,
    #${DRAWER_ID} .tg-subgroup-count {
      border-color: rgba(148,163,184,.14);
      background: rgba(15,23,42,.48);
      color: rgba(203,213,225,.82);
    }

    #${DRAWER_ID} .tg-progress-track {
      border: 1px solid rgba(148,163,184,.18);
      background: rgba(15,23,42,.72);
    }

    #${DRAWER_ID} .tg-progress-fill {
      background: linear-gradient(90deg, rgba(34,211,238,.9), rgba(99,102,241,.78), rgba(139,92,246,.68));
      box-shadow: 0 0 18px rgba(34,211,238,.18);
    }

    #${DRAWER_ID} .tg-summary-item[data-tooltip]::after,
    #${DRAWER_ID} .tg-status[data-tooltip]::after {
      color: rgba(248,250,252,.96);
      background:
        linear-gradient(180deg, rgba(30,41,59,.94), rgba(15,23,42,.92)),
        rgba(15,23,42,.92);
      border: 1px solid rgba(125,211,252,.22);
      box-shadow: 0 16px 40px rgba(0,0,0,.34), inset 0 1px 0 rgba(255,255,255,.1);
    }

    #${DRAWER_ID} .tg-summary-item[data-tooltip]::before,
    #${DRAWER_ID} .tg-status[data-tooltip]::before {
      background: rgba(30,41,59,.94);
      border-right: 1px solid rgba(125,211,252,.18);
      border-bottom: 1px solid rgba(125,211,252,.18);
    }

    #${DRAWER_ID} .tg-alert {
      color: #fecdd3;
      background:
        linear-gradient(180deg, rgba(127,29,29,.42), rgba(15,23,42,.72)),
        rgba(76,29,38,.66);
      border-color: rgba(251,113,133,.25);
    }

    #${DRAWER_ID} .tg-empty {
      color: rgba(203,213,225,.84);
    }

    #${DRAWER_ID} .tg-actions {
      border-top: 1px solid rgba(148,163,184,.18);
      background: rgba(3,7,18,.72);
      backdrop-filter: blur(18px) saturate(150%);
      -webkit-backdrop-filter: blur(18px) saturate(150%);
    }

    #${DRAWER_ID} textarea.tg-json-box {
      color: rgba(248,250,252,.94);
      background: rgba(2,6,23,.82);
      border-color: rgba(148,163,184,.2);
    }

    #${DRAWER_ID} .tg-ok { color: #4ade80; }
    #${DRAWER_ID} .tg-warn { color: #fbbf24; }
    #${DRAWER_ID} .tg-bad { color: #fb7185; }
    #${DRAWER_ID} .tg-muted { color: rgba(203,213,225,.78); }

    #${DRAWER_ID} .tg-state-ok {
      border-color: rgba(74,222,128,.22);
    }

    #${DRAWER_ID} .tg-state-warn {
      border-color: rgba(251,191,36,.28);
    }

    #${DRAWER_ID} .tg-state-bad {
      border-color: rgba(251,113,133,.34);
    }

    @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
      #${BUTTON_ID},
      #${DRAWER_ID} {
        background: rgba(15,23,42,.96);
      }

      #${DRAWER_ID} .tg-meta,
      #${DRAWER_ID} .tg-alert,
      #${DRAWER_ID} .tg-empty,
      #${DRAWER_ID} .tg-date-filter,
      #${DRAWER_ID} .tg-summary-item,
      #${DRAWER_ID} .tg-refresh-status,
      #${DRAWER_ID} .tg-course-group,
      #${DRAWER_ID} .tg-course-subgroup,
      #${DRAWER_ID} .tg-card {
        background: rgba(17,24,39,.96);
      }
    }

    @media (max-width: 520px) {
      #${BUTTON_ID} {
        right: 16px;
        bottom: 18px;
      }

      #${DRAWER_ID} {
        right: 8px;
        top: 8px;
        bottom: 8px;
        width: calc(100vw - 16px);
        border-radius: 24px;
      }

      #${DRAWER_ID} .tg-summary {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      #${DRAWER_ID} .tg-meta-grid,
      #${DRAWER_ID} .tg-task-meta {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      #${DRAWER_ID} .tg-date-filter-row {
        flex-wrap: wrap;
      }
    }

    /* TG Assistant frontend refactor: task-first shell and a bounded launcher material. */
    #${ROOT_ID} {
      all: initial;
      position: fixed;
      inset: 0;
      z-index: 2147483646;
      pointer-events: none;
      font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, "Microsoft YaHei", sans-serif;
      color: #eef6ff;
    }

    #${ROOT_ID} *, #${ROOT_ID} *::before, #${ROOT_ID} *::after { box-sizing: border-box; }
    #${ROOT_ID} button, #${ROOT_ID} input, #${ROOT_ID} select, #${ROOT_ID} textarea { font: inherit; }
    #${ROOT_ID} button { -webkit-tap-highlight-color: transparent; }

    #${BUTTON_ID}.tg2-launcher {
      pointer-events: auto;
      position: fixed;
      right: 16px;
      top: auto;
      bottom: 104px;
      min-width: 148px;
      min-height: 52px;
      padding: 0 17px 0 13px;
      display: inline-flex;
      align-items: center;
      gap: 10px;
      border: 1px solid rgba(184, 230, 255, .42);
      border-radius: 18px;
      background: linear-gradient(145deg, rgba(30, 55, 75, .86), rgba(8, 19, 32, .92));
      color: #f3fbff;
      box-shadow: 0 18px 44px rgba(0, 0, 0, .34), inset 0 1px 0 rgba(255,255,255,.28), 0 0 0 1px rgba(100, 205, 255, .08);
      cursor: pointer;
      user-select: none;
      touch-action: none;
      transition: transform .2s cubic-bezier(.2,.8,.2,1), border-color .2s ease, box-shadow .2s ease, opacity .2s ease;
      overflow: visible;
    }

    #${BUTTON_ID}.tg2-launcher::before {
      content: "";
      position: absolute;
      inset: 1px;
      border-radius: 17px;
      pointer-events: none;
      background: radial-gradient(circle at var(--tg-mouse-x, 28%) var(--tg-mouse-y, 18%), rgba(255,255,255,.42), transparent 35%), linear-gradient(120deg, transparent 16%, rgba(215,248,255,.2) 42%, transparent 68%);
      filter: url(#${SVG_FILTER_ID});
      opacity: .72;
    }

    #${BUTTON_ID}.tg2-launcher:hover { transform: translateY(-2px); border-color: rgba(203, 241, 255, .76); box-shadow: 0 22px 52px rgba(0,0,0,.42), inset 0 1px 0 rgba(255,255,255,.38), 0 0 26px rgba(76, 204, 255, .14); }
    #${BUTTON_ID}.tg2-launcher:active, #${BUTTON_ID}.tg2-launcher.tg2-pressed { transform: translateY(1px) scale(.985); }
    #${BUTTON_ID}.tg2-launcher.tg2-idle { transform: translateX(62%); opacity: .78; }
    #${BUTTON_ID}.tg2-launcher.tg2-idle:hover { transform: translateX(0) translateY(-2px); opacity: 1; }
    #${BUTTON_ID}.tg2-launcher.tg2-dragging { cursor: grabbing; transition: none; }

    #${BUTTON_ID} .tg2-launcher-icon {
      position: relative;
      width: 28px;
      height: 28px;
      display: inline-grid;
      place-items: center;
      flex: 0 0 auto;
      border: 1px solid rgba(184,230,255,.4);
      border-radius: 10px;
      background: rgba(108, 208, 244, .14);
      color: #a9efff;
    }
    #${BUTTON_ID} .tg2-launcher-icon svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.8; }
    #${BUTTON_ID} .tg2-launcher-label { position: relative; min-width: 0; font-size: 13px; font-weight: 760; white-space: nowrap; }
    #${BUTTON_ID} .tg2-launcher-status { position: relative; width: 6px; height: 6px; margin-left: auto; border-radius: 50%; background: #55e4b1; box-shadow: 0 0 12px rgba(85,228,177,.7); }
    #${BUTTON_ID} .tg2-launcher-status.tg2-status-warn { background: #ffbd5c; box-shadow: 0 0 12px rgba(255,189,92,.72); }
    #${BUTTON_ID} .tg2-launcher-status.tg2-status-error { background: #ff708c; box-shadow: 0 0 12px rgba(255,112,140,.72); }
    #${BUTTON_ID} .tg2-launcher-badge { position: absolute; right: -7px; top: -9px; min-width: 22px; height: 22px; padding: 0 6px; display: grid; place-items: center; border: 1px solid rgba(255,255,255,.72); border-radius: 999px; background: #e95d76; color: #fff; font-size: 11px; font-weight: 800; box-shadow: 0 8px 18px rgba(233,93,118,.3); }
    #${BUTTON_ID}[data-launcher-size="small"] { min-width: 112px; }
    #${BUTTON_ID}[data-launcher-size="standard"] { min-width: 148px; }
    #${BUTTON_ID}[data-launcher-size="large"] { min-width: 188px; min-height: 58px; }
    #${BUTTON_ID}[data-visual-mode="static"]::before, #${BUTTON_ID}[data-visual-mode="energy"]::before { filter: none; opacity: .38; }
    #${BUTTON_ID}[data-visual-mode="high"]::before { opacity: .9; }

    #${DRAWER_ID}.tg2-panel {
      pointer-events: auto;
      position: fixed;
      right: 16px;
      top: 16px;
      width: min(560px, calc(100vw - 32px));
      height: min(780px, calc(100vh - 32px));
      min-width: 320px;
      min-height: 420px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border: 1px solid rgba(179, 224, 247, .28);
      border-radius: 22px;
      background: linear-gradient(160deg, rgba(12, 27, 41, .9), rgba(5, 12, 22, .95));
      box-shadow: -24px 30px 80px rgba(0,0,0,.42), inset 0 1px 0 rgba(255,255,255,.16), 0 0 0 1px rgba(101, 199, 239, .05);
      backdrop-filter: blur(25px) saturate(150%);
      -webkit-backdrop-filter: blur(25px) saturate(150%);
      visibility: hidden;
      opacity: 0;
      transform: translateX(16px) scale(.985);
      transition: transform .22s cubic-bezier(.2,.8,.2,1), opacity .18s ease, visibility 0s linear .22s;
    }
    #${DRAWER_ID}.tg2-panel.tg-open { visibility: visible; opacity: 1; transform: translateX(0) scale(1); transition-delay: 0s; }
    #${DRAWER_ID}.tg2-panel::before { content: ""; position: absolute; inset: 0; pointer-events: none; background: linear-gradient(135deg, rgba(216,249,255,.1), transparent 25%), radial-gradient(circle at var(--tg-mouse-x, 80%) var(--tg-mouse-y, 12%), rgba(65,198,239,.1), transparent 28%); }

    #${DRAWER_ID} .tg2-header { position: relative; z-index: 1; flex: 0 0 auto; padding: 17px 18px 14px; border-bottom: 1px solid rgba(174,220,240,.16); background: rgba(11, 27, 42, .55); }
    #${DRAWER_ID} .tg2-header-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
    #${DRAWER_ID} .tg2-title { min-width: 0; }
    #${DRAWER_ID} .tg2-title-main { color: #f4fbff; font-size: 20px; font-weight: 820; letter-spacing: -.02em; }
    #${DRAWER_ID} .tg2-title-kicker { margin-top: 4px; color: rgba(178,208,224,.74); font-size: 11px; }
    #${DRAWER_ID} .tg2-header-actions { display: flex; gap: 6px; flex: 0 0 auto; }
    #${DRAWER_ID} .tg2-icon-button, #${DRAWER_ID} .tg2-plain-button { min-width: 36px; min-height: 36px; border: 1px solid rgba(178,224,244,.2); border-radius: 11px; background: rgba(255,255,255,.06); color: rgba(232,247,255,.92); cursor: pointer; }
    #${DRAWER_ID} .tg2-icon-button:hover, #${DRAWER_ID} .tg2-plain-button:hover { border-color: rgba(183,234,255,.54); background: rgba(104,199,237,.14); }
    #${DRAWER_ID} .tg2-refresh-button { padding: 0 11px; font-size: 12px; font-weight: 740; }
    #${DRAWER_ID} .tg2-connection { position: relative; display: flex; align-items: center; gap: 7px; min-height: 22px; margin-top: 10px; color: rgba(176,213,229,.78); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #${DRAWER_ID} .tg2-connection-dot { width: 7px; height: 7px; flex: 0 0 auto; border-radius: 50%; background: #55e4b1; box-shadow: 0 0 10px rgba(85,228,177,.58); }
    #${DRAWER_ID} .tg2-connection.tg2-warn .tg2-connection-dot { background: #ffbd5c; box-shadow: 0 0 10px rgba(255,189,92,.58); }
    #${DRAWER_ID} .tg2-connection.tg2-error .tg2-connection-dot { background: #ff708c; box-shadow: 0 0 10px rgba(255,112,140,.58); }

    #${DRAWER_ID} .tg2-tabs { position: relative; z-index: 1; display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 5px; margin-top: 14px; }
    #${DRAWER_ID} .tg2-tab { min-height: 34px; padding: 0 6px; border: 1px solid transparent; border-radius: 9px; background: transparent; color: rgba(176,206,222,.72); cursor: pointer; font-size: 11px; font-weight: 720; }
    #${DRAWER_ID} .tg2-tab:hover { color: #ebfaff; background: rgba(255,255,255,.06); }
    #${DRAWER_ID} .tg2-tab.tg2-selected { border-color: rgba(117,214,246,.3); background: rgba(74,177,217,.15); color: #d9f7ff; }

    #${DRAWER_ID} .tg2-body { position: relative; z-index: 1; flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 16px 18px 18px; scrollbar-width: thin; scrollbar-color: rgba(102,201,235,.32) transparent; }
    #${DRAWER_ID} .tg2-body::-webkit-scrollbar { width: 8px; }
    #${DRAWER_ID} .tg2-body::-webkit-scrollbar-thumb { border: 2px solid transparent; border-radius: 999px; background: rgba(102,201,235,.28); background-clip: padding-box; }
    #${DRAWER_ID} .tg2-summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-bottom: 15px; }
    #${DRAWER_ID} .tg2-summary-item { min-width: 0; padding: 11px 12px; border: 1px solid rgba(174,220,240,.17); border-radius: 13px; background: rgba(17,39,55,.64); text-align: left; cursor: pointer; }
    #${DRAWER_ID} .tg2-summary-item:hover { border-color: rgba(120,215,248,.44); background: rgba(29,67,87,.74); }
    #${DRAWER_ID} .tg2-summary-number { color: #f2fbff; font-size: 24px; font-weight: 820; line-height: 1; }
    #${DRAWER_ID} .tg2-summary-label { margin-top: 5px; color: rgba(177,211,226,.74); font-size: 11px; }
    #${DRAWER_ID} .tg2-summary-item.tg2-urgent .tg2-summary-number { color: #ff8298; }
    #${DRAWER_ID} .tg2-summary-item.tg2-exam .tg2-summary-number { color: #ffd27e; }
    #${DRAWER_ID} .tg2-refresh-status { margin-bottom: 13px; padding: 10px 12px; border: 1px solid rgba(174,220,240,.16); border-radius: 12px; background: rgba(16,37,53,.62); }
    #${DRAWER_ID} .tg2-refresh-status.tg-refresh-failed { border-color: rgba(255,112,140,.38); }
    #${DRAWER_ID} .tg2-refresh-status.tg-refresh-done { border-color: rgba(85,228,177,.28); }
    #${DRAWER_ID} .tg2-refresh-line { display: flex; justify-content: space-between; gap: 10px; color: #e6f8ff; font-size: 12px; font-weight: 760; }
    #${DRAWER_ID} .tg2-refresh-detail { margin-top: 4px; color: rgba(176,210,225,.74); font-size: 11px; line-height: 1.45; overflow-wrap: anywhere; }
    #${DRAWER_ID} .tg2-progress { height: 4px; margin-top: 9px; overflow: hidden; border-radius: 99px; background: rgba(255,255,255,.08); }
    #${DRAWER_ID} .tg2-progress > span { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, #6be1ff, #65c6ff); transition: width .2s ease; }
    #${DRAWER_ID} .tg2-view-caption { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin: 0 2px 10px; }
    #${DRAWER_ID} .tg2-view-title { color: #eaf8ff; font-size: 13px; font-weight: 800; }
    #${DRAWER_ID} .tg2-view-count { color: rgba(176,210,225,.7); font-size: 11px; }
    #${DRAWER_ID} .tg2-filter-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 13px; color: rgba(176,210,225,.7); font-size: 11px; }
    #${DRAWER_ID} .tg2-filter-controls { display: flex; gap: 6px; }
    #${DRAWER_ID} .tg2-filter-controls select { max-width: 84px; min-height: 30px; padding: 0 7px; border: 1px solid rgba(174,220,240,.18); border-radius: 8px; background: rgba(8,22,34,.72); color: #dff6ff; font-size: 11px; }

    #${DRAWER_ID} .tg2-task-list { display: grid; gap: 7px; }
    #${DRAWER_ID} .tg2-task-row { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; min-width: 0; padding: 12px 11px 11px 14px; border: 1px solid rgba(174,220,240,.13); border-left: 3px solid rgba(137,193,213,.28); border-radius: 12px; background: rgba(13,33,49,.76); }
    #${DRAWER_ID} .tg2-task-row:hover { border-color: rgba(121,211,243,.38); background: rgba(21,50,68,.84); }
    #${DRAWER_ID} .tg2-task-row.tg-state-bad { border-left-color: #ff708c; }
    #${DRAWER_ID} .tg2-task-row.tg-state-warn { border-left-color: #ffbd5c; }
    #${DRAWER_ID} .tg2-task-row.tg-state-ok { border-left-color: #55e4b1; opacity: .66; }
    #${DRAWER_ID} .tg2-task-row.tg2-ignored { opacity: .72; }
    #${DRAWER_ID} .tg2-task-deadline { display: flex; align-items: center; gap: 6px; color: #ffbd5c; font-size: 11px; font-weight: 780; }
    #${DRAWER_ID} .tg2-task-deadline.tg2-bad { color: #ff8298; }
    #${DRAWER_ID} .tg2-task-deadline.tg2-ok { color: #87e5c1; }
    #${DRAWER_ID} .tg2-deadline-dot { width: 6px; height: 6px; flex: 0 0 auto; border-radius: 50%; background: currentColor; box-shadow: 0 0 9px currentColor; }
    #${DRAWER_ID} .tg2-task-title { margin-top: 5px; color: #f0faff; font-size: 14px; font-weight: 780; line-height: 1.34; overflow-wrap: anywhere; }
    #${DRAWER_ID} .tg2-task-context { margin-top: 5px; color: rgba(176,211,226,.72); font-size: 11px; line-height: 1.4; overflow-wrap: anywhere; }
    #${DRAWER_ID} .tg2-task-status { margin-top: 6px; color: rgba(176,211,226,.66); font-size: 10px; }
    #${DRAWER_ID} .tg2-task-row.tg-state-bad .tg2-task-status { color: #ff9aae; }
    #${DRAWER_ID} .tg2-task-row.tg-state-ok .tg2-task-status { color: #87e5c1; }
    #${DRAWER_ID} .tg2-task-actions { display: flex; align-items: flex-start; gap: 5px; }
    #${DRAWER_ID} .tg2-row-button { min-width: 34px; min-height: 34px; padding: 0 8px; border: 1px solid rgba(174,220,240,.16); border-radius: 9px; background: rgba(255,255,255,.05); color: rgba(222,244,253,.88); cursor: pointer; font-size: 11px; }
    #${DRAWER_ID} .tg2-row-button:hover { border-color: rgba(121,211,243,.5); background: rgba(92,192,231,.15); }
    #${DRAWER_ID} .tg2-row-button.tg2-danger-action:hover { border-color: rgba(255,112,140,.5); background: rgba(180,48,78,.18); }
    #${DRAWER_ID} .tg2-ignored-label { display: inline-flex; margin-top: 5px; padding: 2px 6px; border: 1px solid rgba(184,197,209,.22); border-radius: 99px; color: rgba(205,218,228,.72); font-size: 10px; }

    #${DRAWER_ID} .tg2-course-list { display: grid; gap: 7px; }
    #${DRAWER_ID} .tg2-course-group { border: 1px solid rgba(174,220,240,.14); border-radius: 13px; background: rgba(13,33,49,.72); overflow: hidden; }
    #${DRAWER_ID} .tg2-course-head { display: grid; grid-template-columns: minmax(0,1fr) auto auto; gap: 8px; align-items: center; padding: 12px; }
    #${DRAWER_ID} .tg2-course-name { min-width: 0; color: #effaff; font-size: 13px; font-weight: 780; overflow-wrap: anywhere; }
    #${DRAWER_ID} .tg2-course-stats { margin-top: 4px; color: rgba(176,211,226,.7); font-size: 10px; }
    #${DRAWER_ID} .tg2-pin { color: #ffd27e; font-size: 13px; }
    #${DRAWER_ID} .tg2-course-tasks { padding: 0 10px 10px; }
    #${DRAWER_ID} .tg2-course-group.tg2-collapsed .tg2-course-tasks { display: none; }
    #${DRAWER_ID} .tg2-course-task { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 2px; border-top: 1px solid rgba(174,220,240,.1); }
    #${DRAWER_ID} .tg2-course-task-title { min-width: 0; color: rgba(231,247,255,.9); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #${DRAWER_ID} .tg2-course-task-meta { flex: 0 0 auto; color: rgba(176,211,226,.68); font-size: 10px; }

    #${DRAWER_ID} .tg2-empty, #${DRAWER_ID} .tg2-alert { padding: 15px; border: 1px solid rgba(174,220,240,.14); border-radius: 12px; background: rgba(14,36,52,.7); color: rgba(196,222,234,.8); font-size: 12px; line-height: 1.6; }
    #${DRAWER_ID} .tg2-alert { border-color: rgba(255,112,140,.3); color: #ffc2cc; background: rgba(82,24,40,.38); }
    #${DRAWER_ID} .tg2-empty strong, #${DRAWER_ID} .tg2-alert strong { color: #f1fbff; }
    #${DRAWER_ID} .tg2-menu { position: absolute; z-index: 5; top: 58px; right: 12px; width: min(280px, calc(100% - 24px)); padding: 8px; border: 1px solid rgba(182,225,243,.28); border-radius: 14px; background: rgba(8,22,35,.96); box-shadow: 0 18px 48px rgba(0,0,0,.42); backdrop-filter: blur(18px) saturate(150%); -webkit-backdrop-filter: blur(18px) saturate(150%); }
    #${DRAWER_ID} .tg2-menu[hidden] { display: none; }
    #${DRAWER_ID} .tg2-menu-title { padding: 6px 8px 5px; color: rgba(169,207,224,.64); font-size: 10px; font-weight: 760; text-transform: uppercase; letter-spacing: .08em; }
    #${DRAWER_ID} .tg2-menu-item { display: flex; align-items: center; justify-content: space-between; width: 100%; min-height: 34px; padding: 0 8px; border: 0; border-radius: 8px; background: transparent; color: rgba(226,246,255,.9); cursor: pointer; text-align: left; font-size: 11px; }
    #${DRAWER_ID} .tg2-menu-item:hover { background: rgba(93,193,231,.14); }
    #${DRAWER_ID} .tg2-menu-divider { height: 1px; margin: 6px 4px; background: rgba(182,225,243,.12); }
    #${DRAWER_ID} .tg2-menu-control { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 34px; padding: 0 8px; color: rgba(226,246,255,.84); font-size: 11px; }
    #${DRAWER_ID} .tg2-menu-control span { min-width: 0; }
    #${DRAWER_ID} .tg2-menu-control small { display: block; margin-top: 2px; color: var(--tg-fg-tertiary); font-size: 9px; line-height: 1.35; }
    #${DRAWER_ID} .tg2-menu-control select { max-width: 125px; min-height: 28px; border: 1px solid rgba(182,225,243,.18); border-radius: 7px; background: rgba(2,11,20,.76); color: #e5f7ff; font-size: 10px; }
    #${DRAWER_ID} .tg2-menu-control input[type="checkbox"] { flex: 0 0 auto; accent-color: #6f9dff; }
    #${DRAWER_ID} .tg2-shortcut-state { padding: 4px 8px 7px; color: rgba(169,207,224,.68); font-size: 10px; line-height: 1.45; }
    #${DRAWER_ID} .tg2-footer { position: relative; z-index: 1; display: flex; align-items: center; justify-content: space-between; gap: 10px; flex: 0 0 auto; min-height: 42px; padding: 0 18px; border-top: 1px solid rgba(174,220,240,.12); color: rgba(169,207,224,.64); font-size: 10px; }
    #${DRAWER_ID} .tg2-footer button { border: 0; background: transparent; color: rgba(178,222,239,.78); cursor: pointer; font-size: 10px; }
    #${DRAWER_ID} .tg2-footer button:hover { color: #e3f8ff; }
    #${DRAWER_ID} textarea.tg2-json-box { width: 100%; min-height: 220px; margin-top: 10px; padding: 10px; border: 1px solid rgba(174,220,240,.18); border-radius: 10px; background: rgba(2,10,18,.8); color: #dff5ff; font: 11px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace; resize: vertical; }

    @media (max-width: 560px) {
      #${BUTTON_ID}.tg2-launcher { right: 10px; bottom: 76px; min-width: 52px; width: 52px; height: 52px; padding: 0; justify-content: center; border-radius: 16px; }
      #${BUTTON_ID} .tg2-launcher-label, #${BUTTON_ID} .tg2-launcher-status { display: none; }
      #${DRAWER_ID}.tg2-panel { right: 8px; top: 8px; width: calc(100vw - 16px); height: calc(100vh - 16px); min-width: 0; min-height: 360px; border-radius: 18px; }
      #${DRAWER_ID} .tg2-header { padding: 14px 13px 11px; }
      #${DRAWER_ID} .tg2-body { padding: 13px; }
      #${DRAWER_ID} .tg2-footer { padding: 0 13px; }
    }

    @media (prefers-reduced-motion: reduce) {
      #${BUTTON_ID}.tg2-launcher, #${DRAWER_ID}.tg2-panel { transition-duration: .01ms; }
      #${DRAWER_ID} .tg2-progress > span { transition: none; }
    }

    /* TG Assistant glass material pass: visual-only overrides for the existing UI contract. */
    #${ROOT_ID} {
      color: var(--tg-fg-primary);
      --tg-fg-primary: #243652;
      --tg-fg-secondary: rgba(36, 56, 85, .78);
      --tg-fg-tertiary: rgba(35, 56, 84, .6);
      --tg-fg-muted: rgba(38, 59, 88, .5);
      --tg-icon: rgba(24, 44, 72, .84);
      --tg-border: rgba(70, 104, 145, .22);
      --tg-control-bg: rgba(255,255,255,.42);
      --tg-control-hover: rgba(255,255,255,.64);
      --tg-card-bg: rgba(255,255,255,.34);
    }
    #${ROOT_ID}[data-backdrop-tone="light"] {
      --tg-fg-primary: #17243A;
      --tg-fg-secondary: rgba(28, 48, 76, .72);
      --tg-fg-tertiary: rgba(35, 56, 84, .55);
      --tg-fg-muted: rgba(38, 59, 88, .43);
      --tg-icon: rgba(24, 44, 72, .86);
      --tg-border: rgba(70, 104, 145, .16);
      --tg-control-bg: rgba(255,255,255,.38);
      --tg-control-hover: rgba(255,255,255,.6);
      --tg-card-bg: rgba(255,255,255,.3);
    }
    #${ROOT_ID}[data-backdrop-tone="dark"] {
      --tg-fg-primary: rgba(248, 251, 255, .96);
      --tg-fg-secondary: rgba(229, 238, 250, .76);
      --tg-fg-tertiary: rgba(216, 228, 243, .57);
      --tg-fg-muted: rgba(205, 220, 239, .44);
      --tg-icon: rgba(245, 249, 255, .9);
      --tg-border: rgba(225, 238, 255, .15);
      --tg-control-bg: rgba(15,29,52,.3);
      --tg-control-hover: rgba(38,59,91,.46);
      --tg-card-bg: rgba(15,29,52,.24);
    }
    #${ROOT_ID}[data-backdrop-tone="neutral"] {
      --tg-fg-primary: #243652;
      --tg-fg-secondary: rgba(36, 56, 85, .78);
      --tg-fg-tertiary: rgba(35, 56, 84, .6);
      --tg-fg-muted: rgba(38, 59, 88, .5);
      --tg-icon: rgba(24, 44, 72, .84);
      --tg-border: rgba(70, 104, 145, .22);
      --tg-control-bg: rgba(255,255,255,.42);
      --tg-control-hover: rgba(255,255,255,.64);
      --tg-card-bg: rgba(255,255,255,.34);
    }
    #${ROOT_ID} .tg2-panel, #${ROOT_ID} .tg2-panel *, #${ROOT_ID} .tg2-launcher { transition: color .15s ease, border-color .15s ease, background-color .15s ease; }
    #${BUTTON_ID}.tg2-launcher {
      border-color: rgba(255,255,255,.72);
      background: linear-gradient(135deg, rgba(255,255,255,.72), rgba(217,232,255,.42) 58%, rgba(198,211,255,.32));
      color: #17253d;
      box-shadow: 0 18px 42px rgba(46,67,112,.18), inset 0 1px 0 rgba(255,255,255,.9), 0 0 0 1px rgba(129,153,214,.12);
      backdrop-filter: blur(22px) saturate(155%);
      -webkit-backdrop-filter: blur(22px) saturate(155%);
    }
    #${BUTTON_ID}.tg2-launcher::before {
      background: radial-gradient(circle at var(--tg-mouse-x, 28%) var(--tg-mouse-y, 18%), rgba(255,255,255,.8), transparent 34%), linear-gradient(120deg, transparent 16%, rgba(159,192,255,.22) 42%, transparent 68%);
      opacity: .78;
    }
    #${BUTTON_ID}.tg2-launcher:hover { border-color: rgba(255,255,255,.96); box-shadow: 0 22px 50px rgba(46,67,112,.24), inset 0 1px 0 rgba(255,255,255,.98), 0 0 24px rgba(116,144,255,.16); }
    #${BUTTON_ID} .tg2-launcher-icon { border-color: rgba(117,143,211,.25); background: rgba(255,255,255,.45); color: #536ac2; }
    #${BUTTON_ID} .tg2-launcher-label { color: #17253d; }

    #${DRAWER_ID}.tg2-panel {
      border-color: rgba(255,255,255,.72);
      border-radius: 26px;
      background: linear-gradient(145deg, rgba(250,253,255,.68), rgba(224,234,255,.48) 52%, rgba(218,222,255,.4));
      box-shadow: -18px 28px 70px rgba(49,66,111,.2), inset 0 1px 0 rgba(255,255,255,.94), 0 0 0 1px rgba(119,145,210,.1);
      backdrop-filter: blur(30px) saturate(165%);
      -webkit-backdrop-filter: blur(30px) saturate(165%);
    }
    #${DRAWER_ID}.tg2-panel::before { background: linear-gradient(135deg, rgba(255,255,255,.42), transparent 27%), radial-gradient(circle at var(--tg-mouse-x, 80%) var(--tg-mouse-y, 12%), rgba(126,157,255,.2), transparent 32%), radial-gradient(circle at 12% 92%, rgba(170,225,255,.18), transparent 30%); }
    #${DRAWER_ID} .tg2-header { padding: 19px 20px 15px; border-bottom-color: rgba(103,126,181,.16); background: linear-gradient(180deg, rgba(255,255,255,.42), rgba(236,242,255,.2)); }
    #${DRAWER_ID} .tg2-title-main, #${DRAWER_ID} .tg2-view-title, #${DRAWER_ID} .tg2-empty strong, #${DRAWER_ID} .tg2-alert strong { color: var(--tg-fg-primary); }
    #${DRAWER_ID} .tg2-title-kicker, #${DRAWER_ID} .tg2-view-count, #${DRAWER_ID} .tg2-filter-row, #${DRAWER_ID} .tg2-task-context, #${DRAWER_ID} .tg2-task-status, #${DRAWER_ID} .tg2-course-stats { color: var(--tg-fg-tertiary); }
    #${DRAWER_ID} .tg2-title-main { letter-spacing: -.035em; }
    #${DRAWER_ID} .tg2-icon-button, #${DRAWER_ID} .tg2-plain-button, #${DRAWER_ID} .tg2-row-button {
      border-color: rgba(111,134,190,.24);
      background: rgba(255,255,255,.42);
      color: var(--tg-icon);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.72);
      backdrop-filter: blur(12px) saturate(145%);
      -webkit-backdrop-filter: blur(12px) saturate(145%);
    }
    #${DRAWER_ID} .tg2-icon-button:hover, #${DRAWER_ID} .tg2-plain-button:hover, #${DRAWER_ID} .tg2-row-button:hover { border-color: rgba(91,119,194,.48); background: rgba(255,255,255,.68); color: #233a68; }
    #${DRAWER_ID} .tg2-tabs { margin-top: 13px; }
    #${DRAWER_ID} .tg2-tab { color: var(--tg-fg-secondary); }
    #${DRAWER_ID} .tg2-tab:hover { color: var(--tg-fg-primary); background: var(--tg-control-hover); }
    #${DRAWER_ID} .tg2-tab.tg2-selected { border-color: var(--tg-border); background: var(--tg-control-bg); color: var(--tg-fg-primary); box-shadow: inset 0 1px 0 rgba(255,255,255,.7); }
    #${DRAWER_ID} .tg2-summary-item, #${DRAWER_ID} .tg2-refresh-status, #${DRAWER_ID} .tg2-task-row, #${DRAWER_ID} .tg2-course-group, #${DRAWER_ID} .tg2-empty, #${DRAWER_ID} .tg2-alert {
      border-color: rgba(111,134,190,.2);
      background: var(--tg-card-bg);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.62), 0 8px 24px rgba(74,96,145,.07);
      backdrop-filter: blur(16px) saturate(145%);
      -webkit-backdrop-filter: blur(16px) saturate(145%);
    }
    #${DRAWER_ID} .tg2-summary-item:hover, #${DRAWER_ID} .tg2-task-row:hover, #${DRAWER_ID} .tg2-course-group:hover { border-color: rgba(91,119,194,.36); background: rgba(255,255,255,.52); }
    #${DRAWER_ID} .tg2-summary-number { color: var(--tg-fg-primary); }
    #${DRAWER_ID} .tg2-summary-label, #${DRAWER_ID} .tg2-course-task-meta { color: var(--tg-fg-tertiary); }
    #${DRAWER_ID} .tg2-task-title, #${DRAWER_ID} .tg2-course-name { color: var(--tg-fg-primary); }
    #${DRAWER_ID} .tg2-task-row.tg-state-ok { opacity: .58; }
    #${DRAWER_ID} .tg2-task-row.tg2-ignored { opacity: .58; }
    #${DRAWER_ID} .tg2-filter-controls select, #${DRAWER_ID} .tg2-menu-control select { border-color: var(--tg-border); background: var(--tg-control-bg); color: var(--tg-fg-primary); }
    #${DRAWER_ID} .tg2-progress { background: rgba(93,116,173,.14); }
    #${DRAWER_ID} .tg2-progress > span { background: linear-gradient(90deg, #6ba8ff, #8b83ed); }
    #${DRAWER_ID} .tg2-menu { top: 64px; border-color: rgba(255,255,255,.72); background: linear-gradient(145deg, rgba(250,253,255,.82), rgba(225,233,255,.72)); box-shadow: 0 18px 48px rgba(49,66,111,.2), inset 0 1px 0 rgba(255,255,255,.9); }
    #${DRAWER_ID} .tg2-menu-title { color: var(--tg-fg-muted); }
    #${DRAWER_ID} .tg2-menu-item, #${DRAWER_ID} .tg2-menu-control { color: var(--tg-fg-secondary); }
    #${DRAWER_ID} .tg2-menu-item:hover { background: var(--tg-control-hover); color: var(--tg-fg-primary); }
    #${DRAWER_ID} .tg2-menu-divider { background: rgba(111,134,190,.16); }
    #${DRAWER_ID} .tg2-shortcut-state { color: var(--tg-fg-tertiary); }
    #${DRAWER_ID} .tg2-footer { border-top-color: var(--tg-border); color: var(--tg-fg-tertiary); }
    #${DRAWER_ID} .tg2-footer button { color: var(--tg-fg-secondary); }
    #${DRAWER_ID} textarea.tg2-json-box { border-color: rgba(111,134,190,.22); background: rgba(247,250,255,.62); color: #263c65; }
    #${DRAWER_ID} .tg2-connection { display: inline-flex; width: fit-content; max-width: 100%; padding: 5px 9px; border: 1px solid var(--tg-border); border-radius: 999px; background: var(--tg-control-bg); color: var(--tg-fg-secondary); }
    #${DRAWER_ID} .tg2-connection-dot { width: 6px; height: 6px; box-shadow: 0 0 9px currentColor; }
    #${DRAWER_ID} .tg2-menu-section { margin: 2px 4px 4px; padding: 3px 4px; color: var(--tg-fg-muted); font-size: 10px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    #${DRAWER_ID} .tg2-menu-note { margin: 2px 8px 7px; color: var(--tg-fg-tertiary); font-size: 10px; line-height: 1.45; }
    #${BUTTON_ID}.tg2-launcher { min-width: 112px; width: 112px; min-height: 48px; padding: 0 12px 0 10px; border-radius: 16px; }
    #${DRAWER_ID}.tg2-panel { resize: none; }
    #${DRAWER_ID} .tg2-header { cursor: grab; touch-action: none; }
    #${DRAWER_ID}.tg2-panel-locked .tg2-header { cursor: default; }
    #${DRAWER_ID} .tg2-header.tg2-panel-dragging { cursor: grabbing; }
    #${DRAWER_ID}[data-resize-direction="e"], #${DRAWER_ID}[data-resize-direction="w"] { cursor: ew-resize; }
    #${DRAWER_ID}[data-resize-direction="n"], #${DRAWER_ID}[data-resize-direction="s"] { cursor: ns-resize; }
    #${DRAWER_ID}[data-resize-direction="nw"], #${DRAWER_ID}[data-resize-direction="se"] { cursor: nwse-resize; }
    #${DRAWER_ID}[data-resize-direction="ne"], #${DRAWER_ID}[data-resize-direction="sw"] { cursor: nesw-resize; }
    #${DRAWER_ID}[data-resizing] { user-select: none; }
    #${DRAWER_ID}[data-resizing="nw"], #${DRAWER_ID}[data-resizing="se"] { cursor: nwse-resize !important; }
    #${DRAWER_ID}[data-resizing="ne"], #${DRAWER_ID}[data-resizing="sw"] { cursor: nesw-resize !important; }
    #${DRAWER_ID}[data-resizing="n"], #${DRAWER_ID}[data-resizing="s"] { cursor: ns-resize !important; }
    #${DRAWER_ID}[data-resizing="e"], #${DRAWER_ID}[data-resizing="w"] { cursor: ew-resize !important; }
    #${DRAWER_ID} .tg2-latency-button { min-width: 48px; padding: 0 8px; font-size: 10px; font-variant-numeric: tabular-nums; }
    #${DRAWER_ID}.tg2-panel { background: linear-gradient(145deg, rgba(250,253,255,.55), rgba(224,234,255,.3) 52%, rgba(218,226,244,.26)); }
    #${DRAWER_ID}.tg2-panel::before { background: linear-gradient(135deg, rgba(255,255,255,.24), transparent 30%), radial-gradient(circle at var(--tg-mouse-x, 80%) var(--tg-mouse-y, 12%), rgba(126,157,255,.07), transparent 32%), radial-gradient(circle at 12% 92%, rgba(170,225,255,.06), transparent 30%); }
    #${DRAWER_ID} .tg2-header { background: linear-gradient(180deg, rgba(255,255,255,.27), rgba(236,242,255,.1)); }
    #${DRAWER_ID} .tg2-summary-item { background: rgba(255,255,255,.26); }
    #${DRAWER_ID} .tg2-task-row { background: rgba(255,255,255,.18); box-shadow: inset 0 1px 0 rgba(255,255,255,.42), 0 6px 18px rgba(74,96,145,.045); backdrop-filter: none; -webkit-backdrop-filter: none; }
    #${DRAWER_ID} .tg2-task-row:hover { background: rgba(255,255,255,.32); }
    #${DRAWER_ID} .tg2-refresh-line { color: var(--tg-fg-primary) !important; }
    #${DRAWER_ID} .tg2-refresh-detail { color: var(--tg-fg-secondary) !important; }
    #${DRAWER_ID} .tg2-task-context, #${DRAWER_ID} .tg2-task-status, #${DRAWER_ID} .tg2-course-stats, #${DRAWER_ID} .tg2-course-task-title { color: var(--tg-fg-secondary) !important; }
    #${DRAWER_ID} .tg2-footer { color: var(--tg-fg-tertiary) !important; }
    #${DRAWER_ID} .tg2-footer button { color: var(--tg-fg-secondary) !important; }
    #${DRAWER_ID} .tg2-menu-control, #${DRAWER_ID} .tg2-menu-item { color: var(--tg-fg-secondary); }
    .tg-task-assistant-navigation-highlight { outline: 3px solid rgba(92, 126, 255, .82) !important; outline-offset: 4px; box-shadow: 0 0 0 7px rgba(92, 126, 255, .16), 0 10px 28px rgba(44, 72, 150, .18) !important; background-image: linear-gradient(90deg, rgba(92, 126, 255, .12), transparent) !important; }
    @media (prefers-reduced-motion: no-preference) { .tg-task-assistant-navigation-highlight { animation: tg-task-assistant-navigation-pulse 1.4s ease-out 2; } }
    @keyframes tg-task-assistant-navigation-pulse { 0%, 100% { outline-color: rgba(92, 126, 255, .82); } 50% { outline-color: rgba(92, 126, 255, .36); } }
    @supports not ((backdrop-filter: blur(1px))) {
      #${DRAWER_ID}.tg2-panel, #${BUTTON_ID}.tg2-launcher, #${DRAWER_ID} .tg2-summary-item, #${DRAWER_ID} .tg2-refresh-status, #${DRAWER_ID} .tg2-task-row, #${DRAWER_ID} .tg2-course-group, #${DRAWER_ID} .tg2-menu { background: rgba(241,246,255,.94); }
    }
  `;

  if (typeof GM_addStyle === "function") {
    GM_addStyle(css);
  } else {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
  }

  async function getValue(key, defaultValue) {
    const traceRead = initialHydrationTraceActive;
    const startedAt = performance.now();
    if (typeof GM_getValue === "function") {
      try {
        const value = GM_getValue(key, defaultValue);
        if (traceRead) {
          logInitialStorageCheckpoint(key, "GM_getValue", "done", {
            started: Math.round(startedAt * 100) / 100,
            finished: Math.round(performance.now() * 100) / 100
          });
        }
        return value;
      } catch (error) {
        if (traceRead) {
          logInitialStorageCheckpoint(key, "GM_getValue", "error", {
            started: Math.round(startedAt * 100) / 100,
            finished: Math.round(performance.now() * 100) / 100,
            error: error?.message || String(error)
          });
        }
        throw error;
      }
    }

    if (typeof GM !== "undefined" && typeof GM.getValue === "function") {
      try {
        const value = await GM.getValue(key, defaultValue);
        if (traceRead) {
          logInitialStorageCheckpoint(key, "GM.getValue", "done", {
            started: Math.round(startedAt * 100) / 100,
            finished: Math.round(performance.now() * 100) / 100
          });
        }
        return value;
      } catch (error) {
        if (traceRead) {
          logInitialStorageCheckpoint(key, "GM.getValue", "error", {
            started: Math.round(startedAt * 100) / 100,
            finished: Math.round(performance.now() * 100) / 100,
            error: error?.message || String(error)
          });
        }
        throw error;
      }
    }

    if (traceRead) {
      logInitialStorageCheckpoint(key, "none", "error", {
        started: Math.round(startedAt * 100) / 100,
        finished: Math.round(performance.now() * 100) / 100,
        error: "没有可用的 GM storage API"
      });
    }
    return defaultValue;
  }

  async function setValue(key, value) {
    if (typeof GM_setValue === "function") {
      GM_setValue(key, value);
      return;
    }

    if (typeof GM !== "undefined" && typeof GM.setValue === "function") {
      await GM.setValue(key, value);
      return;
    }

    GM_setValue(key, value);
  }

  async function deleteValue(key) {
    if (typeof GM_deleteValue === "function") {
      GM_deleteValue(key);
      return;
    }

    if (typeof GM !== "undefined" && typeof GM.deleteValue === "function") {
      await GM.deleteValue(key);
      return;
    }

    GM_deleteValue(key);
  }

  function extractLoginFromText(text) {
    if (!text) return "";

    const patterns = [
      /user_\d+/i,
      /"login"\s*:\s*"([^"]+)"/i,
      /"username"\s*:\s*"([^"]+)"/i,
      /zzud=([^&"'\s]+)/i,
      /username=([^&"'\s]+)/i
    ];

    for (const pattern of patterns) {
      const match = String(text).match(pattern);
      if (match) {
        const value = match[1] || match[0];
        if (value && /^user_\d+$/i.test(value)) {
          return value;
        }
      }
    }

    return "";
  }

  function detectLoginFromPage() {
    const manualLogin = String(MANUAL_LOGIN || "").trim();
    if (manualLogin) return manualLogin;

    const candidates = [];

    candidates.push(location.href);

    if (document && document.documentElement) {
      candidates.push(document.documentElement.innerHTML);
    }

    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        candidates.push(key);
        candidates.push(localStorage.getItem(key));
      }
    } catch (e) {}

    try {
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        candidates.push(key);
        candidates.push(sessionStorage.getItem(key));
      }
    } catch (e) {}

    for (const text of candidates) {
      const login = extractLoginFromText(text);
      if (login) return login;
    }

    return "";
  }

  function saveAutoLoginIfDetected() {
    if (!isTgHost()) {
      return "";
    }

    const login = detectLoginFromPage();

    if (login) {
      GM_setValue(STORE_KEY_AUTO_LOGIN, login);
      return login;
    }

    return "";
  }

  function escapeHtml(text) {
    return String(text ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function cleanStatusMessage(message) {
    return String(message || "").replace(/^\[DEBUG\]\s*/, "");
  }

  function isTgHost(hostname = location.hostname) {
    return hostname === "tg.zcst.edu.cn" || hostname === TG_INTRANET_HOST;
  }

  function getTgOrigin(hostname = location.hostname) {
    return hostname === TG_INTRANET_HOST ? TG_INTRANET_ORIGIN : TG_EXTERNAL_ORIGIN;
  }

  function getCurrentPageSite() {
    if (location.hostname === "www.educoder.net") {
      return {
        siteKey: "educoder",
        siteName: "头歌公网",
        pageHost: "www.educoder.net",
        pageOrigin: "https://www.educoder.net",
        apiOrigin: "https://data.educoder.net",
        resultKey: STORE_KEY_EDUCODER_RESULT,
        login: "pchtkff9y",
        courseId: 109348,
        courseIdentifier: "MOAPGNLO",
        courseName: "操作系统2026",
        viewHint: "当前为头歌公网视图，仅展示本平台任务。"
      };
    }

    return {
      siteKey: "tg-zcst",
      backendSiteKey: "tg",
      siteName: location.hostname === TG_INTRANET_HOST ? "TG 内网" : "TG 外网",
      pageHost: location.hostname,
      pageOrigin: getTgOrigin(),
      apiOrigin: getTgOrigin(),
      resultKey: STORE_KEY_TG_RESULT,
      login: "",
      viewHint: `当前为${location.hostname === TG_INTRANET_HOST ? "TG 内网" : "TG 外网"}视图，仅展示本平台任务。`
    };
  }

  function getCurrentBackendSiteKey() {
    const site = getCurrentPageSite();
    return site.backendSiteKey || site.siteKey;
  }

  function isTaskForCurrentSite(task) {
    const current = getCurrentPageSite();
    return getTaskSiteKey(task) === current.siteKey || String(task?.siteKey || "") === getCurrentBackendSiteKey();
  }

  function isValueForCurrentSite(value) {
    if (!value || typeof value !== "object") return false;
    const current = getCurrentPageSite();
    const valueHost = String(value.pageHost || "").trim().toLowerCase();
    if (!valueHost) return false;
    return valueHost === String(current.pageHost || location.hostname).toLowerCase();
  }

  function filterResultForCurrentSite(result) {
    if (!result || typeof result !== "object") return result;
    const currentSite = getCurrentPageSite();
    const backendSiteKey = getCurrentBackendSiteKey();
    const matchesCurrentSite = item => {
      const key = String(item?.siteKey || item?.key || "").trim();
      return key === backendSiteKey || key === currentSite.siteKey || (key === "tg" && currentSite.siteKey === "tg-zcst");
    };

    const courses = Array.isArray(result.courses)
      ? result.courses.filter(course => {
        const key = String(course?.siteKey || "").trim();
        return key === backendSiteKey || (key === "tg" && currentSite.siteKey === "tg-zcst");
      })
      : [];
    const tasks = Array.isArray(result.tasks) ? result.tasks.filter(isTaskForCurrentSite) : [];
    const debug = result.debug && typeof result.debug === "object"
      ? {
        ...result.debug,
        siteLogin: Array.isArray(result.debug.siteLogin) ? result.debug.siteLogin.filter(matchesCurrentSite) : result.debug.siteLogin,
        siteScan: Array.isArray(result.debug.siteScan) ? result.debug.siteScan.filter(matchesCurrentSite) : result.debug.siteScan,
        requestLog: Array.isArray(result.debug.requestLog) ? result.debug.requestLog.filter(matchesCurrentSite) : result.debug.requestLog,
        courseScanFlow: Array.isArray(result.debug.courseScanFlow) ? result.debug.courseScanFlow.filter(matchesCurrentSite) : result.debug.courseScanFlow
      }
      : result.debug;

    return {
      ...result,
      courses,
      tasks,
      debug,
      summary: {
        ...(result.summary || {}),
        courseCount: courses.length,
        taskCount: tasks.length
      }
    };
  }

  function isResultForCurrentSite(result) {
    if (!result || typeof result !== "object") return false;

    const current = getCurrentPageSite();
    const backendSiteKey = getCurrentBackendSiteKey();
    const keys = [
      result.siteKey,
      result.currentSite?.key,
      ...(Array.isArray(result.sites) ? result.sites.map(site => site?.key) : []),
      ...(Array.isArray(result.courses) ? result.courses.map(course => course?.siteKey) : []),
      ...(Array.isArray(result.tasks) ? result.tasks.map(task => task?.siteKey) : [])
    ].filter(Boolean).map(value => String(value).trim());

    if (!keys.length) {
      return current.siteKey === "tg-zcst";
    }

    return keys.some(key =>
      key === current.siteKey ||
      key === backendSiteKey ||
      (key === "tg" && current.siteKey === "tg-zcst")
    );
  }

  function getTaskSiteKey(task) {
    const raw = String(task?.siteKey || "").trim();
    if (!raw || raw === "tg") return "tg-zcst";
    return raw;
  }

  function getTaskSiteName(task) {
    return String(task?.siteName || (getTaskSiteKey(task) === "educoder" ? "头歌公网" : getCurrentPageSite().siteName)).trim();
  }

  function getCourseKey(task) {
    const siteKey = getTaskSiteKey(task);
    const courseId = task?.courseId || task?.courseIdentifier || task?.courseName || "unknown";
    return `${siteKey}:${courseId}`;
  }

  function formatDateTime(value) {
    if (!value) return "--";

    try {
      const normalized = String(value).replace(/-/g, "/");
      const d = new Date(normalized);
      if (Number.isNaN(d.getTime())) return String(value);

      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      const h = String(d.getHours()).padStart(2, "0");
      const min = String(d.getMinutes()).padStart(2, "0");

      return `${y}-${m}-${day} ${h}:${min}`;
    } catch (e) {
      return String(value);
    }
  }

  function normalizeTasks(data) {
    if (Array.isArray(data?.tasks)) return data.tasks;

    const tasks = [];
    for (const course of data?.courses || []) {
      for (const exam of course.exams || []) tasks.push({ ...exam, taskType: "exercise", taskTypeText: "考试/小测试" });
      for (const homework of course.homeworks || []) tasks.push({ ...homework, taskType: "common_homework", taskTypeText: "图文作业" });
      for (const experiment of course.experiments || []) tasks.push({ ...experiment, taskType: "classroom_experiment", taskTypeText: "课堂实验" });
    }

    return tasks;
  }

  function getTaskDate(task) {
    const candidates = [
      task?.endTime,
      task?.publishTime,
      task?.scanTime,
      task?.startAt,
      task?.endAt
    ];

    for (const v of candidates) {
      if (!v) continue;
      const d = new Date(String(v).replace(/-/g, "/"));
      if (!Number.isNaN(d.getTime())) return d;
    }

    return null;
  }

  function getTaskEndDate(task) {
    const candidates = [
      task?.endTime,
      task?.endAt
    ];

    for (const v of candidates) {
      if (!v) continue;
      const d = new Date(String(v).replace(/-/g, "/"));
      if (!Number.isNaN(d.getTime())) return d;
    }

    return null;
  }

  function parseChineseRemainingToMs(text) {
    if (!text) return null;

    const str = String(text);
    let ms = 0;

    const day = str.match(/(\d+)\s*天/);
    const hour = str.match(/(\d+)\s*小时/);
    const minute = str.match(/(\d+)\s*分/);
    const second = str.match(/(\d+)\s*秒/);

    if (day) ms += Number(day[1]) * 24 * 60 * 60 * 1000;
    if (hour) ms += Number(hour[1]) * 60 * 60 * 1000;
    if (minute) ms += Number(minute[1]) * 60 * 1000;
    if (second) ms += Number(second[1]) * 1000;

    return ms || null;
  }

  function getTaskDeadlineDate(task) {
    const timestamp = Number(task?.deadlineTimestamp ?? task?.raw?.deadlineTimestamp);
    if (Number.isFinite(timestamp) && timestamp > 0) {
      const normalizedTimestamp = timestamp < 10000000000 ? timestamp * 1000 : timestamp;
      const d = new Date(normalizedTimestamp);
      if (!Number.isNaN(d.getTime())) return d;
    }

    const raw = task?.raw || {};
    const candidates = [
      task?.endTime,
      task?.endAt,
      task?.deadline,
      task?.deadlineTime,
      task?.closeTime,
      task?.end_time,
      task?.end_time_s,
      task?.deadline_time,
      task?.close_time,
      raw.end_time,
      raw.end_time_s,
      raw.endAt,
      raw.deadline,
      raw.deadlineTime,
      raw.deadline_time,
      raw.closeTime,
      raw.close_time,
      raw["截止时间"],
      raw.exam?.end_time,
      raw.exam?.end_time_s,
      raw.exam?.deadline,
      raw.exam?.deadlineTime,
      raw.exam?.closeTime
    ];

    for (const value of candidates) {
      if (!value) continue;
      const d = new Date(String(value).replace(/-/g, "/"));
      if (!Number.isNaN(d.getTime())) return d;
    }

    return null;
  }

  function getTaskRemainingMs(task, now = new Date()) {
    const remainingMs = Number(task?.remainingMs ?? task?.raw?.remainingMs);
    if (Number.isFinite(remainingMs)) return remainingMs;

    const deadline = getTaskDeadlineDate(task);
    if (deadline) return deadline.getTime() - now.getTime();

    const relativeCandidates = [
      task?.deadlineRemaining,
      task?.deadline,
      task?.deadlineTime,
      task?.closeTime,
      task?.exerciseLeftTime,
      task?.exercise_left_time,
      task?.remainingTime,
      task?.remainTime,
      task?.status_time,
      task?.raw?.deadlineRemaining,
      task?.raw?.deadline,
      task?.raw?.deadlineTime,
      task?.raw?.deadline_time,
      task?.raw?.closeTime,
      task?.raw?.close_time,
      task?.raw?.["截止时间"],
      task?.raw?.exercise_left_time,
      task?.raw?.status_time,
      task?.raw?.exam?.exercise_left_time,
      task?.raw?.exam?.deadline,
      task?.raw?.exam?.deadlineTime,
      task?.raw?.exam?.closeTime
    ];

    for (const value of relativeCandidates) {
      const ms = parseChineseRemainingToMs(value);
      if (ms != null) return ms;
    }

    return null;
  }

  function parseTaskDeadline(task) {
    if (task?.endTime) {
      const d = new Date(String(task.endTime).replace(/-/g, "/"));
      if (!Number.isNaN(d.getTime())) return d;
    }

    if (task?.deadlineAt) {
      const d = new Date(String(task.deadlineAt).replace(/-/g, "/"));
      if (!Number.isNaN(d.getTime())) return d;
    }

    if (task?.deadlineRemaining && task?.scanTime) {
      const base = new Date(String(task.scanTime).replace(/-/g, "/"));
      const ms = parseChineseRemainingToMs(task.deadlineRemaining);
      if (!Number.isNaN(base.getTime()) && ms != null) {
        return new Date(base.getTime() + ms);
      }
    }

    return null;
  }

  function parseCountdownDeadline(value) {
    if (!value) return null;
    const d = new Date(String(value).replace(/-/g, "/"));
    if (Number.isNaN(d.getTime())) return null;
    return d;
  }

  function formatCountdown(deadlineValue) {
    const deadline = deadlineValue instanceof Date ? deadlineValue : parseCountdownDeadline(deadlineValue);
    if (!deadline) return "无截止时间";

    const diff = deadline.getTime() - Date.now();
    if (diff <= 0) return "已截止";

    const totalSeconds = Math.floor(diff / 1000);
    const totalMinutes = Math.floor(totalSeconds / 60);
    const totalHours = Math.floor(totalSeconds / 3600);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (diff >= 3 * 86400000) {
      return `剩余 ${days}天 ${hours}小时`;
    }

    if (diff >= 86400000) {
      return `仅剩 ${days}天 ${hours}小时`;
    }

    if (diff >= 3600000) {
      return `仅剩 ${totalHours}小时 ${minutes}分`;
    }

    return `仅剩 ${totalMinutes}分 ${seconds}秒`;
  }

  function updateCountdowns() {
    document.querySelectorAll(".tg-countdown[data-deadline]").forEach(el => {
      const deadline = el.dataset.deadline || "";
      el.textContent = formatCountdown(deadline);
    });
  }

  function updateCountdownsOnly() {
    updateCountdowns();
  }

  function ensureCountdownTimer() {
    if (countdownIntervalId) return;
    countdownIntervalId = setInterval(updateCountdownsOnly, 1000);
  }

  function stopCountdownTimer() {
    if (!countdownIntervalId) return;
    clearInterval(countdownIntervalId);
    countdownIntervalId = null;
  }

  function getFilterStartDate(year, month) {
    return new Date(year, month - 1, 1, 0, 0, 0);
  }

  function filterTasksByYearMonth(tasks, year, month) {
    const startDate = getFilterStartDate(year, month);

    return tasks.filter(task => {
      const d = getTaskDate(task);
      if (!d) return true;
      return d >= startDate;
    });
  }

  function getDefaultFilterYearMonth() {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    d.setMonth(d.getMonth() - 5);

    return {
      year: d.getFullYear(),
      month: d.getMonth() + 1
    };
  }

  async function loadFilterYearMonth() {
    const saved = await getValue(STORE_KEY_FILTER_YEAR_MONTH, null);
    const year = Number(saved?.year);
    const month = Number(saved?.month);

    if (year && month >= 1 && month <= 12) {
      return { year, month };
    }

    return getDefaultFilterYearMonth();
  }

  function normalizeSemesterSettings(saved) {
    const upper = Number(saved?.upperSemesterStartMonth);
    const lower = Number(saved?.lowerSemesterStartMonth);
    return {
      upperSemesterStartMonth: Number.isInteger(upper) && upper >= 1 && upper <= 12 ? upper : 8,
      lowerSemesterStartMonth: Number.isInteger(lower) && lower >= 1 && lower <= 12 ? lower : 3
    };
  }

  async function loadSemesterSettings() {
    return normalizeSemesterSettings(await getValue(STORE_KEY_SEMESTER_SETTINGS, null));
  }

  function deriveCurrentSemester(settings = {}) {
    const normalized = normalizeSemesterSettings(settings);
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const upper = normalized.upperSemesterStartMonth;
    const lower = normalized.lowerSemesterStartMonth;
    if (upper === lower) return { academicYearText: "配置无效", termText: "两个月份不能相同" };
    const upperDistance = (month - upper + 12) % 12;
    const lowerDistance = (month - lower + 12) % 12;
    const isUpper = upperDistance < lowerDistance;
    const startYear = isUpper
      ? (month >= upper ? year : year - 1)
      : (lower < upper ? year - 1 : year);
    return {
      academicYearText: `${startYear}-${startYear + 1}`,
      termText: isUpper ? "上学期" : "下学期"
    };
  }

  async function saveSemesterSettings(settings) {
    const normalized = normalizeSemesterSettings(settings);
    if (normalized.upperSemesterStartMonth === normalized.lowerSemesterStartMonth) {
      alert("上学期和下学期开始月份不能相同。");
      return false;
    }
    await setValue(STORE_KEY_SEMESTER_SETTINGS, normalized);
    return true;
  }

  async function loadCourseCollapseState() {
    const saved = await getValue(STORE_KEY_COURSE_COLLAPSE, {});
    return saved && typeof saved === "object" ? saved : {};
  }

  async function loadSectionCollapseState() {
    const saved = await getValue(STORE_KEY_SECTION_COLLAPSE, {});
    return saved && typeof saved === "object" ? saved : {};
  }

  async function loadIgnoredTaskMap() {
    const saved = await getValue(STORE_KEY_IGNORED_TASKS, {});
    return saved && typeof saved === "object" ? saved : {};
  }

  async function saveIgnoredTaskMap(map) {
    const nextMap = map && typeof map === "object" ? map : {};
    await setValue(STORE_KEY_IGNORED_TASKS, nextMap);
  }

  async function loadPinnedCourses() {
    const saved = await getValue(STORE_KEY_PINNED_COURSES, {});
    return saved && typeof saved === "object" ? saved : {};
  }

  async function savePinnedCourses(pinnedCourses) {
    const next = pinnedCourses && typeof pinnedCourses === "object" ? pinnedCourses : {};
    await setValue(STORE_KEY_PINNED_COURSES, next);
  }

  function normalizeLauncherSettings(saved) {
    const value = saved && typeof saved === "object" ? saved : {};
    return {
      ...DEFAULT_LAUNCHER_SETTINGS,
      ...value,
      size: ["auto", "small", "standard", "large"].includes(value.size) ? value.size : DEFAULT_LAUNCHER_SETTINGS.size,
      visualMode: ["auto", "high", "energy", "static"].includes(value.visualMode) ? value.visualMode : DEFAULT_LAUNCHER_SETTINGS.visualMode,
      locked: value.locked === true,
      y: Number.isFinite(Number(value.y)) ? Number(value.y) : null
    };
  }

  async function loadLauncherSettings() {
    return normalizeLauncherSettings(await getValue(STORE_KEY_LAUNCHER_SETTINGS, DEFAULT_LAUNCHER_SETTINGS));
  }

  async function saveLauncherSettings(patch) {
    const current = await loadLauncherSettings();
    await setValue(STORE_KEY_LAUNCHER_SETTINGS, normalizeLauncherSettings({ ...current, ...patch }));
  }

  function normalizeShortcut(saved) {
    if (!saved || typeof saved !== "object" || !saved.key || (!saved.ctrl && !saved.alt && !saved.shift && !saved.meta)) return null;
    return {
      key: String(saved.key),
      ctrl: saved.ctrl === true,
      alt: saved.alt === true,
      shift: saved.shift === true,
      meta: saved.meta === true
    };
  }

  async function loadShortcut() {
    return normalizeShortcut(await getValue(STORE_KEY_SHORTCUT, null));
  }

  async function saveShortcut(shortcut) {
    if (shortcut) await setValue(STORE_KEY_SHORTCUT, normalizeShortcut(shortcut));
    else await deleteValue(STORE_KEY_SHORTCUT);
  }

  async function isRefreshBusy() {
    const refreshStatus = await getValue(STORE_KEY_REFRESH_STATUS, null);
    if (refreshStatus?.status === "done" || refreshStatus?.status === "error") {
      return false;
    }
    if (refreshStatus?.status === "running" || refreshStatus?.status === "waiting") {
      return true;
    }

    const runningState = await loadRunningState();
    return runningState?.running === true;
  }

  function getTaskStableId(task) {
    const raw = task?.raw || {};
    const rawExam = raw?.exam || {};
    const candidates = [
      task?.exerciseId,
      task?.examId,
      task?.homeworkId,
      task?.homework_id,
      task?.shixunId,
      task?.shixun_id,
      task?.taskId,
      task?.id,
      task?.categoryId,
      rawExam?.id,
      raw?.exerciseId,
      raw?.homework_id,
      raw?.id,
      raw?.category_id
    ];

    for (const value of candidates) {
      if (value === undefined || value === null || value === "") continue;
      return String(value).trim();
    }

    return "";
  }

  function getTaskDeadlineLabel(task) {
    const deadlineDate = getTaskDeadlineDate(task) || parseTaskDeadline(task);
    const fallback = task?.deadline || task?.endTime || task?.endAt || task?.end_at || task?.dangerDeadline || task?.deadlineTime || "";
    if (deadlineDate) {
      return formatDateTime(deadlineDate);
    }
    return fallback ? String(fallback) : "无截止时间";
  }

  function getTaskKey(task) {
    if (!hasLoggedTaskKeySample && task) {
      console.log("[TG任务key检查] task=", task);
      hasLoggedTaskKeySample = true;
    }

    const sourceKey = String(task?.siteKey || task?.source || task?.apiSource || "unknown").trim();
    const courseKey = String(task?.courseIdentifier || task?.courseId || task?.courseName || "unknown").trim();
    const taskType = String(task?.taskType || task?.type || task?.taskTypeText || "task").trim();
    const stableId = getTaskStableId(task);

    if (stableId) {
      return `${sourceKey}|${courseKey}|${taskType}|${stableId}`;
    }

    const fallbackTitle = getTaskTitle(task);
    const fallbackDeadline = getTaskDeadlineLabel(task);
    return `${sourceKey}|${courseKey}|${taskType}|${fallbackTitle}|${fallbackDeadline}`;
  }

  function createIgnoredTaskSnapshot(task, taskKey = getTaskKey(task)) {
    return {
      key: taskKey,
      title: getTaskTitle(task),
      courseName: task?.courseName || "",
      courseId: task?.courseId || "",
      courseIdentifier: task?.courseIdentifier || "",
      taskType: task?.taskType || task?.type || "",
      taskTypeText: task?.taskTypeText || "",
      source: task?.source || task?.apiSource || "",
      siteKey: getTaskSiteKey(task),
      siteName: getTaskSiteName(task),
      deadline: getTaskDeadlineLabel(task),
      detailUrl: task?.detailUrl || task?.url || "",
      ignoredAt: new Date().toLocaleString()
    };
  }

  async function ignoreTask(task) {
    const taskKey = getTaskKey(task);
    console.log("[TG忽略机制] taskKey=", taskKey, task?.title || task?.name);
    const ignoredTaskMap = await loadIgnoredTaskMap();
    ignoredTaskMap[taskKey] = createIgnoredTaskSnapshot(task, taskKey);
    await saveIgnoredTaskMap(ignoredTaskMap);
    console.log("[TG忽略机制] ignoredTaskMap=", ignoredTaskMap);
    return ignoredTaskMap;
  }

  async function restoreTask(taskKey) {
    const ignoredTaskMap = await loadIgnoredTaskMap();
    delete ignoredTaskMap[taskKey];
    await saveIgnoredTaskMap(ignoredTaskMap);
    console.log("[TG忽略机制] ignoredTaskMap=", ignoredTaskMap);
    return ignoredTaskMap;
  }

  function isDangerTask(task) {
    if (task?.completed || task?.submitted) return false;
    if (task?.ended) return false;

    const remainingMs = getTaskRemainingMs(task);

    if (remainingMs !== null) {
      if (remainingMs <= 0) return false;
      if (remainingMs <= DANGER_DAYS_THRESHOLD * 86400000) return true;
    }

    return false;
  }

  function taskPriority(task) {
    if (isDangerTask(task)) return 1;
    if (!task.completed && task.ended) return 2;
    if (!task.completed) return 3;
    return 5;
  }

  function sortTasks(tasks) {
    return [...tasks].sort((a, b) => taskPriority(a) - taskPriority(b));
  }

  function calculateSummaryFromTasks(tasks) {
    const siteCount = new Set(tasks.map(task => getTaskSiteKey(task)).filter(Boolean)).size;
    const courseCount = new Set(tasks.map(task => getCourseKey(task)).filter(Boolean)).size;
    const exerciseCount = tasks.filter(task => task.taskType === "exercise").length;
    const homeworkCount = tasks.filter(task => task.taskType === "common_homework").length;
    const experimentCount = tasks.filter(task => task.taskType === "classroom_experiment").length;
    const unfinishedCount = tasks.filter(task => !task.completed).length;
    const dangerCount = tasks.filter(task => !task.completed && isDangerTask(task)).length;

    return {
      siteCount,
      courseCount,
      taskCount: tasks.length,
      exerciseCount,
      homeworkCount,
      experimentCount,
      unfinishedCount,
      dangerCount
    };
  }

  function statusTone(task) {
    const text = task.statusText || "";
    if (task.completed) return { card: "tg-state-ok", text: "tg-ok" };
    if (task.ended || text.includes("已截止")) return { card: "tg-state-bad", text: "tg-bad" };
    if (isDangerTask(task) || text.includes("快截止") || text.includes("进行中")) return { card: "tg-state-warn", text: "tg-warn" };
    return { card: "tg-state-muted", text: "tg-muted" };
  }

  function currentFilter() {
    const filter = localStorage.getItem(FILTER_KEY) || "danger";
    if (filter === "urgent") return "danger";
    if (filter === "course") return "course";
    if (filter === "completed") return "completed";
    if (filter === "site") return "all";
    if (filter === "homework") return "common_homework";
    if (filter === "experiment") return "classroom_experiment";
    return filter;
  }

  function setCurrentFilter(filter) {
    localStorage.setItem(FILTER_KEY, filter);
  }

  function isOpen() {
    return pageOpen;
  }

  function setOpen(value) {
    pageOpen = Boolean(value);
  }

  function normalizeAutoOpenSettings(saved) {
    const value = saved && typeof saved === "object" ? saved : {};
    return {
      home: value.home === undefined ? true : value.home === true,
      other: value.other === undefined ? false : value.other === true
    };
  }

  async function loadAutoOpenSettings() {
    return normalizeAutoOpenSettings(await getValue(STORE_KEY_AUTO_OPEN_SETTINGS, null));
  }

  async function saveAutoOpenSettings(patch) {
    const current = await loadAutoOpenSettings();
    await setValue(STORE_KEY_AUTO_OPEN_SETTINGS, normalizeAutoOpenSettings({ ...current, ...patch }));
  }

  function normalizeNavigationPath(pathname) {
    let path = String(pathname || "/");
    try {
      path = decodeURIComponent(path);
    } catch (_) {}
    path = path.replace(/\/+/g, "/").replace(/\/+$/, "");
    return path || "/";
  }

  function isAssistantHomePage() {
    const site = getCurrentPageSite();
    const path = normalizeNavigationPath(location.pathname);
    if (site.siteKey === "educoder") return path === "/" || path === "/home";
    if (site.siteKey === "tg-zcst") return path === "/";
    return false;
  }

  async function initializePageOpenState() {
    const settings = await loadAutoOpenSettings();
    const pageKind = isAssistantHomePage() ? "home" : "other";
    const autoOpen = pageKind === "home" ? settings.home : settings.other;
    setOpen(autoOpen);
    console.info("[TG panel] initial-open", { pageKind, autoOpen });
    return autoOpen;
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function getDefaultPanelState() {
    return {
      buttonX: Math.max(18, window.innerWidth - 84),
      buttonY: Math.max(18, window.innerHeight - 86),
      launcherY: Math.max(18, window.innerHeight - 156),
      panelX: null,
      panelY: 18,
      panelWidth: 520,
      panelHeight: Math.min(760, Math.max(480, window.innerHeight - 48))
    };
  }

  async function loadPanelState() {
    const saved = await getValue(STORE_KEY_PANEL_STATE, {});
    return {
      ...getDefaultPanelState(),
      ...(saved && typeof saved === "object" ? saved : {})
    };
  }

  async function savePanelStatePatch(patch) {
    const current = await loadPanelState();
    await setValue(STORE_KEY_PANEL_STATE, { ...current, ...patch });
  }

  async function applyPanelState(panelState) {
    const button = document.getElementById(BUTTON_ID);
    const drawer = document.getElementById(DRAWER_ID);
    const state = panelState || await loadPanelState();
    const launcherSettings = normalizeLauncherSettings(
      state?.launcherSettings || await loadLauncherSettings()
    );

    if (button) {
      const launcherHeight = button.getBoundingClientRect().height || 52;
      const savedY = launcherSettings.y ?? state.launcherY ?? state.buttonY ?? window.innerHeight - launcherHeight - 104;
      const y = clamp(Number(savedY) || 0, 12, Math.max(12, window.innerHeight - launcherHeight - 12));
      button.style.left = "auto";
      button.style.right = "16px";
      button.style.top = `${y}px`;
      button.style.bottom = "auto";
      button.dataset.launcherSize = "small";
      const prefersReducedMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
      button.dataset.visualMode = prefersReducedMotion ? "static" : launcherSettings.visualMode;
    }

    if (drawer) {
      const maxWidth = Math.max(320, Math.min(760, window.innerWidth - 16));
      const maxHeight = Math.max(320, window.innerHeight - 16);
      const width = clamp(Number(state.panelWidth) || 520, Math.min(420, maxWidth), maxWidth);
      const height = clamp(Number(state.panelHeight) || Math.min(760, window.innerHeight - 48), Math.min(420, maxHeight), maxHeight);
      const hasSavedPanelX = state.panelX !== null && state.panelX !== undefined && state.panelX !== "" && Number.isFinite(Number(state.panelX));
      const hasSavedPanelY = state.panelY !== null && state.panelY !== undefined && state.panelY !== "" && Number.isFinite(Number(state.panelY));
      const launcherRect = button?.getBoundingClientRect();
      const launcherOnLeft = launcherRect ? launcherRect.left + launcherRect.width / 2 < window.innerWidth / 2 : false;
      const defaultX = launcherOnLeft ? 16 : Math.max(8, window.innerWidth - width - 16);
      const rawX = hasSavedPanelX ? Number(state.panelX) : defaultX;
      const rawY = hasSavedPanelY ? Number(state.panelY) : 18;
      const x = clamp(rawX, 8, Math.max(8, window.innerWidth - width - 8));
      const y = clamp(rawY, 8, Math.max(8, window.innerHeight - height - 8));
      drawer.style.width = `${width}px`;
      drawer.style.height = `${height}px`;
      drawer.style.maxWidth = `${maxWidth}px`;
      drawer.style.maxHeight = `${maxHeight}px`;
      drawer.style.left = `${x}px`;
      drawer.style.right = "auto";
      drawer.style.top = `${y}px`;
      drawer.dataset.locked = launcherSettings.locked ? "1" : "0";
      drawer.classList.toggle("tg2-panel-locked", launcherSettings.locked);
    }
  }

  async function loadData() {
    const site = getCurrentPageSite();
    const currentResult = await getValue(site.resultKey, null);
    if (currentResult) {
      if (site.siteKey === "educoder" && currentResult.source !== "educoder-page-frontend") {
        return null;
      }

      return filterResultForCurrentSite(currentResult);
    }

    if (site.siteKey === "educoder") {
      return null;
    }

    const fallback = await getValue(STORE_KEY, null);
    return filterResultForCurrentSite(fallback);
  }

  async function loadRunningState() {
    return await getValue(STORE_KEY_LAST_RUNNING, null);
  }

  async function loadLastError() {
    return await getValue(STORE_KEY_LAST_ERROR, null);
  }

  async function loadRefreshRequest() {
    return await getValue(STORE_KEY_REFRESH_REQUEST, null);
  }

  async function loadRefreshHandled() {
    return await getValue(STORE_KEY_REFRESH_HANDLED, 0);
  }

  function normalizeFilterYearMonth(saved) {
    const year = Number(saved?.year);
    const month = Number(saved?.month);

    if (year && month >= 1 && month <= 12) {
      return { year, month };
    }

    return getDefaultFilterYearMonth();
  }

  function normalizeObject(value, fallback = {}) {
    return value && typeof value === "object" ? value : fallback;
  }

  async function loadFrontendState() {
    logInitialHydrationCheckpoint("02 state-read-start");
    const [
      result,
      lastRunning,
      lastError,
      filterYearMonthRaw,
      panelStateRaw,
      courseCollapse,
      sectionCollapse,
      autoLogin,
      refreshRequest,
      refreshHandled,
      refreshStatus,
      semesterSettings,
      ignoredTaskMap,
      pinnedCourses,
      launcherSettings,
      shortcut,
      autoOpenSettings
    ] = await Promise.all([
      loadData(),
      getValue(STORE_KEY_LAST_RUNNING, null),
      getValue(STORE_KEY_LAST_ERROR, null),
      getValue(STORE_KEY_FILTER_YEAR_MONTH, null),
      getValue(STORE_KEY_PANEL_STATE, null),
      getValue(STORE_KEY_COURSE_COLLAPSE, {}),
      getValue(STORE_KEY_SECTION_COLLAPSE, {}),
      getValue(STORE_KEY_AUTO_LOGIN, ""),
      getValue(STORE_KEY_REFRESH_REQUEST, null),
      getValue(STORE_KEY_REFRESH_HANDLED, 0),
      getValue(STORE_KEY_REFRESH_STATUS, null),
      loadSemesterSettings(),
      loadIgnoredTaskMap(),
      loadPinnedCourses(),
      loadLauncherSettings(),
      loadShortcut(),
      loadAutoOpenSettings()
    ]);
    logInitialHydrationCheckpoint("03 state-read-done");

    return {
      result,
      lastRunning: isValueForCurrentSite(lastRunning) ? lastRunning : null,
      lastError: isValueForCurrentSite(lastError) ? lastError : null,
      filterYearMonth: normalizeFilterYearMonth(filterYearMonthRaw),
      panelState: {
        ...getDefaultPanelState(),
        ...normalizeObject(panelStateRaw)
      },
      courseCollapse: normalizeObject(courseCollapse),
      sectionCollapse: normalizeObject(sectionCollapse),
      autoLogin: String(autoLogin || "").trim(),
      refreshRequest: isValueForCurrentSite(refreshRequest) ? refreshRequest : null,
      refreshHandled,
      refreshStatus: isValueForCurrentSite(refreshStatus) ? refreshStatus : null,
      semesterSettings,
      ignoredTaskMap: normalizeObject(ignoredTaskMap),
      pinnedCourses: normalizeObject(pinnedCourses),
      launcherSettings: normalizeLauncherSettings(launcherSettings),
      shortcut: normalizeShortcut(shortcut),
      autoOpenSettings: normalizeAutoOpenSettings(autoOpenSettings),
      currentFilter: currentFilter()
    };
  }

  function applyCurrentFilter(tasks, filter) {
    return tasks.filter(task => taskMatchesFilter(task, filter));
  }

  function groupTasksByCourseAndType(tasks) {
    const groups = new Map();

    for (const task of tasks) {
      const key = getCourseKey(task);
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          siteKey: getTaskSiteKey(task),
          siteName: getTaskSiteName(task),
          courseName: task.courseName || "未识别课程",
          tasks: [],
          exams: [],
          homeworks: [],
          experiments: [],
          unfinished: 0,
          danger: 0
        });
      }

      const group = groups.get(key);
      group.tasks.push(task);
      if (!task.completed) group.unfinished += 1;
      if (isDangerTask(task)) group.danger += 1;

      if (task.taskType === "exercise") {
        group.exams.push(task);
      } else if (task.taskType === "common_homework") {
        group.homeworks.push(task);
      } else if (task.taskType === "classroom_experiment") {
        group.experiments.push(task);
      }
    }

    return Array.from(groups.values());
  }

  function buildIgnoredDisplayTasks(allTasks, ignoredTaskMap) {
    const matchedMap = new Map();

    for (const task of allTasks) {
      const key = getTaskKey(task);
      if (ignoredTaskMap[key] && !matchedMap.has(key)) {
        matchedMap.set(key, task);
      }
    }

    return Object.keys(ignoredTaskMap).map(key => {
      const snapshot = ignoredTaskMap[key] || {};
      const matchedTask = matchedMap.get(key);
      return matchedTask
        ? {
          ...snapshot,
          ...matchedTask,
          __taskKey: key,
          __ignoredView: true,
          __snapshotOnly: false,
          ignoredAt: snapshot.ignoredAt || matchedTask.ignoredAt || ""
        }
        : {
          ...snapshot,
          __taskKey: key,
          __ignoredView: true,
          __snapshotOnly: true,
          title: snapshot.title || "已忽略任务",
          courseName: snapshot.courseName || "未识别课程",
          taskType: snapshot.taskType || "task",
          taskTypeText: snapshot.taskTypeText || "任务",
          detailUrl: snapshot.detailUrl || "",
          siteKey: snapshot.siteKey || "",
          siteName: snapshot.siteName || "",
          source: snapshot.source || "",
          deadline: snapshot.deadline || "无截止时间"
        };
    });
  }

  function buildViewModel(result, state) {
    const allTasks = sortTasks(normalizeTasks(result));
    const filteredByMonth = filterTasksByYearMonth(allTasks, state.filterYearMonth.year, state.filterYearMonth.month);
    const ignoredTaskMap = state.ignoredTaskMap || {};
    const ignoredKeys = new Set(Object.keys(ignoredTaskMap));
    const activeTasks = filteredByMonth.filter(task => !ignoredKeys.has(getTaskKey(task)));
    const ignoredDisplayTasks = buildIgnoredDisplayTasks(allTasks, ignoredTaskMap);
    const stats = {
      ...calculateSummaryFromTasks(activeTasks),
      ignoredCount: Object.keys(ignoredTaskMap).length
    };
    const visibleTasks = state.currentFilter === "ignored"
      ? ignoredDisplayTasks
      : applyCurrentFilter(activeTasks, state.currentFilter);
    const dangerTasks = activeTasks.filter(isDangerTask);
    const groupedTasks = state.currentFilter === "all"
      ? activeTasks.filter(task => !isDangerTask(task))
      : state.currentFilter === "danger" || state.currentFilter === "ignored"
        ? []
        : visibleTasks;

    console.log("[TG忽略机制] ignoredTaskMap=", ignoredTaskMap);
    console.log("[TG忽略机制] activeTasks=", activeTasks.length, "ignoredTasks=", ignoredDisplayTasks.length);

    return {
      allTasks,
      filteredTasks: filteredByMonth,
      activeTasks,
      ignoredTaskMap,
      ignoredKeys,
      ignoredDisplayTasks,
      visibleTasks,
      dangerTasks,
      stats,
      courseGroups: groupTasksByCourseAndType(groupedTasks)
    };
  }

  function getDangerTaskKey(task) {
    return [
      getTaskSiteKey(task),
      task.courseId || task.courseIdentifier || task.courseName || "",
      task.taskType || "",
      task.exerciseId || task.homeworkId || task.id || task.title || ""
    ].join(":");
  }

  function getDangerNotifySignature(dangerList, result) {
    const keys = dangerList.map(getDangerTaskKey).sort().join("|");
    return `${result?.scanTimestamp || result?.scanTime || ""}:${keys}`;
  }

  function requestDangerNotification(dangerList, result) {
    console.log("[TG任务助手] dangerList", dangerList);

    if (!dangerList.length || typeof Notification === "undefined") return;

    const signature = getDangerNotifySignature(dangerList, result);
    if (localStorage.getItem(DANGER_NOTIFY_KEY) === signature) return;

    const showNotification = () => {
      if (Notification.permission !== "granted") return;

      const first = dangerList[0];
      const moreText = dangerList.length > 1 ? `等 ${dangerList.length} 项` : "";
      new Notification("TG任务助手：发现危险任务", {
        body: `${first.courseName || "课程"}：${getTaskTitle(first)} ${moreText}`,
        tag: "tg-task-danger"
      });
      localStorage.setItem(DANGER_NOTIFY_KEY, signature);
    };

    if (Notification.permission === "granted") {
      showNotification();
    } else if (Notification.permission !== "denied") {
      Notification.requestPermission().then(permission => {
        if (permission === "granted") showNotification();
      }).catch(() => {});
    }
  }

  function createRoot() {
    let root = document.getElementById(ROOT_ID);
    if (root) return root;

    root = document.createElement("div");
    root.id = ROOT_ID;
    root.innerHTML = `
      <svg class="tg2-svg-defs" width="0" height="0" aria-hidden="true" focusable="false">
        <defs>
          <filter id="${SVG_FILTER_ID}" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.018 0.028" numOctaves="2" seed="7" result="noise"></feTurbulence>
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="4" xChannelSelector="R" yChannelSelector="G"></feDisplacementMap>
          </filter>
        </defs>
      </svg>
      <button id="${BUTTON_ID}" class="tg2-launcher" type="button" title="打开课程助手" aria-expanded="false" data-action="toggle-panel">
        <span class="tg2-launcher-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6 5.5h12v13H6z"></path><path d="M9 8.5h6M9 12h6M9 15.5h3"></path></svg></span>
        <span class="tg2-launcher-label">课程助手</span>
        <span class="tg2-launcher-status" aria-hidden="true"></span>
        <span class="tg2-launcher-badge" style="display:none;">0</span>
      </button>
      <aside id="${DRAWER_ID}" class="tg2-panel" aria-label="TG任务助手" aria-hidden="true">
        <header class="tg2-header">
          <div class="tg2-header-row">
            <div class="tg2-title"><div class="tg2-title-main">TG任务助手</div><div class="tg2-title-kicker">今天先处理最急的任务</div></div>
            <div class="tg2-header-actions">
              <button class="tg2-icon-button tg2-latency-button" type="button" data-action="run-latency" title="重新测试延迟">--</button>
              <button class="tg2-icon-button tg2-refresh-button" type="button" data-action="request-refresh" title="请求刷新">刷新</button>
              <button class="tg2-icon-button" type="button" data-action="toggle-menu" title="更多">⋯</button>
              <button class="tg2-icon-button" type="button" data-action="close-panel" title="收起">×</button>
            </div>
          </div>
          <div class="tg2-connection" data-connection-status><span class="tg2-connection-dot"></span><span data-connection-text>正在读取状态…</span></div>
          <nav class="tg2-tabs" aria-label="任务视图">
            <button class="tg2-tab" type="button" data-view="danger">紧急</button>
            <button class="tg2-tab" type="button" data-view="all">全部</button>
            <button class="tg2-tab" type="button" data-view="course">按课程</button>
            <button class="tg2-tab" type="button" data-view="completed">完成</button>
            <button class="tg2-tab" type="button" data-view="ignored">忽略</button>
          </nav>
        </header>
        <div class="tg2-menu" data-menu hidden></div>
        <div class="tg2-body">加载中...</div>
        <footer class="tg2-footer"><span data-footer-summary>任务中心</span><button type="button" data-action="copy-json" data-copy-all-json>复制 JSON</button></footer>
      </aside>
    `;

    document.body.appendChild(root);

    const button = root.querySelector(`#${BUTTON_ID}`);
    root.addEventListener("click", handlePanelClick);
    root.addEventListener("change", handlePanelChange);
    root.addEventListener("mousemove", handleLiquidPointerMove, { passive: true });

    attachButtonDrag(button);
    attachPanelDrag(root.querySelector(`#${DRAWER_ID}`));
    attachPanelResize(root.querySelector(`#${DRAWER_ID}`));
    attachDrawerResize(root.querySelector(`#${DRAWER_ID}`));
    attachAdaptiveBackdropListeners();
    applyPanelState();
    setDrawerOpen(isOpen());
    attachFullscreenListener();
    attachVisibilityListener();
    attachShortcutListener();
    return root;
  }

  async function handlePanelClick(event) {
    const actionEl = event.target.closest("[data-action], [data-course-toggle], [data-section-toggle], [data-jump-id], [data-summary-filter], [data-view], [data-course-pin], [data-course-only]");
    if (!actionEl) return;

    const action = actionEl.dataset.action || "";
    if (!actionEl.closest(`#${ROOT_ID}`)) return;

    if (action === "toggle-panel" || action === "open-panel") {
      const button = document.getElementById(BUTTON_ID);
      if (button?.dataset.dragged === "1") {
        button.dataset.dragged = "0";
        return;
      }

      setDrawerOpen(!isOpen());
      render();
      return;
    }

    if (action === "close-panel") {
      setDrawerOpen(false);
      return;
    }

    if (action === "request-refresh") {
      const started = await requestBackendRefresh("frontend-header-button", "manual");
      if (started) {
        startRunningPoll();
        render();
      }
      return;
    }

    if (action === "delete-cache") {
      deleteTaskCache();
      return;
    }

    if (action === "copy-json") {
      copyAllJson();
      return;
    }

    if (action === "toggle-menu") {
      const menu = document.querySelector(`#${DRAWER_ID} [data-menu]`);
      if (menu) menu.hidden = !menu.hidden;
      return;
    }

    if (action === "run-latency") {
      const menu = document.querySelector(`#${DRAWER_ID} [data-menu]`);
      if (menu) menu.hidden = true;
      measureCurrentTgLatency();
      return;
    }

    if (action === "open-ignored") {
      setCurrentFilter("ignored");
      const menu = document.querySelector(`#${DRAWER_ID} [data-menu]`);
      if (menu) menu.hidden = true;
      render();
      return;
    }

    if (action === "clear-local-data") {
      const menu = document.querySelector(`#${DRAWER_ID} [data-menu]`);
      if (menu) menu.hidden = true;
      deleteTaskCache();
      return;
    }

    if (action === "toggle-panel-lock" || action === "toggle-launcher-lock") {
      const settings = await loadLauncherSettings();
      await saveLauncherSettings({ locked: !settings.locked });
      applyPanelState();
      render();
      return;
    }

    if (action === "reset-panel-layout") {
      await savePanelStatePatch(getDefaultPanelState());
      applyPanelState();
      render();
      return;
    }

    if (action === "record-shortcut") {
      shortcutCaptureActive = true;
      updateShortcutMenu();
      return;
    }

    if (action === "clear-shortcut") {
      shortcutCaptureActive = false;
      await saveShortcut(null);
      updateShortcutMenu();
      return;
    }

    if (action === "reset-semester-settings") {
      if (await saveSemesterSettings({ upperSemesterStartMonth: 8, lowerSemesterStartMonth: 3 })) render();
      return;
    }

    if (action === "toggle-course") {
      const group = actionEl.closest(".tg2-course-group");
      if (!group) return;
      const collapseState = await loadCourseCollapseState();
      collapseState[group.dataset.courseKey] = !group.classList.contains("tg2-collapsed");
      await setValue(STORE_KEY_COURSE_COLLAPSE, collapseState);
      render();
      return;
    }

    if (actionEl.dataset.coursePin) {
      const courseKey = String(actionEl.dataset.coursePin || "");
      if (!courseKey) return;
      const pinned = await loadPinnedCourses();
      if (pinned[courseKey]) delete pinned[courseKey];
      else pinned[courseKey] = Date.now();
      await savePinnedCourses(pinned);
      render();
      return;
    }

    if (actionEl.dataset.courseOnly) {
      localStorage.setItem(COURSE_FOCUS_KEY, String(actionEl.dataset.courseOnly));
      setCurrentFilter("course");
      render();
      return;
    }

    if (action === "set-filter" || actionEl.dataset.summaryFilter || actionEl.dataset.view) {
      const nextFilter = actionEl.dataset.summaryFilter || actionEl.dataset.view || "all";
      setCurrentFilter(nextFilter);
      render();
      return;
    }

    if (action === "ignore-task") {
      event.preventDefault();
      event.stopPropagation();
      const taskKey = String(actionEl.dataset.taskKey || "");
      const task = latestTaskRegistry.get(taskKey);
      if (!task) {
        alert("忽略失败：当前任务数据已失效，请刷新后重试");
        return;
      }
      if (!confirm("确认忽略这个任务？\n忽略后它不会出现在待办和危险提醒中，可在“忽略”分区恢复。")) {
        return;
      }
      await ignoreTask(task);
      render();
      return;
    }

    if (action === "restore-task") {
      event.preventDefault();
      event.stopPropagation();
      const taskKey = String(actionEl.dataset.taskKey || "");
      if (!taskKey) return;
      await restoreTask(taskKey);
      render();
      return;
    }

    if (action === "open-detail" || actionEl.dataset.jumpId) {
      event.preventDefault();
      event.stopPropagation();
      const task = jumpTaskRegistry.get(actionEl.dataset.jumpId);
      if (!task) {
        alert("跳转失败：任务数据已失效，请刷新面板后重试");
        return;
      }

      jumpToTask(task);
      return;
    }

    if (action === "toggle-course" || actionEl.hasAttribute("data-course-toggle")) {
      event.preventDefault();
      event.stopPropagation();
      const group = actionEl.closest(".tg-course-group");
      if (!group) return;

      const key = group.dataset.courseKey;
      const collapseState = await loadCourseCollapseState();
      collapseState[key] = !group.classList.contains("tg-course-collapsed");
      await setValue(STORE_KEY_COURSE_COLLAPSE, collapseState);
      render();
      return;
    }

    if (action === "toggle-section" || actionEl.hasAttribute("data-section-toggle")) {
      event.preventDefault();
      event.stopPropagation();
      const section = actionEl.closest(".tg-course-subgroup");
      if (!section) return;

      const key = section.dataset.sectionKey;
      const collapseState = await loadSectionCollapseState();
      collapseState[key] = !section.classList.contains("tg-section-collapsed");
      await setValue(STORE_KEY_SECTION_COLLAPSE, collapseState);
      render();
    }
  }

  async function handlePanelChange(event) {
    const target = event.target;
    if (target?.matches?.("[data-auto-open-home]")) {
      await saveAutoOpenSettings({ home: target.checked });
      render();
      return;
    }
    if (target?.matches?.("[data-auto-open-other]")) {
      await saveAutoOpenSettings({ other: target.checked });
      render();
      return;
    }
    if (target?.matches?.("[data-semester-upper], [data-semester-lower]")) {
      const root = document.getElementById(ROOT_ID);
      const upper = Number(root?.querySelector("[data-semester-upper]")?.value);
      const lower = Number(root?.querySelector("[data-semester-lower]")?.value);
      if (upper === lower) {
        alert("上学期和下学期开始月份不能相同。");
        render();
        return;
      }
      if (await saveSemesterSettings({ upperSemesterStartMonth: upper, lowerSemesterStartMonth: lower })) render();
      return;
    }
    if (target?.matches?.("[data-filter-year], [data-filter-month]")) {
      const root = document.getElementById(ROOT_ID);
      const year = Number(root?.querySelector("[data-filter-year]")?.value);
      const month = Number(root?.querySelector("[data-filter-month]")?.value);
      if (!year || !month) return;

      await setValue(STORE_KEY_FILTER_YEAR_MONTH, { year, month });
      render();
      return;
    }

    if (target?.matches?.("[data-launcher-size]")) {
      await saveLauncherSettings({ size: target.value });
      applyPanelState();
      updateShortcutMenu();
      return;
    }

    if (target?.matches?.("[data-visual-mode]")) {
      await saveLauncherSettings({ visualMode: target.value });
      applyPanelState();
      return;
    }
  }

  function handleLiquidPointerMove(event) {
    const target = event.target.closest(`#${BUTTON_ID}, #${DRAWER_ID}`);
    if (!target) return;

    const rect = target.getBoundingClientRect();
    const x = clamp(((event.clientX - rect.left) / Math.max(rect.width, 1)) * 100, 0, 100);
    const y = clamp(((event.clientY - rect.top) / Math.max(rect.height, 1)) * 100, 0, 100);
    target.style.setProperty("--tg-mouse-x", `${x}%`);
    target.style.setProperty("--tg-mouse-y", `${y}%`);
  }

  function createLiquidRipple(target, event) {
    if (!target || !target.matches("button, .tg-detail-link, .tg-summary-item, .tg-course-toggle, .tg-action-btn, .tg-icon-btn")) return;
    if (target.dataset.action === "open-panel") return;

    const rect = target.getBoundingClientRect();
    const ripple = document.createElement("span");
    ripple.className = "tg-liquid-ripple";
    ripple.style.left = `${event.clientX - rect.left}px`;
    ripple.style.top = `${event.clientY - rect.top}px`;
    target.appendChild(ripple);
    setTimeout(() => ripple.remove(), 560);
  }

  function setDrawerOpen(open) {
    const drawer = document.getElementById(DRAWER_ID);
    const button = document.getElementById(BUTTON_ID);
    if (!drawer) return;

    drawer.classList.toggle("tg-open", open);
    drawer.setAttribute("aria-hidden", open ? "false" : "true");
    button?.setAttribute("aria-expanded", open ? "true" : "false");
    setOpen(open);

    if (open) {
      button?.classList.remove("tg2-idle");
      applyPanelState();
      startRunningPoll();
      scheduleAdaptiveBackdropDetection("panel-open");
    } else {
      const menu = drawer.querySelector("[data-menu]");
      if (menu) menu.hidden = true;
      setCurrentFilter("danger");
      drawer.removeAttribute("data-resize-direction");
      drawer.removeAttribute("data-resizing");
      if (panelAutoRefreshTimerId) {
        clearTimeout(panelAutoRefreshTimerId);
        panelAutoRefreshTimerId = null;
      }
      stopRunningPoll();
      stopCountdownTimer();
      resetLauncherIdleTimer();
    }
  }

  function isAssistantElement(element) {
    const root = document.getElementById(ROOT_ID);
    return Boolean(root && element && (element === root || root.contains(element)));
  }

  function parseAdaptiveColor(value) {
    const match = String(value || "").match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)/i);
    if (!match) return null;
    const alpha = match[4] === undefined ? 1 : Number(match[4]);
    if (!Number.isFinite(alpha) || alpha < 0.08) return null;
    const rgb = [Number(match[1]), Number(match[2]), Number(match[3])].map(channel => clamp(channel, 0, 255) / 255);
    const linear = rgb.map(channel => channel <= .03928 ? channel / 12.92 : Math.pow((channel + .055) / 1.055, 2.4));
    return { luminance: .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2], alpha };
  }

  function resolveAdaptiveSample(element) {
    let current = element;
    while (current && current !== document.documentElement?.parentElement) {
      if (isAssistantElement(current)) {
        current = current.parentElement;
        continue;
      }
      const style = getComputedStyle(current);
      if (style.backgroundImage && style.backgroundImage !== "none") return null;
      const color = parseAdaptiveColor(style.backgroundColor);
      if (color) return color;
      current = current.parentElement;
    }
    return null;
  }

  function sampleAdaptiveBackdrop() {
    const drawer = document.getElementById(DRAWER_ID);
    if (!drawer || !isOpen() || typeof document.elementsFromPoint !== "function") return "neutral";
    const rect = drawer.getBoundingClientRect();
    const xSteps = [.16, .5, .84];
    const ySteps = [.14, .5, .86];
    let light = 0;
    let dark = 0;
    let valid = 0;
    for (const yStep of ySteps) {
      for (const xStep of xSteps) {
        const x = clamp(rect.left + rect.width * xStep, 1, window.innerWidth - 1);
        const y = clamp(rect.top + rect.height * yStep, 1, window.innerHeight - 1);
        const elements = document.elementsFromPoint(x, y);
        let sample = null;
        for (const element of elements) {
          if (isAssistantElement(element)) continue;
          sample = resolveAdaptiveSample(element);
          break;
        }
        if (!sample) continue;
        if (sample.luminance >= .65) light++;
        else if (sample.luminance <= .2) dark++;
        else continue;
        valid++;
      }
    }
    if (valid < 5) return "neutral";
    if (light / valid >= .7) return "light";
    if (dark / valid >= .7) return "dark";
    return "neutral";
  }

  function applyAdaptiveBackdropMode(mode) {
    const root = document.getElementById(ROOT_ID);
    if (!root) return;
    const nextMode = ["light", "dark", "neutral"].includes(mode) ? mode : "neutral";
    root.dataset.backdropTone = nextMode;
    adaptiveBackdropMode = nextMode;
  }

  function settleAdaptiveBackdropMode(candidate) {
    const now = Date.now();
    if (candidate !== adaptiveCandidateMode) {
      adaptiveCandidateMode = candidate;
      adaptiveCandidateHits = 1;
      adaptiveCandidateSince = now;
    } else {
      adaptiveCandidateHits += 1;
    }
    const elapsed = now - adaptiveCandidateSince;
    if (adaptiveCandidateHits >= 2 && elapsed >= 480) {
      applyAdaptiveBackdropMode(candidate);
      return;
    }
    if (adaptiveCandidateHits >= 2) {
      clearTimeout(adaptiveDetectTimerId);
      adaptiveDetectTimerId = setTimeout(() => {
        if (adaptiveCandidateMode === candidate && adaptiveCandidateHits >= 2) applyAdaptiveBackdropMode(candidate);
      }, Math.max(40, 480 - elapsed));
    }
  }

  function runAdaptiveBackdropDetection() {
    adaptiveDetectTimerId = null;
    try {
      settleAdaptiveBackdropMode(sampleAdaptiveBackdrop());
    } catch (_) {
      settleAdaptiveBackdropMode("neutral");
    }
  }

  function scheduleAdaptiveBackdropDetection() {
    if (!isOpen()) return;
    clearTimeout(adaptiveDetectTimerId);
    adaptiveDetectTimerId = setTimeout(runAdaptiveBackdropDetection, 40);
  }

  function attachAdaptiveBackdropListeners() {
    if (adaptiveListenersAttached) return;
    adaptiveListenersAttached = true;
    const scheduleAfterScroll = () => {
      clearTimeout(adaptiveScrollTimerId);
      adaptiveScrollTimerId = setTimeout(() => scheduleAdaptiveBackdropDetection("scroll-end"), 320);
    };
    window.addEventListener("scroll", scheduleAfterScroll, { passive: true });
    document.addEventListener("scroll", scheduleAfterScroll, { passive: true, capture: true });
  }

  async function maybeTriggerAutoRefreshOnce(source = "frontend-panel-open") {
    if (!isOpen()) return false;
    if (panelAutoRefreshRequested) return false;

    panelAutoRefreshRequested = true;
    const started = await requestBackendRefresh(source, "auto", {
      silentIfBusy: true
    });

    if (started) {
      startRunningPoll();
      render();
    }

    return started;
  }

  function attachButtonDrag(button) {
    if (!button || button.dataset.dragReady === "1") return;
    button.dataset.dragReady = "1";

    let pointerId = null;
    let pointerDownX = 0;
    let pointerDownY = 0;
    let originY = 0;
    let dragging = false;
    let didDrag = false;

    const resetPointerState = () => {
      pointerId = null;
      pointerDownX = 0;
      pointerDownY = 0;
      originY = 0;
      dragging = false;
      didDrag = false;
      button.classList.remove("tg2-dragging", "tg2-pressed");
    };

    const finishPointer = async (event, cancelled = false) => {
      if (pointerId === null || (event && event.pointerId !== pointerId)) return;
      const currentPointerId = pointerId;
      const wasDrag = didDrag;
      const height = button.getBoundingClientRect().height || 52;

      // Set this before the first await. A browser click can be dispatched
      // while the async position persistence is still pending.
      if (wasDrag) suppressNextLauncherClick = true;

      if (wasDrag) {
        const currentY = Number.parseFloat(button.style.top);
        const measuredY = Number.isFinite(currentY)
          ? currentY
          : button.getBoundingClientRect().top;
        const y = Math.round(clamp(measuredY, 12, Math.max(12, window.innerHeight - height - 12)));
        button.style.top = `${y}px`;
        button.style.right = "16px";
        button.style.left = "auto";
        button.style.bottom = "auto";
        button.dataset.dragged = "1";
        await saveLauncherSettings({ y });
        await savePanelStatePatch({ buttonY: y, launcherY: y });
      }

      resetPointerState();
      try {
        if (button.hasPointerCapture?.(currentPointerId)) {
          button.releasePointerCapture(currentPointerId);
        }
      } catch (e) {}

      if (!wasDrag && !cancelled) {
        button.dataset.dragged = "0";
      }
      resetLauncherIdleTimer();
    };

    button.addEventListener("click", event => {
      if (!suppressNextLauncherClick) return;
      suppressNextLauncherClick = false;
      button.dataset.dragged = "0";
      event.preventDefault();
      event.stopPropagation();
    }, true);

    button.addEventListener("pointerdown", event => {
      if (event.button !== 0 || button.dataset.locked === "1") return;
      const rect = button.getBoundingClientRect();
      pointerId = event.pointerId;
      pointerDownX = event.clientX;
      pointerDownY = event.clientY;
      originY = rect.top;
      dragging = false;
      didDrag = false;
      button.dataset.dragged = "0";
      button.classList.add("tg2-pressed");
      button.setPointerCapture?.(event.pointerId);
      resetLauncherIdleTimer();
    });

    button.addEventListener("pointermove", event => {
      if (pointerId !== event.pointerId) return;
      const dx = event.clientX - pointerDownX;
      const dy = event.clientY - pointerDownY;
      const distance = Math.hypot(dx, dy);
      if (!dragging && distance >= LAUNCHER_DRAG_THRESHOLD) {
        dragging = true;
        didDrag = true;
        button.classList.add("tg2-dragging");
      }
      if (!dragging) return;
      const height = button.getBoundingClientRect().height || 52;
      const y = clamp(originY + dy, 12, Math.max(12, window.innerHeight - height - 12));
      button.style.top = `${y}px`;
      button.style.right = "16px";
      button.style.left = "auto";
      button.style.bottom = "auto";
      resetLauncherIdleTimer();
      event.preventDefault();
    }, { passive: false });

    button.addEventListener("pointerup", event => {
      finishPointer(event, false).catch(() => resetPointerState());
    });
    button.addEventListener("pointercancel", event => {
      finishPointer(event, true).catch(() => resetPointerState());
    });
    button.addEventListener("lostpointercapture", event => {
      finishPointer(event, true).catch(() => resetPointerState());
    });
    button.addEventListener("pointerenter", resetLauncherIdleTimer);
    button.addEventListener("focus", resetLauncherIdleTimer);
  }

  function getPanelPosition(drawer, left, top, width = drawer.offsetWidth, height = drawer.offsetHeight) {
    return {
      x: clamp(left, 8, Math.max(8, window.innerWidth - width - 8)),
      y: clamp(top, 8, Math.max(8, window.innerHeight - height - 8))
    };
  }

  function attachPanelDrag(drawer) {
    const header = drawer?.querySelector?.(".tg2-header");
    if (!drawer || !header || header.dataset.dragReady === "1") return;
    header.dataset.dragReady = "1";

    let pointerId = null;
    let startX = 0;
    let startY = 0;
    let originX = 0;
    let originY = 0;
    let dragging = false;

    const reset = () => {
      pointerId = null;
      dragging = false;
      header.classList.remove("tg2-panel-dragging");
    };

    const finish = async event => {
      if (pointerId === null || event?.pointerId !== pointerId) return;
      const currentPointerId = pointerId;
      const wasDragging = dragging;
      const rect = drawer.getBoundingClientRect();
      const position = getPanelPosition(drawer, rect.left, rect.top);
      if (wasDragging) {
        drawer.style.left = `${position.x}px`;
        drawer.style.top = `${position.y}px`;
        await savePanelStatePatch({ panelX: Math.round(position.x), panelY: Math.round(position.y) });
        scheduleAdaptiveBackdropDetection("panel-drag-end");
      }
      reset();
      try {
        if (header.hasPointerCapture?.(currentPointerId)) header.releasePointerCapture(currentPointerId);
      } catch (_) {}
    };

    header.addEventListener("pointerdown", event => {
      if (event.button !== 0 || drawer.dataset.locked === "1") return;
      if (event.target.closest("button, a, input, select, textarea, [data-action]")) return;
      const rect = drawer.getBoundingClientRect();
      if (event.clientX - rect.left <= 8 || rect.right - event.clientX <= 8 || event.clientY - rect.top <= 8 || rect.bottom - event.clientY <= 8) return;
      pointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      originX = rect.left;
      originY = rect.top;
      dragging = false;
      header.setPointerCapture?.(event.pointerId);
    });

    header.addEventListener("pointermove", event => {
      if (pointerId !== event.pointerId) return;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (!dragging && Math.hypot(dx, dy) >= 5) {
        dragging = true;
        header.classList.add("tg2-panel-dragging");
      }
      if (!dragging) return;
      const position = getPanelPosition(drawer, originX + dx, originY + dy);
      drawer.style.left = `${position.x}px`;
      drawer.style.top = `${position.y}px`;
      event.preventDefault();
    }, { passive: false });

    header.addEventListener("pointerup", event => finish(event).catch(reset));
    header.addEventListener("pointercancel", event => finish(event).catch(reset));
    header.addEventListener("lostpointercapture", event => finish(event).catch(reset));
  }

  function attachPanelResize(drawer) {
    if (!drawer || drawer.dataset.resizeReady === "1") return;
    drawer.dataset.resizeReady = "1";

    let pointerId = null;
    let direction = "";
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    let startWidth = 0;
    let startHeight = 0;
    const edgeSize = 8;
    const cornerSize = 16;

    const getDirection = (event, rect) => {
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const west = x <= edgeSize;
      const east = x >= rect.width - edgeSize;
      const north = y <= edgeSize;
      const south = y >= rect.height - edgeSize;
      const cornerWest = x <= cornerSize;
      const cornerEast = x >= rect.width - cornerSize;
      const cornerNorth = y <= cornerSize;
      const cornerSouth = y >= rect.height - cornerSize;
      if (cornerNorth && cornerWest) return "nw";
      if (cornerNorth && cornerEast) return "ne";
      if (cornerSouth && cornerWest) return "sw";
      if (cornerSouth && cornerEast) return "se";
      if (north) return "n";
      if (south) return "s";
      if (west) return "w";
      if (east) return "e";
      return "";
    };

    const setCursor = nextDirection => {
      drawer.dataset.resizeDirection = nextDirection || "";
    };

    const reset = () => {
      pointerId = null;
      direction = "";
      drawer.removeAttribute("data-resizing");
      setCursor("");
    };

    const finish = async event => {
      if (pointerId === null || event?.pointerId !== pointerId) return;
      const currentPointerId = pointerId;
      const rect = drawer.getBoundingClientRect();
      const position = getPanelPosition(drawer, rect.left, rect.top, rect.width, rect.height);
      drawer.style.left = `${position.x}px`;
      drawer.style.top = `${position.y}px`;
      await savePanelStatePatch({
        panelWidth: Math.round(rect.width),
        panelHeight: Math.round(rect.height),
        panelX: Math.round(position.x),
        panelY: Math.round(position.y)
      });
      scheduleAdaptiveBackdropDetection("panel-resize-end");
      reset();
      try {
        if (drawer.hasPointerCapture?.(currentPointerId)) drawer.releasePointerCapture(currentPointerId);
      } catch (_) {}
    };

    drawer.addEventListener("pointermove", event => {
      if (pointerId !== null) {
        if (event.pointerId !== pointerId) return;
        const dx = event.clientX - startX;
        const dy = event.clientY - startY;
        const maxViewportWidth = Math.max(320, window.innerWidth - 16);
        const maxViewportHeight = Math.max(320, window.innerHeight - 16);
        const minWidth = Math.min(420, maxViewportWidth);
        const minHeight = Math.min(420, maxViewportHeight);
        let width = startWidth;
        let height = startHeight;
        let left = startLeft;
        let top = startTop;
        if (direction.includes("e")) width = clamp(startWidth + dx, minWidth, Math.min(760, window.innerWidth - startLeft - 8));
        if (direction.includes("w")) {
          width = clamp(startWidth - dx, minWidth, Math.min(760, startLeft + startWidth - 8));
          left = startLeft + startWidth - width;
        }
        if (direction.includes("s")) height = clamp(startHeight + dy, minHeight, Math.min(maxViewportHeight, window.innerHeight - startTop - 8));
        if (direction.includes("n")) {
          height = clamp(startHeight - dy, minHeight, Math.min(maxViewportHeight, startTop + startHeight - 8));
          top = startTop + startHeight - height;
        }
        const position = getPanelPosition(drawer, left, top, width, height);
        drawer.style.width = `${width}px`;
        drawer.style.height = `${height}px`;
        drawer.style.left = `${position.x}px`;
        drawer.style.top = `${position.y}px`;
        event.preventDefault();
        return;
      }
      if (!isOpen()) return;
      setCursor(getDirection(event, drawer.getBoundingClientRect()));
    }, { passive: false });

    drawer.addEventListener("pointerleave", () => {
      if (pointerId === null) setCursor("");
    });

    drawer.addEventListener("pointerdown", event => {
      if (event.button !== 0) return;
      const nextDirection = getDirection(event, drawer.getBoundingClientRect());
      if (!nextDirection) return;
      const rect = drawer.getBoundingClientRect();
      pointerId = event.pointerId;
      direction = nextDirection;
      startX = event.clientX;
      startY = event.clientY;
      startLeft = rect.left;
      startTop = rect.top;
      startWidth = rect.width;
      startHeight = rect.height;
      drawer.setAttribute("data-resizing", direction);
      setCursor(direction);
      drawer.setPointerCapture?.(event.pointerId);
      event.preventDefault();
      event.stopPropagation();
    });

    drawer.addEventListener("pointerup", event => finish(event).catch(reset));
    drawer.addEventListener("pointercancel", event => finish(event).catch(reset));
    drawer.addEventListener("lostpointercapture", event => finish(event).catch(reset));
  }

  function attachDrawerResize(drawer) {
    if (!drawer || resizeObserverAttached || typeof ResizeObserver === "undefined") return;
    resizeObserverAttached = true;

    let detectTimer = null;
    const observer = new ResizeObserver(entries => {
      const entry = entries[0];
      if (!entry || !isOpen()) return;

      clearTimeout(detectTimer);
      detectTimer = setTimeout(() => scheduleAdaptiveBackdropDetection("panel-resize-end"), 260);
    });

    observer.observe(drawer);
  }

  function resetLauncherIdleTimer() {
    const button = document.getElementById(BUTTON_ID);
    if (!button) return;
    button.classList.remove("tg2-idle");
    clearTimeout(launcherIdleTimerId);
    launcherIdleTimerId = null;
    if (isOpen() || document.hidden) return;
    launcherIdleTimerId = setTimeout(() => {
      if (!isOpen() && !document.hidden) button.classList.add("tg2-idle");
      launcherIdleTimerId = null;
    }, LAUNCHER_IDLE_MS);
  }

  function attachFullscreenListener() {
    if (fullscreenListenerAttached) return;
    fullscreenListenerAttached = true;
    const applyFullscreenState = () => {
      const button = document.getElementById(BUTTON_ID);
      if (!button) return;
      const hidden = Boolean(document.fullscreenElement);
      button.hidden = hidden;
      if (hidden) clearTimeout(launcherIdleTimerId);
      else resetLauncherIdleTimer();
    };
    document.addEventListener("fullscreenchange", applyFullscreenState);
    applyFullscreenState();
  }

  function attachVisibilityListener() {
    if (visibilityListenerAttached) return;
    visibilityListenerAttached = true;
    document.addEventListener("visibilitychange", () => {
      const button = document.getElementById(BUTTON_ID);
      if (document.hidden) {
        clearTimeout(launcherIdleTimerId);
        button?.classList.remove("tg2-idle");
      } else {
        resetLauncherIdleTimer();
      }
    });
  }

  function isEditableTarget(target) {
    return Boolean(target?.closest?.("input, textarea, select, [contenteditable=\"true\"]"));
  }

  function normalizeShortcutKey(key) {
    const value = String(key || "");
    if (value === " ") return "Space";
    if (value.length === 1) return value.toUpperCase();
    return value.replace(/^Key/, "").replace(/^Digit/, "");
  }

  function formatShortcut(shortcut) {
    if (!shortcut) return "未设置";
    return [shortcut.ctrl && "Ctrl", shortcut.alt && "Alt", shortcut.shift && "Shift", shortcut.meta && "Meta", normalizeShortcutKey(shortcut.key)].filter(Boolean).join(" + ");
  }

  function isShortcutMatch(event, shortcut) {
    if (!shortcut) return false;
    return normalizeShortcutKey(event.code || event.key) === normalizeShortcutKey(shortcut.key) &&
      event.ctrlKey === shortcut.ctrl && event.altKey === shortcut.alt && event.shiftKey === shortcut.shift && event.metaKey === shortcut.meta;
  }

  function updateShortcutMenu() {
    const stateEl = document.querySelector(`#${DRAWER_ID} [data-shortcut-state]`);
    const button = document.querySelector(`#${DRAWER_ID} [data-action="record-shortcut"]`);
    if (!stateEl || !button) return;
    if (shortcutCaptureActive) {
      stateEl.textContent = "录制中：按下组合键；Esc 取消，Delete 清除";
      button.textContent = "等待按键…";
      return;
    }
    loadShortcut().then(shortcut => {
      stateEl.textContent = `当前：${formatShortcut(shortcut)}`;
      button.textContent = "重新设置";
    }).catch(() => {});
  }

  function attachShortcutListener() {
    if (shortcutListenerAttached) return;
    shortcutListenerAttached = true;
    window.addEventListener("keydown", async event => {
      if (shortcutCaptureActive) {
        if (event.key === "Escape") {
          shortcutCaptureActive = false;
          updateShortcutMenu();
          event.preventDefault();
          return;
        }
        if (event.key === "Delete") {
          shortcutCaptureActive = false;
          await saveShortcut(null);
          updateShortcutMenu();
          event.preventDefault();
          return;
        }
        if (["Control", "Alt", "Shift", "Meta"].includes(event.key)) return;
        if (!(event.ctrlKey || event.altKey || event.shiftKey || event.metaKey)) return;
        await saveShortcut({
          key: normalizeShortcutKey(event.code || event.key),
          ctrl: event.ctrlKey,
          alt: event.altKey,
          shift: event.shiftKey,
          meta: event.metaKey
        });
        shortcutCaptureActive = false;
        updateShortcutMenu();
        event.preventDefault();
        return;
      }

      if (isEditableTarget(event.target)) return;
      const shortcut = await loadShortcut();
      if (!isShortcutMatch(event, shortcut)) return;
      event.preventDefault();
      setDrawerOpen(!isOpen());
      render();
    });
  }

  function getLatestTgRequestMeta(data) {
    const logs = Array.isArray(data?.debug?.requestLog) ? data.debug.requestLog : [];
    return logs.slice().reverse().find(item =>
      (item?.siteKey === "tg" || item?.siteKey === "tg-zcst" || !item?.siteKey) &&
      item?.ok !== false && Number.isFinite(Number(item?.durationMs))
    ) || null;
  }

  function getConnectionStatusInfo(data, refreshStatus, lastError, loginRequired) {
    const hostLabel = getCurrentPageSite().siteName;
    if (loginRequired) return { text: `${hostLabel} 未登录`, tone: "error" };
    if (refreshStatus?.status === "error" || lastError?.message) return { text: `${hostLabel} 扫描失败`, tone: "error" };
    if (latestLatencyState?.status === "running") return { text: "测速中…", tone: "warn" };
    const meta = getLatestTgRequestMeta(data);
    const duration = Number(latestLatencyState?.siteKey === getCurrentBackendSiteKey() ? latestLatencyState.durationMs : meta?.durationMs);
    if (Number.isFinite(duration)) {
      const value = duration >= 1000 ? `${(duration / 1000).toFixed(1)} s` : `${Math.round(duration)} ms`;
      if (duration >= 1000) return { text: `${hostLabel} 响应较慢 · ${value}`, tone: "warn" };
      const updatedAt = data?.scanTime ? ` · 更新于 ${formatDateTime(data.scanTime).slice(-5)}` : "";
      return { text: `${hostLabel} · ${value}${updatedAt}`, tone: "ok" };
    }
    return { text: `${hostLabel} · 等待首次扫描`, tone: "warn" };
  }

  function updateConnectionStatus(data, refreshStatus, lastError, loginRequired) {
    const root = document.getElementById(ROOT_ID);
    const status = root?.querySelector("[data-connection-status]");
    const text = root?.querySelector("[data-connection-text]");
    if (!status || !text) return;
    const info = getConnectionStatusInfo(data, refreshStatus, lastError, loginRequired);
    status.classList.toggle("tg2-warn", info.tone === "warn");
    status.classList.toggle("tg2-error", info.tone === "error");
    text.textContent = info.text;
  }

  async function measureCurrentTgLatency() {
    const serial = ++latencyTestSerial;
    latestLatencyState = { status: "running", siteKey: getCurrentBackendSiteKey() };
    updateLatencyButton();
    updateConnectionStatus(null, null, null, false);
    try {
      const state = await loadFrontendState();
      const site = getCurrentPageSite();
      const logs = Array.isArray(state.result?.debug?.requestLog) ? state.result.debug.requestLog : [];
      const entry = logs.slice().reverse().find(item => {
        if (!item?.url || item.ok === false) return false;
        if (site.siteKey === "educoder") return item.siteKey === "educoder" || item.url.startsWith(site.apiOrigin);
        return item.siteKey === "tg" || item.siteKey === "tg-zcst" || item.url.startsWith(site.pageOrigin);
      });
      const endpoint = new URL(entry?.url || location.href, location.href);
      const allowedOrigins = site.siteKey === "educoder"
        ? [site.pageOrigin, site.apiOrigin]
        : [site.pageOrigin];
      if (!allowedOrigins.includes(endpoint.origin)) throw new Error("已验证 endpoint 与当前入口 Origin 不一致");
      const samples = [];
      for (let i = 0; i < 3; i += 1) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);
        const started = performance.now();
        try {
          const response = await fetch(endpoint.href, { method: "GET", credentials: "include", cache: "no-store", headers: { accept: "application/json" }, signal: controller.signal });
          await response.text();
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          samples.push(Math.round(performance.now() - started));
        } finally {
          clearTimeout(timeoutId);
        }
      }
      samples.sort((a, b) => a - b);
      latestLatencyState = { status: "done", siteKey: getCurrentBackendSiteKey(), durationMs: samples[1], samples, testedAt: Date.now() };
      await setValue(STORE_KEY_LATENCY, latestLatencyState);
    } catch (error) {
      latestLatencyState = { status: "error", siteKey: getCurrentBackendSiteKey(), message: error?.message || String(error), testedAt: Date.now() };
      await setValue(STORE_KEY_LATENCY, latestLatencyState);
    }
    if (serial === latencyTestSerial) render();
  }

  function updateLatencyButton() {
    const button = document.querySelector(`#${DRAWER_ID} [data-action="run-latency"]`);
    if (!button) return;
    const state = latestLatencyState;
    button.textContent = state?.status === "running"
      ? "测试中…"
      : state?.status === "done" && Number.isFinite(Number(state.durationMs))
        ? `${Math.max(0, Math.round(Number(state.durationMs)))} ms`
        : state?.status === "error" ? "超时" : "--";
    button.setAttribute("aria-label", state?.status === "done" ? `当前延迟 ${button.textContent}` : "重新测试延迟");
  }

  function maybeRunInitialLatencyTest() {
    if (initialLatencyTestRequested || ![TG_INTRANET_HOST, "tg.zcst.edu.cn", "www.educoder.net"].includes(location.hostname)) return;
    initialLatencyTestRequested = true;
    setTimeout(() => {
      measureCurrentTgLatency().catch(error => console.warn("TG 初次延迟测试失败", error));
    }, 0);
  }

  async function requestBackendRefresh(source, type = "manual", options = {}) {
    const silentIfBusy = options?.silentIfBusy === true;
    if (await isRefreshBusy()) {
      if (!silentIfBusy) {
        alert("正在刷新中，请稍后。");
      }
      return false;
    }

    // 刷新开始前先清空上一轮错误，避免成功刷新后面板和导出 JSON 仍残留旧报错。
    await setValue(STORE_KEY_LAST_ERROR, null);

    if (location.hostname === "www.educoder.net") {
      try {
        await scanEducoderInPage(source);
        activeRefreshRequestId = `educoder:${Date.now()}`;
        activeRefreshStartedAt = Date.now();
      } catch (err) {
        console.error("Educoder 页面内扫描失败：", err);
        activeRefreshRequestId = "";
        activeRefreshStartedAt = 0;
        panelAutoRefreshRequested = false;
      }
      return true;
    }

    const requestId = Date.now() + "-" + Math.random().toString(36).slice(2, 8);
    const requestedAt = Date.now();
    const site = getCurrentPageSite();
    const login = site.login || latestResultLogin || saveAutoLoginIfDetected() || parseLoginFromCurrentUrl() || "";
    activeRefreshRequestId = requestId;
    activeRefreshStartedAt = requestedAt;
    await setValue(STORE_KEY_REFRESH_STATUS, {
      status: "waiting",
      requestId,
      progress: 8,
      message: "等待后台响应",
      siteKey: getCurrentBackendSiteKey(),
      siteName: site.siteName,
      pageHost: site.pageHost,
      time: new Date().toLocaleString(),
      timestamp: Date.now()
    });
    await setValue(STORE_KEY_REFRESH_REQUEST, {
      type,
      login,
      siteKey: getCurrentBackendSiteKey(),
      siteName: site.siteName,
      pageHost: location.hostname,
      requestId,
      requestedAt,
      requestedAtText: new Date(requestedAt).toLocaleString(),
      source
    });
    return true;
  }
  function startRunningPoll() {
    if (pollTimerId) return;
    pollWasRunning = false;
    pollTimerId = setInterval(async () => {
      if (!isOpen()) {
        stopRunningPoll();
        return;
      }
      const refreshStatus = await getValue(STORE_KEY_REFRESH_STATUS, null);
      const refreshRequest = await getValue(STORE_KEY_REFRESH_REQUEST, null);
      const refreshHandled = await getValue(STORE_KEY_REFRESH_HANDLED, 0);
      const presentation = deriveRefreshPresentation({
        refreshStatus,
        refreshRequest,
        refreshHandled,
        runningState: await loadRunningState(),
        lastError: await loadLastError()
      });
      if (presentation.isRunning || presentation.pending || presentation.isWaiting) {
        pollWasRunning = true;
        render();
        return;
      }
      if (presentation.hasCurrentTerminalStatus) {
        if (presentation.statusName === "done") {
        }
        activeRefreshRequestId = "";
        activeRefreshStartedAt = 0;
        render();
        stopRunningPoll();
        return;
      }
      const runningState = await loadRunningState();
      const isRunning = runningState?.running === true;
      if (isRunning) {
        pollWasRunning = true;
        render();
        return;
      }
      if (pollWasRunning) {
        pollWasRunning = false;
        activeRefreshRequestId = "";
        activeRefreshStartedAt = 0;
        render();
        stopRunningPoll();
        return;
      }
      render();
      stopRunningPoll();
    }, 1000);
  }

  function stopRunningPoll() {
    if (!pollTimerId) return;
    clearInterval(pollTimerId);
    pollTimerId = null;
  }

  async function deleteTaskCache() {
    if (!confirm("确定要删除 TG任务助手缓存吗？这会清空当前扫描结果、运行状态、错误信息和复制用 JSON。")) return;
    await deleteValue(getCurrentPageSite().resultKey);
    await deleteValue(STORE_KEY);
    await deleteValue(STORE_KEY_LAST_RUNNING);
    await deleteValue(STORE_KEY_LAST_ERROR);
    panelAutoRefreshRequested = false;
    activeRefreshRequestId = "";
    activeRefreshStartedAt = 0;
    cacheDeletedNotice = "缓存已删除";
    render();
  }

  function updateFloatingBadge(summary) {
    const badge = document.querySelector(`#${BUTTON_ID} .tg2-launcher-badge`);
    if (!badge) return;
    const count = Number(summary?.dangerCount) || 0;
    badge.textContent = String(count > 9 ? "9+" : count);
    badge.style.display = count > 0 ? "block" : "none";
  }

  function getFilterLabel(filter) {
    const labels = { ignored: "忽略", all: "总任务", unfinished: "未完成", danger: "危险", exercise: "考试", common_homework: "图文", homework: "图文", classroom_experiment: "实验", experiment: "实验" };
    return labels[filter] || "全部任务";
  }

  function taskMatchesFilter(task, filter) {
    if (filter === "completed") return task.completed === true;
    if (filter === "unfinished") return !task.completed;
    if (filter === "exercise") return task.taskType === "exercise";
    if (filter === "common_homework" || filter === "homework") return task.taskType === "common_homework";
    if (filter === "classroom_experiment" || filter === "experiment") return task.taskType === "classroom_experiment";
    if (filter === "danger") return isDangerTask(task);
    return true;
  }

  function renderSummaryCard(filter, numberHtml, label, selectedFilter) {
    const selected = selectedFilter === filter;
    return `
      <button class="tg-summary-item ${selected ? "tg-selected" : ""}" type="button" data-summary-filter="${escapeHtml(filter)}" data-tooltip="${escapeHtml(label)}">
        ${numberHtml}
        <div class="tg-summary-label">${escapeHtml(label)}</div>
      </button>
    `;
  }

  function getEducoderPageFetch() {
    if (typeof unsafeWindow !== "undefined" && unsafeWindow?.fetch) {
      return unsafeWindow.fetch.bind(unsafeWindow);
    }

    return window.fetch.bind(window);
  }

  async function fetchEducoderPageJson(url) {
    const pageFetch = getEducoderPageFetch();
    const res = await pageFetch(url, {
      method: "GET",
      mode: "cors",
      credentials: "include",
      cache: "no-store",
      headers: {
        accept: "application/json",
        "content-type": "application/json; charset=utf-8"
      }
    });
    const text = await res.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      const error = new Error("Educoder JSON解析失败：" + text.slice(0, 300));
      error.detail = {
        url,
        httpStatus: res.status,
        statusText: res.statusText,
        textPreview: text.slice(0, 500),
        keys: [],
        parseError: err?.message || String(err)
      };
      throw error;
    }

    return {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      data,
      textPreview: text.slice(0, 500),
      keys: data && typeof data === "object" ? Object.keys(data) : []
    };
  }

  async function fetchAndLogEducoderPageJson(url, requestLog, type) {
    try {
      const resp = await fetchEducoderPageJson(url);
      requestLog.push({
        siteKey: "educoder",
        siteName: "头歌公网",
        type,
        url,
        httpStatus: resp.status,
        statusText: resp.statusText,
        ok: resp.ok,
        textPreview: resp.textPreview,
        keys: resp.keys,
        status: resp.data?.status,
        message: resp.data?.message,
        rawCount: Array.isArray(resp.data?.exercises)
          ? resp.data.exercises.length
          : Array.isArray(resp.data?.homeworks)
            ? resp.data.homeworks.length
            : undefined
      });
      return resp;
    } catch (err) {
      const detail = err?.detail || {};
      requestLog.push({
        siteKey: "educoder",
        siteName: "头歌公网",
        type,
        url,
        httpStatus: detail.httpStatus || 0,
        statusText: detail.statusText || "",
        ok: false,
        textPreview: detail.textPreview || "",
        keys: detail.keys || [],
        error: err?.message || String(err)
      });
      throw err;
    }
  }

  function parseEducoderExerciseStatus(user) {
    if (!user) {
      return {
        commitStatus: null,
        statusText: "未提交",
        completed: false
      };
    }

    const commitStatus = user.commit_status;
    if (commitStatus === 0) return { commitStatus, statusText: "未提交", completed: false };
    if (commitStatus === 1) return { commitStatus, statusText: "提交中/待评阅", completed: false };
    if (commitStatus === 2) return { commitStatus, statusText: "已完成/已提交", completed: true };

    return {
      commitStatus,
      statusText: user.end_at || user.score != null ? "已完成/已提交" : "未知状态",
      completed: !!user.end_at || user.score != null
    };
  }

  function parseEducoderHomeworkItem(course, item) {
    const homeworkStatus = Array.isArray(item?.status) ? item.status : [];
    const workStatus = Array.isArray(item?.work_status) ? item.work_status : [];
    const workStatusText = workStatus.join(" ");
    const ended = homeworkStatus.includes("已截止") || item?.time_status === 5;
    let notSubmitted = false;
    let submitted = false;

    if (typeof item?.un_commit_work === "boolean") {
      notSubmitted = item.un_commit_work === true;
      submitted = item.un_commit_work === false;
    } else {
      notSubmitted = workStatusText.includes("提交作品") || workStatusText.includes("未提交");
      submitted = workStatusText.includes("查看作品") || workStatusText.includes("已提交") || workStatusText.includes("已完成");
    }

    let statusText = "未知状态";
    if (notSubmitted) statusText = ended ? "已截止/未提交" : "未提交";
    else if (submitted) statusText = ended ? "已截止/已提交" : "已提交";

    const homeworkId = item?.homework_id || item?.id;
    return {
      taskType: "common_homework",
      taskTypeText: "图文作业",
      siteKey: "educoder",
      siteName: "头歌公网",
      courseId: course.courseId,
      courseIdentifier: course.courseIdentifier,
      courseName: course.courseName,
      homeworkId,
      workId: item?.work_id || item?.student_work_id,
      studentWorkId: item?.student_work_id,
      title: item?.name || item?.homework_name || "未命名图文作业",
      homeworkStatus,
      workStatus,
      timeStatus: item?.time_status,
      statusText,
      completed: submitted,
      submitted,
      notSubmitted,
      ended,
      publishTime: item?.publish_time || "",
      endTime: item?.end_time || item?.end_time_s || "",
      lateTime: item?.late_time || "",
      score: "--",
      source: "educoder-page-homework_commons_1",
      detailUrl: `${course.pageOrigin}/classrooms/${course.courseIdentifier}/common_homework/${homeworkId}/detail?tabs=0`,
      scanTime: new Date().toLocaleString(),
      raw: item
    };
  }

  function parseEducoderExperimentItem(course, item) {
    const finishedStatus = Number(item?.shixun_finished_status);
    const completed = finishedStatus === 1;
    const ended = item?.time_status === 5 || (Array.isArray(item?.status) && item.status.includes("已截止"));
    const homeworkId = item?.homework_id || item?.id;

    return {
      taskType: "classroom_experiment",
      taskTypeText: "课堂实验",
      siteKey: "educoder",
      siteName: "头歌公网",
      courseId: course.courseId,
      courseIdentifier: course.courseIdentifier,
      courseName: course.courseName,
      homeworkId,
      title: item?.name || item?.shixun_name || "未命名课堂实验",
      statusText: completed ? "已完成" : ended ? "已截止/未完成" : "进行中/未完成",
      completed,
      submitted: completed,
      notSubmitted: !completed,
      ended,
      publishTime: item?.publish_time || "",
      endTime: item?.end_time_s || item?.end_time || "",
      lateTime: item?.late_time || "",
      challengeCount: item?.challenge_count ?? null,
      finishedChallengeCount: item?.finished_challenge_count ?? null,
      passedTime: item?.student_passed_time || "",
      detailUrl: `${course.pageOrigin}/classrooms/${course.courseIdentifier}/shixun_homework/${homeworkId}/detail?tabs=1`,
      source: "educoder-page-homework_commons_4",
      scanTime: new Date().toLocaleString(),
      raw: item
    };
  }

  async function scanEducoderInPage(source = "frontend-header-button") {
    const site = getCurrentPageSite();
    const requestId = Date.now() + "-" + Math.random().toString(36).slice(2, 8);
    const requestLog = [];
    const errors = [];
    const scanTime = new Date().toLocaleString();
    const scanTimestamp = Date.now();
    const course = {
      courseId: site.courseId,
      courseIdentifier: site.courseIdentifier,
      courseName: site.courseName,
      pageOrigin: site.pageOrigin,
      apiOrigin: site.apiOrigin
    };

    await setValue(STORE_KEY_LAST_ERROR, null);
    await setValue(STORE_KEY_REFRESH_STATUS, {
      status: "running",
      requestId,
      progress: 18,
      message: "正在扫描头歌公网任务",
      siteKey: "educoder",
      siteName: site.siteName,
      source,
      time: new Date().toLocaleString(),
      timestamp: Date.now()
    });

   try {
  function getEducoderActualLogin(site) {
    // 1. 如果当前页面是 /users/xxx/classrooms，就优先取当前页面里的 xxx
    const pageMatch = location.pathname.match(/\/users\/([^/]+)/);
    if (pageMatch && pageMatch[1]) {
      return decodeURIComponent(pageMatch[1]);
    }

    // 2. 如果当前页面不是用户页，比如 /paths，就回退使用 site.login
    if (site && site.login) {
      return site.login;
    }

    // 3. 两个都没有才报错
    throw new Error(
      "无法识别 Educoder 用户 ID：当前页面不是 /users/xxx 页面，且 site.login 为空。当前地址：" + location.href
    );
  }

  const actualLogin = getEducoderActualLogin(site);

  const homepageUrl =
    `${site.apiOrigin}/api/users/${encodeURIComponent(actualLogin)}/homepage_info.json?zzud=${encodeURIComponent(actualLogin)}`;

  console.log("[TG任务助手] homepage_info 实际请求地址:", homepageUrl);

  const homepageResp = await fetchAndLogEducoderPageJson(
    homepageUrl,
    requestLog,
    "homepage_info"
  );

  const homepage = homepageResp.data;

  if (!homepage || homepage.is_logged_user !== true) {
    throw new Error("头歌公网未登录或登录态失效：" + JSON.stringify({
      status: homepage?.status,
      message: homepage?.message,
      keys: homepageResp.keys,
      preview: homepageResp.textPreview
    }));
  }

  // 下面原来的代码继续保留

      const exerciseUrl = `${site.apiOrigin}/api/v2/courses/${course.courseIdentifier}/exercises.json?coursesId=${course.courseIdentifier}&limit=20&type=&id=${course.courseIdentifier}&zzud=${encodeURIComponent(site.login)}`;
      const exerciseResp = await fetchAndLogEducoderPageJson(exerciseUrl, requestLog, "exercise_list");
      if (!Array.isArray(exerciseResp.data?.exercises)) {
        throw new Error("Educoder 考试列表返回结构异常：" + JSON.stringify({
          status: exerciseResp.data?.status,
          message: exerciseResp.data?.message,
          keys: exerciseResp.keys,
          preview: exerciseResp.textPreview
        }));
      }
      const rawExams = exerciseResp.data.exercises;

      const exams = [];
      for (const exam of rawExams) {
        const exerciseId = exam?.id;
        let user = null;
        let totalScore = "--";
        let status = { commitStatus: null, statusText: "未提交", completed: false };

        if (exerciseId) {
          try {
            const userUrl = `${site.apiOrigin}/api/exercises/${encodeURIComponent(exerciseId)}/exercise_users.json?page=1&limit=20&coursesId=${course.courseIdentifier}&categoryId=${encodeURIComponent(exerciseId)}&zzud=${encodeURIComponent(site.login)}`;
            const userResp = await fetchAndLogEducoderPageJson(userUrl, requestLog, "exercise_user");
            const userPayload = userResp.data;
            user = userPayload?.current_answer_user || userPayload?.data?.current_answer_user || null;
            totalScore = userPayload?.total_score ?? userPayload?.data?.total_score ?? "--";
            status = parseEducoderExerciseStatus(user);
          } catch (err) {
            errors.push({
              stage: "exercise_user",
              siteKey: "educoder",
              siteName: site.siteName,
              courseName: course.courseName,
              exerciseId,
              message: err?.message || String(err)
            });
          }
        }

        exams.push({
          taskType: "exercise",
          taskTypeText: "考试/小测试",
          siteKey: "educoder",
          siteName: site.siteName,
          courseId: course.courseId,
          courseIdentifier: course.courseIdentifier,
          courseName: course.courseName,
          exerciseId,
          title: exam?.exercise_name || exam?.name || exam?.title || "未命名考试",
          detailUrl: `${site.pageOrigin}/classrooms/${course.courseIdentifier}/exercisenotice/${exerciseId}/users/${encodeURIComponent(site.login)}`,
          deadlineRemaining: exam?.exercise_left_time || "--",
          durationMinutes: exam?.time ?? null,
          exerciseStatus: exam?.exercise_status ?? null,
          currentStatus: exam?.current_status ?? null,
          wholeExerciseStatus: exam?.whole_exercise_status ?? null,
          exerciseUserId: exam?.exercise_user_id ?? user?.exercise_user_id ?? null,
          ...status,
          startAt: user?.start_at || null,
          endAt: user?.end_at || null,
          score: user?.score ?? "--",
          totalScore,
          objectiveScore: user?.objective_score ?? "--",
          subjectiveScore: user?.subjective_score ?? "--",
          reviewStatus: user?.review_status ?? false,
          userName: user?.user_name || "",
          studentId: user?.student_id || "",
          scanTime,
          raw: { exam, user }
        });
      }

      const homeworkUrl = `${site.apiOrigin}/api/courses/${course.courseIdentifier}/homework_commons.json?limit=100&status=0&id=${course.courseIdentifier}&type=1&sort_by=updated_at&sort_direction=asc&order=0&zzud=${encodeURIComponent(site.login)}`;
      const homeworkResp = await fetchAndLogEducoderPageJson(homeworkUrl, requestLog, "homework_commons_1");
      if (!Array.isArray(homeworkResp.data?.homeworks)) {
        throw new Error("Educoder 图文作业返回结构异常：" + JSON.stringify({
          status: homeworkResp.data?.status,
          message: homeworkResp.data?.message,
          keys: homeworkResp.keys,
          preview: homeworkResp.textPreview
        }));
      }
      const homeworks = homeworkResp.data.homeworks.map(item => parseEducoderHomeworkItem(course, item));

      const experimentUrl = `${site.apiOrigin}/api/courses/${course.courseIdentifier}/homework_commons.json?limit=100&status=0&id=${course.courseIdentifier}&type=4&sort_by=updated_at&sort_direction=asc&order=0&zzud=${encodeURIComponent(site.login)}`;
      const experimentResp = await fetchAndLogEducoderPageJson(experimentUrl, requestLog, "homework_commons_4");
      if (!Array.isArray(experimentResp.data?.homeworks)) {
        throw new Error("Educoder 课堂实验返回结构异常：" + JSON.stringify({
          status: experimentResp.data?.status,
          message: experimentResp.data?.message,
          keys: experimentResp.keys,
          preview: experimentResp.textPreview
        }));
      }
      const experiments = experimentResp.data.homeworks.map(item => parseEducoderExperimentItem(course, item));
      const tasks = sortTasks([...exams, ...homeworks, ...experiments]);
      const result = {
        login: site.login,
        currentSite: {
          key: "educoder",
          name: site.siteName,
          pageOrigin: site.pageOrigin,
          apiOrigin: site.apiOrigin
        },
        scanTime,
        scanTimestamp,
        source: "educoder-page-frontend",
        courses: [
          {
            courseId: course.courseId,
            courseIdentifier: course.courseIdentifier,
            courseName: course.courseName,
            siteKey: "educoder",
            siteName: site.siteName,
            pageOrigin: site.pageOrigin,
            apiOrigin: site.apiOrigin,
            login: site.login,
            exams,
            homeworks,
            experiments
          }
        ],
        tasks,
        errors,
        warnings: [],
        debug: {
          requestLog
        },
        summary: calculateSummaryFromTasks(tasks)
      };

      await setValue(STORE_KEY_EDUCODER_RESULT, result);
      await setValue(STORE_KEY_LAST_ERROR, null);
      await setValue(STORE_KEY_REFRESH_STATUS, {
        status: "done",
        requestId,
        progress: 100,
        message: "刷新完成",
        siteKey: "educoder",
        siteName: site.siteName,
        time: new Date().toLocaleString(),
        timestamp: Date.now()
      });
      render();
      return result;
    } catch (err) {
      const message = err?.message || String(err);
      await setValue(STORE_KEY_LAST_ERROR, {
        siteKey: "educoder",
        siteName: site.siteName,
        time: new Date().toLocaleString(),
        message: "Educoder 页面内刷新失败，请复制全部 JSON 排查。",
        error: message,
        stack: err?.stack || "",
        stage: "educoder_page_frontend",
        debug: {
          requestLog,
          errorDetail: err?.detail || null
        }
      });
      await setValue(STORE_KEY_REFRESH_STATUS, {
        status: "error",
        requestId,
        progress: 100,
        message: "Educoder 页面内刷新失败，请复制全部 JSON 排查。",
        error: message,
        siteKey: "educoder",
        siteName: site.siteName,
        time: new Date().toLocaleString(),
        timestamp: Date.now()
      });
      render();
      throw err;
    }
  }

  function renderYearMonthFilter(year, month) {
    const now = new Date();
    const currentYear = now.getFullYear();
    const years = [];
    for (let y = currentYear - 3; y <= currentYear + 1; y += 1) years.push(y);
    const yearOptions = years.map(y => `<option value="${y}" ${Number(y) === Number(year) ? "selected" : ""}>${y}</option>`).join("");
    const monthOptions = Array.from({ length: 12 }, (_, i) => i + 1).map(m => `<option value="${m}" ${Number(m) === Number(month) ? "selected" : ""}>${m}</option>`).join("");
    return `
      <div class="tg2-filter-row">
        <span>任务起点：${escapeHtml(year)} 年 ${escapeHtml(month)} 月以后</span>
        <div class="tg2-filter-controls">
          <select data-filter-year>${yearOptions}</select>
          <select data-filter-month>${monthOptions}</select>
        </div>
      </div>
    `;
  }

  function deriveRefreshPresentation({
    runningState = null,
    lastError = null,
    refreshRequest = null,
    refreshHandled = 0,
    refreshStatus = null,
    loginRequired = false,
    result = null,
    pageMode = "tg"
  } = {}) {
    const isLoginRequired = loginRequired || refreshStatus?.errorKind === "login_required" || lastError?.errorKind === "login_required";
    const statusName = String(refreshStatus?.status || "");
    const statusRequestId = String(refreshStatus?.requestId || "");
    const requestId = String(refreshRequest?.requestId || activeRefreshRequestId || "");
    const requestedAt = Number(refreshRequest?.requestedAt) || Number(activeRefreshStartedAt) || 0;
    const handledAt = Number(refreshHandled) || 0;
    const statusTimestamp = Number(refreshStatus?.timestamp) || 0;
    const resultTimestamp = Number(result?.updatedAt || result?.scanTimestamp || result?.timestamp) || 0;
    const hasNewerResult = Boolean(requestedAt && resultTimestamp > requestedAt);
    const statusMatchesCurrentRequest = requestId && statusRequestId
      ? statusRequestId === requestId
      : !requestedAt || statusTimestamp >= requestedAt;
    const hasCurrentTerminalStatus = (statusName === "done" || statusName === "error") && statusMatchesCurrentRequest;
    const hasCurrentWaitingStatus = statusName === "waiting" && statusMatchesCurrentRequest && !hasNewerResult;
    const isRunning = !isLoginRequired && !hasCurrentTerminalStatus && (
      runningState?.running === true || statusName === "running"
    );
    const pending = Boolean(
      !isLoginRequired && !hasCurrentTerminalStatus && !isRunning && !hasNewerResult &&
      requestedAt && requestedAt > handledAt
    );
    const isRetrying = isRunning && runningState?.stage === "tg_readiness_retrying";
    const isWaiting = !isLoginRequired && !hasCurrentTerminalStatus && (
      hasCurrentWaitingStatus ||
      pending ||
      (runningState?.running === true && runningState?.stage === "fetch_courses")
    );
    const hasError = !isLoginRequired && !isRunning && !pending && !hasCurrentTerminalStatus && Boolean(lastError?.message);
    const statusClass = isLoginRequired || hasCurrentTerminalStatus && statusName === "error" || hasError
      ? "tg-refresh-failed"
      : hasCurrentTerminalStatus && statusName === "done" || runningState?.stage === "done" && !isRunning
        ? "tg-refresh-done"
        : isRunning
          ? "tg-refresh-running"
          : pending
            ? "tg-refresh-pending"
            : "";
    const rawPercent = refreshStatus?.progress ?? runningState?.percent;
    const percent = Number.isFinite(Number(rawPercent))
      ? clamp(Number(rawPercent), 0, 100)
      : null;

    let title = "刷新状态";
    let stage = pageMode === "educoder"
      ? "展开面板后会自动进行页面内刷新。"
      : "展开面板后会自动请求后台刷新。";
    let barPercent = pending ? 18 : 0;

    if (isLoginRequired) {
      title = "TG 未登录";
      stage = "TG 未登录，请先登录后刷新";
      barPercent = 100;
    } else if (hasCurrentTerminalStatus && statusName === "done") {
      title = "最近刷新成功";
      stage = refreshStatus?.message || "刷新完成";
      barPercent = 100;
    } else if (hasCurrentTerminalStatus && statusName === "error") {
      title = "最近刷新失败";
      stage = refreshStatus?.error || refreshStatus?.message || "刷新失败";
      barPercent = 100;
    } else if (hasError) {
      title = "最近刷新失败";
      stage = lastError.message;
      barPercent = 100;
    } else if (isRetrying) {
      const retryAttempt = Number(runningState?.retryAttempt);
      const retryTotal = Number(runningState?.retryTotal);
      const retryText = retryAttempt > 0 && retryTotal > 0 ? ` ${retryAttempt}/${retryTotal}` : "…";
      const retryDelayMs = Number(runningState?.retryDelayMs);

      title = "TG 响应较慢";
      stage = `TG 响应较慢，正在重试${retryText}`;
      if (Number.isFinite(retryDelayMs) && retryDelayMs >= 0) {
        stage += `，约 ${Math.ceil(retryDelayMs / 1000)} 秒后重试`;
      }
      barPercent = percent ?? 0;
    } else if (isWaiting) {
      title = "等待 TG";
      stage = hasCurrentWaitingStatus || pending
        ? "已请求刷新，等待后台响应…"
        : "正在等待 TG 响应…";
      barPercent = percent ?? 0;
    } else if (isRunning) {
      title = "正在刷新";
      const current = Number(runningState?.current);
      const total = Number(runningState?.total);
      if (runningState?.stage === "scan_course" && Number.isFinite(current) && current >= 0 && Number.isFinite(total) && total > 0) {
        title = "正在扫描课程";
        stage = `正在扫描课程 ${current}/${total}`;
      } else {
        stage = runningState?.stageText || refreshStatus?.message || "后台正在扫描任务";
      }
      barPercent = percent ?? 0;
    } else if (runningState?.stage === "done") {
      title = "最近刷新完成";
      stage = runningState.endTime || runningState.stageText || "扫描完成";
      barPercent = 100;
    } else if (pending) {
      title = "已请求刷新";
      stage = "已请求刷新，等待后台响应…";
    } else if (hasNewerResult) {
      title = "最近刷新完成";
      stage = "已有较新的任务数据";
      barPercent = 100;
    } else if (runningState?.stageText) {
      title = "最近刷新状态";
      stage = runningState.stageText;
      barPercent = percent ?? 0;
    }

    return {
      title,
      stage: cleanStatusMessage(stage),
      barPercent: Math.round(barPercent),
      statusClass,
      isLoginRequired,
      isRunning,
      pending,
      isRetrying,
      isWaiting,
      hasCurrentTerminalStatus,
      hasNewerResult,
      requestId,
      statusName
    };
  }

  function logRefreshDebugState({ state, result, presentation }) {
    const snapshot = {
      request: {
        requestId: state?.refreshRequest?.requestId || "",
        requestedAt: state?.refreshRequest?.requestedAt || 0,
        handledAt: state?.refreshHandled || 0
      },
      status: {
        status: state?.refreshStatus?.status || "",
        requestId: state?.refreshStatus?.requestId || "",
        timestamp: state?.refreshStatus?.timestamp || 0,
        progress: state?.refreshStatus?.progress ?? null,
        message: state?.refreshStatus?.message || "",
        errorKind: state?.refreshStatus?.errorKind || ""
      },
      running: {
        running: state?.lastRunning?.running === true,
        stage: state?.lastRunning?.stage || "",
        current: state?.lastRunning?.current ?? null,
        total: state?.lastRunning?.total ?? null
      },
      resultUpdatedAt: result?.updatedAt || result?.scanTimestamp || result?.timestamp || 0,
      frontend: {
        activeRefreshRequestId,
        activeRefreshStartedAt,
        pollActive: Boolean(pollTimerId),
        panelOpen: isOpen(),
        derived: presentation ? {
          title: presentation.title,
          isRunning: presentation.isRunning,
          pending: presentation.pending,
          terminal: presentation.hasCurrentTerminalStatus
        } : null
      }
    };
    const signature = JSON.stringify(snapshot);
    if (signature === lastRefreshDebugSignature) return;
    lastRefreshDebugSignature = signature;
    console.info("[TG Assistant refresh debug]", snapshot);
  }

  function renderRefreshStatus(runningState, lastError, refreshRequest, refreshHandled, refreshStatus, loginRequired = false, result = null) {
    const presentation = deriveRefreshPresentation({
      runningState,
      lastError,
      refreshRequest,
      refreshHandled,
      refreshStatus,
      loginRequired,
      result,
      pageMode: location.hostname === "www.educoder.net" ? "educoder" : "tg"
    });

    return `
      <div class="tg2-refresh-status ${presentation.statusClass}">
        <div class="tg2-refresh-line">
          <span>${escapeHtml(presentation.title)}</span>
          <span>${presentation.barPercent}%</span>
        </div>
        <div class="tg2-refresh-detail">${escapeHtml(presentation.stage)}</div>
        <div class="tg2-progress" aria-hidden="true">
          <span style="width:${presentation.barPercent}%"></span>
        </div>
      </div>
    `;
  }

  function appendLog(text) {
    const boxWrap = document.querySelector(`#${DRAWER_ID} .tg2-json-container`);
    const box = document.querySelector(`#${DRAWER_ID} .tg2-json-box`);
    if (!boxWrap || !box) return;

    const line = `[${new Date().toLocaleString()}] ${text}`;
    box.value = box.value ? `${box.value}\n${line}` : line;
    boxWrap.style.display = "block";
  }

  function writeOutput(text) {
    const boxWrap = document.querySelector(`#${DRAWER_ID} .tg2-json-container`);
    const box = document.querySelector(`#${DRAWER_ID} .tg2-json-box`);
    if (!boxWrap || !box) return;

    box.value = text;
    boxWrap.style.display = "block";
  }

  function parseCourseIdFromCurrentUrl() {
    const match = location.href.match(/\/classrooms\/([^/?#]+)/);
    return match && match[1] ? decodeURIComponent(match[1]) : "";
  }

  function parseLoginFromCurrentUrl() {
    const userMatch = location.href.match(/\/users\/([^/?#]+)/);
    if (userMatch && userMatch[1]) return decodeURIComponent(userMatch[1]);

    const zzudMatch = location.href.match(/[?&]zzud=([^&]+)/);
    if (zzudMatch && zzudMatch[1]) return decodeURIComponent(zzudMatch[1]);

    const usernameMatch = location.href.match(/[?&]username=([^&]+)/);
    if (usernameMatch && usernameMatch[1]) return decodeURIComponent(usernameMatch[1]);

    return "";
  }

  function resolveJumpCourseId(task) {
    const direct = task?.courseIdentifier || task?.course_id || task?.coursesId;
    if (direct) return String(direct);

    if (task?.courseId && !/^\d+$/.test(String(task.courseId))) {
      return String(task.courseId);
    }

    const raw = task?.raw || {};
    const rawCourse = raw.courseIdentifier || raw.course_identifier || raw.coursesId || raw.course_id;
    if (rawCourse && !/^\d+$/.test(String(rawCourse))) {
      return String(rawCourse);
    }

    return parseCourseIdFromCurrentUrl();
  }

  function resolveJumpLogin(task) {
    return String(
      task?.login ||
      task?.userLogin ||
      task?.raw?.user_login ||
      latestResultLogin ||
      parseLoginFromCurrentUrl() ||
      ""
    ).trim();
  }

  function getJumpType(task) {
    if (task?.taskType === "classroom_experiment") return "shixun_homework";
    if (task?.taskType === "exercise") return "exercise";
    if (task?.taskType === "common_homework") return "common_homework";
    return "";
  }

  function getJumpItem(task) {
    if (task?.taskType === "exercise") {
      return task?.raw?.exam || { id: task?.exerciseId || task?.id };
    }

    if (task?.taskType === "classroom_experiment" || task?.taskType === "common_homework") {
      return task?.raw || { homework_id: task?.homeworkId || task?.id };
    }

    return null;
  }

  function buildJumpUrl(type, courseId, item, login) {
    if (type === "shixun_homework") {
      if (!item || !item.homework_id) throw new Error("课堂实验缺少 homework_id");
      return `${location.origin}/classrooms/${encodeURIComponent(courseId)}/shixun_homework/${encodeURIComponent(item.homework_id)}/detail?tabs=1`;
    }

    if (type === "exercise") {
      if (!item || !item.id) throw new Error("考试缺少 id");
      if (!login) throw new Error("考试缺少 login");
      return `${location.origin}/classrooms/${encodeURIComponent(courseId)}/exercisenotice/${encodeURIComponent(item.id)}/users/${encodeURIComponent(login)}`;
    }

    if (type === "common_homework") {
      if (!item || !item.homework_id) throw new Error("图文作业缺少 homework_id");
      return `${location.origin}/classrooms/${encodeURIComponent(courseId)}/common_homework/${encodeURIComponent(item.homework_id)}/detail?tabs=0`;
    }

    throw new Error(`未知跳转类型：${type}`);
  }

  function buildTaskJumpUrl(task) {
    const type = getJumpType(task);
    const courseId = resolveJumpCourseId(task);
    const item = getJumpItem(task);
    const login = resolveJumpLogin(task);

    if (!courseId) throw new Error("缺少课程 ID");
    return buildJumpUrl(type, courseId, item, login);
  }

  function buildParentListUrl(task) {
    const type = getJumpType(task);
    const courseId = resolveJumpCourseId(task);
    if (!courseId) throw new Error("缺少课程 ID");
    if (type !== "exercise" && type !== "common_homework" && type !== "shixun_homework") return "";
    return `${location.origin}/classrooms/${encodeURIComponent(courseId)}/${type}`;
  }

  function getPendingTaskId(task, type) {
    const item = getJumpItem(task) || {};
    const value = type === "exercise"
      ? task?.exerciseId || task?.id || item.id
      : task?.homeworkId || task?.id || item.homework_id || item.id;
    return value == null ? "" : String(value);
  }

  function createPendingTaskNavigation(task, type) {
    const taskId = getPendingTaskId(task, type);
    const courseId = resolveJumpCourseId(task);
    if (!taskId || !courseId) throw new Error("任务缺少父列表定位信息");
    return {
      originHost: location.hostname,
      taskType: type,
      courseId: String(courseId),
      taskId,
      title: String(getTaskTitle(task) || "").trim(),
      createdAt: Date.now()
    };
  }

  async function savePendingTaskNavigation(task, type) {
    const pending = createPendingTaskNavigation(task, type);
    await setValue(STORE_KEY_PENDING_TASK_NAVIGATION, pending);
    console.info("[TG nav] pending-saved", {
      originHost: pending.originHost,
      courseId: pending.courseId,
      taskType: pending.taskType,
      taskId: pending.taskId,
      title: pending.title
    });
  }

  function getPendingRow(node) {
    return node?.closest?.('[class*="listItem"], [class*="listContainer"], [class*="homeworkItem"], li, article, [role="listitem"]') || node;
  }

  function findPendingTaskNode(pending, diagnostics = {}) {
    const path = location.pathname;
    const expectedSuffix = `/classrooms/${encodeURIComponent(pending.courseId)}/${pending.taskType}`;
    diagnostics.path = path;
    diagnostics.expectedPath = expectedSuffix;
    if (normalizeNavigationPath(path) !== normalizeNavigationPath(expectedSuffix)) return null;

    const id = String(pending.taskId);
    const idAttrs = ["data-id", "data-exercise-id", "data-exerciseid", "data-homework-id", "data-homeworkid"];
    for (const attr of idAttrs) {
      const matches = Array.from(document.querySelectorAll(`[${attr}]`));
      diagnostics.dataAttrMatches = (diagnostics.dataAttrMatches || 0) + matches.filter(el => String(el.getAttribute(attr)) === id).length;
      const match = matches.find(el => String(el.getAttribute(attr)) === id);
      if (match) return { node: getPendingRow(match), method: "DATA_ATTR" };
    }

    const hrefMatches = Array.from(document.querySelectorAll("a[href]")).filter(link => {
      try {
        return new URL(link.href, location.href).pathname.split("/").includes(id);
      } catch (_) {
        return false;
      }
    });
    diagnostics.hrefMatches = hrefMatches.length;
    if (hrefMatches[0]) return { node: getPendingRow(hrefMatches[0]), method: "HREF" };

    if (!pending.title) return null;
    const titleNode = Array.from(document.querySelectorAll("span, a, h1, h2, h3, p, div"))
      .find(el => el !== document.body && el.children.length < 3 && el.textContent.trim() === pending.title);
    diagnostics.titleMatches = titleNode ? 1 : 0;
    return titleNode ? { node: getPendingRow(titleNode), method: "TITLE" } : null;
  }

  function clearNavigationHighlights(nextNode) {
    document.querySelectorAll(".tg-task-assistant-navigation-highlight").forEach(node => {
      if (node !== nextNode) node.classList.remove("tg-task-assistant-navigation-highlight");
    });
  }

  function applyNavigationHighlight(node) {
    clearNavigationHighlights(node);
    const wasHighlighted = node.classList.contains("tg-task-assistant-navigation-highlight");
    if (!wasHighlighted) node.classList.add("tg-task-assistant-navigation-highlight");
    node.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
    return {
      count: document.querySelectorAll(".tg-task-assistant-navigation-highlight").length,
      applied: !wasHighlighted
    };
  }

  async function waitForPendingTask(pending) {
    const startedAt = Date.now();
    const diagnostics = { dataAttrMatches: 0, hrefMatches: 0, titleMatches: 0, attempts: 0 };
    const deadline = Math.min(Number(pending.createdAt) + 15000, Date.now() + 15000);

    return new Promise(resolve => {
      let observer = null;
      let timerId = null;
      let deadlineTimerId = null;
      let attemptInFlight = false;
      let settled = false;

      const cleanup = () => {
        observer?.disconnect();
        observer = null;
        if (timerId !== null) clearInterval(timerId);
        if (deadlineTimerId !== null) clearTimeout(deadlineTimerId);
        timerId = null;
        deadlineTimerId = null;
      };

      const finish = outcome => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve({
          ...outcome,
          diagnostics,
          elapsed: Date.now() - startedAt
        });
      };

      const attempt = async () => {
        if (settled || attemptInFlight) return;
        attemptInFlight = true;
        diagnostics.attempts += 1;
        try {
          const match = findPendingTaskNode(pending, diagnostics);
          if (match?.node?.isConnected) {
            finish({ match, highlight: applyNavigationHighlight(match.node) });
          } else if (Date.now() >= deadline) {
            finish({ match: null, highlight: null });
          }
        } finally {
          attemptInFlight = false;
        }
      };

      observer = new MutationObserver(() => { attempt(); });
      observer.observe(document.body || document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["href", "data-id", "data-exercise-id", "data-exerciseid", "data-homework-id", "data-homeworkid"]
      });
      timerId = setInterval(attempt, 400);
      deadlineTimerId = setTimeout(() => finish({ match: null, highlight: null }), Math.max(0, deadline - Date.now()));
      attempt();
    });
  }

  function pendingNavigationKey(pending) {
    return [pending?.originHost, pending?.courseId, pending?.taskType, pending?.taskId, pending?.createdAt].join("|");
  }

  function runSameParentNavigation(pending) {
    const key = pendingNavigationKey(pending);
    const active = sameParentNavigationFlights.get(key);
    if (active) return active;
    const promise = waitForPendingTask(pending)
      .finally(() => sameParentNavigationFlights.delete(key));
    sameParentNavigationFlights.set(key, promise);
    return promise;
  }

  async function resolvePendingTaskNavigationOnce() {
    let pending = null;
    try {
      pending = await getValue(STORE_KEY_PENDING_TASK_NAVIGATION, null);
    } catch (error) {
      console.warn("读取任务定位状态失败：", error);
      return;
    }
    if (!pending || pending.originHost !== location.hostname) return;

    const age = Date.now() - Number(pending.createdAt || 0);
    if (age < 0 || age > 15000) {
      await deleteValue(STORE_KEY_PENDING_TASK_NAVIGATION);
      return;
    }

    const key = pendingNavigationKey(pending);
    const expectedPath = `/classrooms/${encodeURIComponent(pending.courseId)}/${pending.taskType}`;
    console.info("[TG nav] resolver-start", {
      path: location.pathname,
      pendingAge: age,
      key
    });
    const outcome = await waitForPendingTask(pending);
    if (outcome.match) {
      console.info("[TG nav] target-found", {
        method: outcome.match.method,
        elapsed: outcome.elapsed,
        taskId: pending.taskId,
        tag: outcome.match.node.tagName,
        className: String(outcome.match.node.className || "").slice(0, 160)
      });
      console.info("[TG nav] highlight-applied", { count: outcome.highlight.count, elapsed: outcome.elapsed });
      await deleteValue(STORE_KEY_PENDING_TASK_NAVIGATION);
      console.info("[TG nav] resolver-success", { elapsed: outcome.elapsed });
      return;
    }
    await deleteValue(STORE_KEY_PENDING_TASK_NAVIGATION);
    console.warn("[TG nav] resolver-timeout", {
      path: location.pathname,
      expectedPath,
      courseId: pending.courseId,
      taskType: pending.taskType,
      taskId: pending.taskId,
      title: pending.title,
      elapsed: outcome.elapsed,
      attempts: outcome.diagnostics.attempts,
      dataAttrMatches: outcome.diagnostics.dataAttrMatches,
      hrefMatches: outcome.diagnostics.hrefMatches,
      titleMatches: outcome.diagnostics.titleMatches
    });
  }

  function resolvePendingTaskNavigation() {
    if (pendingNavigationResolvePromise) return pendingNavigationResolvePromise;
    pendingNavigationResolvePromise = resolvePendingTaskNavigationOnce()
      .catch(error => console.warn("任务父列表定位失败：", error))
      .finally(() => {
        pendingNavigationResolvePromise = null;
      });
    return pendingNavigationResolvePromise;
  }

  function jumpToTask(task) {
    try {
      const type = getJumpType(task);
      if (type === "exercise" || type === "common_homework" || type === "shixun_homework") {
        const url = buildParentListUrl(task);
        const targetPath = normalizeNavigationPath(new URL(url, location.href).pathname);
        const currentPath = normalizeNavigationPath(location.pathname);
        if (currentPath === targetPath) {
          const pending = createPendingTaskNavigation(task, type);
          console.info("[TG nav] same-parent-start", {
            currentPath,
            targetPath,
            taskType: pending.taskType,
            taskId: pending.taskId
          });
          runSameParentNavigation(pending).then(outcome => {
            if (outcome.match) {
              console.info("[TG nav] same-parent-success", { method: outcome.match.method, elapsed: outcome.elapsed, taskId: pending.taskId });
            } else {
              console.warn("[TG nav] same-parent-timeout", {
                currentPath,
                targetPath,
                taskType: pending.taskType,
                taskId: pending.taskId,
                title: pending.title,
                elapsed: outcome.elapsed,
                attempts: outcome.diagnostics.attempts
              });
            }
          }).catch(error => console.warn("[TG nav] same-parent-timeout", { taskId: pending.taskId, error: error?.message || String(error) }));
          return;
        }
        savePendingTaskNavigation(task, type)
          .then(() => {
            writeOutput(url);
            window.location.assign(url);
          })
          .catch(err => {
            console.error("任务父列表跳转失败：", err, task);
            alert(`跳转失败：${err.message}`);
          });
        return;
      }

      const url = task?.detailUrl || buildTaskJumpUrl(task);
      writeOutput(url);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).catch(() => {});
      }
      window.open(url, "_blank");
    } catch (err) {
      console.error("跳转失败：", err, task);
      alert(`跳转失败：${err.message}`);
    }
  }

  function getTaskTitle(task) {
    return task.title || task.name || task.exerciseName || task.homeworkName || task.experimentName || task.homeworkTitle || "未命名任务";
  }

  function getTaskTypeLabel(task) {
    if (task.taskType === "exercise") return "考试 / 小测试";
    if (task.taskType === "common_homework") return "图文作业";
    if (task.taskType === "classroom_experiment") return "课堂实验";
    return task.taskTypeText || "任务";
  }

  function renderDetailLink(task) {
    const id = `task-${jumpTaskSeq++}`;
    jumpTaskRegistry.set(id, task);
    return `<button class="tg2-row-button" type="button" data-action="open-detail" data-jump-id="${escapeHtml(id)}" title="打开任务">进入</button>`;
  }

  function renderTaskActionButton(task, taskKey) {
    if (task?.__ignoredView) {
      return `<button class="tg2-row-button" type="button" data-action="restore-task" data-task-key="${escapeHtml(taskKey)}" title="恢复任务">恢复</button>`;
    }

    return `<button class="tg2-row-button tg2-danger-action" type="button" data-action="ignore-task" data-task-key="${escapeHtml(taskKey)}" title="忽略任务" aria-label="忽略任务">忽略</button>`;
  }

  function renderExerciseMeta(task) {
    if (task?.taskType !== "exercise") return "";

    const items = [];
    const usedAttempts = Number(task?.usedAttempts);
    const maxAttempts = Number(task?.maxAttempts);
    const hasAttemptInfo = Number.isFinite(usedAttempts) && Number.isFinite(maxAttempts) && maxAttempts > 0;
    const scoreText = task?.scoreText ?? task?.score;
    const totalScoreText = task?.totalScoreText ?? task?.totalScore;
    const hasScore = scoreText !== undefined && scoreText !== null && String(scoreText).trim() !== "" && String(scoreText).trim() !== "--";
    const hasTotalScore = totalScoreText !== undefined && totalScoreText !== null && String(totalScoreText).trim() !== "";

    if (hasAttemptInfo) {
      items.push(`<span>已考次数：${escapeHtml(String(usedAttempts))} / ${escapeHtml(String(maxAttempts))}</span>`);
    }

    if (hasScore || hasTotalScore) {
      items.push(`<span>成绩：${escapeHtml(hasScore ? String(scoreText) : "--")} / ${escapeHtml(hasTotalScore ? String(totalScoreText) : "--")}</span>`);
    }

    if (task?.exerciseLeftTime) {
      items.push(`<span>剩余时间：${escapeHtml(String(task.exerciseLeftTime))}</span>`);
    }

    return items.join("");
  }

  function renderTaskCard(task) {
    const taskKey = getTaskKey(task);
    latestTaskRegistry.set(taskKey, task);
    const tone = statusTone(task);
    const status = task.examStatusLabel || task.submitStatusText || task.statusText || task.commitStatusText || (task.completed ? "已完成" : "未完成");
    const deadline = getTaskDeadlineLabel(task);
    const siteLine = `${task.courseName || "未识别课程"} · ${getTaskTypeLabel(task)} · ${getTaskSiteName(task)}`;
    const countdownText = formatCountdown(deadline);
    const ignoredBadge = task?.__ignoredView
      ? `<span class="tg-ignored-flag">${task.__snapshotOnly ? "已忽略 / 未匹配" : "已忽略"}</span>`
      : "";
    const snapshotNote = task?.__snapshotOnly
      ? `<div class="tg-card-note">当前扫描未匹配到源任务</div>`
      : "";

    if (!hasLoggedDeadlineSample) {
      console.log("[TG倒计时] deadline field=", deadline, "task=", task);
      console.log("[TG忽略机制] taskKey=", taskKey, task.title || task.name);
      hasLoggedDeadlineSample = true;
    }

    const deadlineTone = task.completed ? "tg2-ok" : tone.card === "tg-state-bad" ? "tg2-bad" : "";
    return `
      <article class="tg2-task-row ${tone.card} ${task?.__ignoredView ? "tg2-ignored" : ""}" data-task-key="${escapeHtml(taskKey)}">
        <div class="tg2-task-main">
          <div class="tg2-task-deadline ${deadlineTone}"><span class="tg2-deadline-dot"></span><span data-deadline="${escapeHtml(deadline)}">${escapeHtml(countdownText)}</span></div>
          <div class="tg2-task-title">${escapeHtml(getTaskTitle(task))}</div>
          <div class="tg2-task-context">${escapeHtml(siteLine)}</div>
          <div class="tg2-task-status">${escapeHtml(status)}${task?.__snapshotOnly ? " · 当前扫描未匹配源任务" : ""}</div>
          ${ignoredBadge ? `<div class="tg2-ignored-label">${ignoredBadge.replace(/<[^>]+>/g, "")}</div>` : ""}
        </div>
        <div class="tg2-task-actions">${renderDetailLink(task)}${renderTaskActionButton(task, taskKey)}</div>
      </article>
    `;
  }

  function renderTaskList(tasks) {
    return tasks.map(renderTaskCard).join("");
  }

  function renderSection(title, tasks, className = "") {
    if (!tasks.length) return "";
    return `
      <section class="tg2-section ${className}">
        <div class="tg2-view-caption"><span class="tg2-view-title">${escapeHtml(title)}</span><span class="tg2-view-count">${tasks.length} 项</span></div>
        <div class="tg2-task-list">${renderTaskList(tasks)}</div>
      </section>
    `;
  }

  function renderCourseSubgroup(groupKey, typeKey, title, tasks, sectionCollapseState) {
    if (!tasks.length) return "";
    const key = `${groupKey}:${typeKey}`;
    const collapsed = sectionCollapseState[key] === true;
    return `
      <div class="tg-course-subgroup ${collapsed ? "tg-section-collapsed" : ""}" data-section-key="${escapeHtml(key)}">
        <div class="tg-subgroup-title" data-section-toggle>
          <span class="tg-subgroup-title-main">${escapeHtml(title)}</span>
          <span class="tg-subgroup-count">${tasks.length}</span>
        </div>
        <div class="tg-subgroup-content"><div class="tg-subgroup-content-inner">${renderTaskList(tasks)}</div></div>
      </div>
    `;
  }

  function renderCourseGroups(groups, courseCollapseState, pinnedCourses) {
    const sorted = groups.slice().sort((a, b) => {
      const pinDelta = Number(Boolean(pinnedCourses?.[b.key])) - Number(Boolean(pinnedCourses?.[a.key]));
      if (pinDelta) return pinDelta;
      return String(a.courseName || "").localeCompare(String(b.courseName || ""), "zh-CN");
    });
    return sorted.map(group => {
      const collapsed = courseCollapseState[group.key] === true;
      const activeCount = group.tasks?.filter(task => !task.completed).length || 0;
      const dangerCount = group.tasks?.filter(isDangerTask).length || 0;
      const pinned = Boolean(pinnedCourses?.[group.key]);
      const tasks = sortTasks(group.tasks || []);
      return `
        <section class="tg2-course-group ${collapsed ? "tg2-collapsed" : ""}" data-course-key="${escapeHtml(group.key)}">
          <div class="tg2-course-head">
            <div class="tg2-course-name">${pinned ? `<span class="tg2-pin" aria-label="已置顶">★</span> ` : ""}${escapeHtml(group.courseName || "未识别课程")}<div class="tg2-course-stats">${activeCount} 未完成 · ${dangerCount} 紧急 · ${escapeHtml(group.siteName || getCurrentPageSite().siteName)}</div></div>
            <button class="tg2-row-button" type="button" data-course-pin="${escapeHtml(group.key)}" title="${pinned ? "取消置顶" : "置顶课程"}">${pinned ? "取消置顶" : "置顶"}</button>
            <button class="tg2-row-button" type="button" data-action="toggle-course" title="${collapsed ? "展开" : "收起"}">${collapsed ? "+" : "−"}</button>
          </div>
          <div class="tg2-course-tasks">
            ${tasks.map(task => {
              const id = `course-task-${jumpTaskSeq++}`;
              jumpTaskRegistry.set(id, task);
              return `<div class="tg2-course-task"><span class="tg2-course-task-title">${escapeHtml(getTaskTitle(task))}</span><span class="tg2-course-task-meta">${escapeHtml(formatCountdown(getTaskDeadlineLabel(task)))}</span><button class="tg2-row-button" type="button" data-action="open-detail" data-jump-id="${escapeHtml(id)}">进入</button></div>`;
            }).join("")}
          </div>
        </section>
      `;
    }).join("");
  }

  async function render() {
    createRoot();
    logInitialHydrationCheckpoint("01 shell-created");
    const body = document.querySelector(`#${DRAWER_ID} .tg2-body`);
    if (!body) return;

    try {
      await withInitialHydrationTimeout(renderPanelContent(body));
      resolvePendingTaskNavigation().catch(error => console.warn("任务父列表定位失败：", error));
      updateLatencyButton();
      scheduleAdaptiveBackdropDetection("render-complete");
      maybeRunInitialLatencyTest();
      scheduleAdaptiveBackdropDetection("render-complete");
      if (isOpen()) {
        maybeTriggerAutoRefreshOnce().catch(err => {
          console.error("TG任务助手自动刷新判断失败", err);
        });
      }
    } catch (err) {
      logInitialHydrationCheckpoint("initialization-error", {
        error: err?.message || String(err)
      });
      initialHydrationTraceActive = false;
      console.error("TG任务助手渲染失败", err);
      body.innerHTML = `<div class="tg-alert">前台面板渲染失败：${escapeHtml(cleanStatusMessage(err?.message || String(err)))}</div>`;
    }
  }

  async function renderPanelContentLegacy(body) {
    jumpTaskRegistry = new Map();
    jumpTaskSeq = 0;
    latestTaskRegistry = new Map();
    const state = await loadFrontendState();
    const data = state.result;
    const runningState = state.lastRunning;
    const lastError = state.lastError;
    const refreshRequest = state.refreshRequest;
    const refreshHandled = state.refreshHandled;
    const refreshStatus = state.refreshStatus;
    const currentPageSite = getCurrentPageSite();
    const isRunning = runningState?.running === true || refreshStatus?.status === "running";
    const currentRefreshRunning = refreshStatus?.status === "running";
    const currentRefreshError = refreshStatus?.status === "error";
    const failedSiteLogins = Array.isArray(data?.debug?.siteLogin)
      ? data.debug.siteLogin.filter(item => item && item.ok === false)
      : [];
    const loginRequired = refreshStatus?.errorKind === "login_required" ||
      lastError?.errorKind === "login_required";
    const refreshStatusHtml = renderRefreshStatus(runningState, lastError, refreshRequest, refreshHandled, refreshStatus, loginRequired);

    if (loginRequired) {
      updateFloatingBadge({ dangerCount: 0, unfinishedCount: 0 });
      body.innerHTML = `${refreshStatusHtml}<div class="tg-alert"><strong>${escapeHtml(currentPageSite.siteName)} 未登录</strong><br>请先登录 TG，登录后点击刷新。</div><div class="tg-json-container" style="display:none;"><textarea class="tg-json-box" readonly></textarea></div>`;
      return;
    }

    if (isRunning && !data) {
      updateFloatingBadge({ dangerCount: 0, unfinishedCount: 0 });
      body.innerHTML = `${refreshStatusHtml}<div class="tg-empty">后台正在运行<br>当前阶段：${escapeHtml(cleanStatusMessage(refreshStatus?.message || runningState?.stageText || "正在刷新"))}</div><div class="tg-json-container" style="display:none;"><textarea class="tg-json-box" readonly></textarea></div>`;
      return;
    }

    if (!data && loginRequired) {
      updateFloatingBadge({ dangerCount: 0, unfinishedCount: 0 });
      body.innerHTML = `${refreshStatusHtml}<div class="tg-alert">TG 未登录，请先登录后刷新</div><div class="tg-json-container" style="display:none;"><textarea class="tg-json-box" readonly></textarea></div>`;
      return;
    }

    if (!data && currentRefreshError) {
      updateFloatingBadge({ dangerCount: 0, unfinishedCount: 0 });
      body.innerHTML = `${refreshStatusHtml}<div class="tg-alert">最近刷新失败<br>错误：${escapeHtml(cleanStatusMessage(refreshStatus?.error || refreshStatus?.message || "未知错误"))}</div><div class="tg-json-container" style="display:none;"><textarea class="tg-json-box" readonly></textarea></div>`;
      return;
    }

    if (!data && lastError?.message && !currentRefreshRunning) {
      updateFloatingBadge({ dangerCount: 0, unfinishedCount: 0 });
      body.innerHTML = `${refreshStatusHtml}<div class="tg-alert">上次后台错误：${escapeHtml(cleanStatusMessage(lastError.message))}<br>时间：${escapeHtml(lastError.time || "--")}</div><div class="tg-json-container" style="display:none;"><textarea class="tg-json-box" readonly></textarea></div>`;
      return;
    }

    if (!data) {
      updateFloatingBadge({ dangerCount: 0, unfinishedCount: 0 });
      const emptyText = currentPageSite.siteKey === "educoder"
        ? "当前为头歌公网视图，暂无本平台缓存。请点击“请求刷新”获取任务状态。"
        : `当前为${currentPageSite.siteName}视图，暂无本平台缓存。请点击“请求刷新”获取任务状态。`;
      body.innerHTML = `${refreshStatusHtml}${cacheDeletedNotice ? `<div class="tg-empty">${escapeHtml(cacheDeletedNotice)}</div>` : ""}<div class="tg-empty">${escapeHtml(emptyText)}</div><div class="tg-json-container" style="display:none;"><textarea class="tg-json-box" readonly></textarea></div>`;
      return;
    }

    const manualLogin = String(MANUAL_LOGIN || "").trim();
    const autoLogin = state.autoLogin;
    const expectedLogin = currentPageSite.login || manualLogin || autoLogin;
    const resultLogin = String(data?.login || "").trim();
    latestResultLogin = resultLogin;
    const accountText = expectedLogin || "未识别";
    const accountSource = currentPageSite.login ? currentPageSite.siteName : manualLogin ? "手动配置" : autoLogin ? "自动识别" : "未识别";
    let accountWarningHtml = "";

    if (!isResultForCurrentSite(data)) {
      updateFloatingBadge({ dangerCount: 0, unfinishedCount: 0 });
      body.innerHTML = `<div class="tg-empty">当前缓存数据属于另一个账号，请重新运行后台扫描。</div>`;
      return;
    }

    if (!expectedLogin) {
      accountWarningHtml = `<div class="tg-alert">账号：未识别<br>提示：请先打开 TG 页面，或在后台脚本顶部填写 MANUAL_LOGIN。</div>`;
    }

    const filterYearMonth = state.filterYearMonth;
    const courseCollapseState = state.courseCollapse;
    const sectionCollapseState = state.sectionCollapse;
    const viewModel = buildViewModel(data, state);
    const summary = viewModel.stats;
    updateFloatingBadge(summary);

    const errors = data.errors || [];
    const warnings = data.warnings || [];
    const filter = state.currentFilter;
    const filteredTasks = viewModel.visibleTasks;
    const dangerTasks = viewModel.dangerTasks;
    const dangerList = filter === "danger" ? filteredTasks : dangerTasks;
    const ignoredTasks = viewModel.ignoredDisplayTasks;
    requestDangerNotification(dangerList, data);

    let html = accountWarningHtml + refreshStatusHtml;

    if (isRunning) {
      html += `<div class="tg-empty">后台正在运行<br>当前阶段：${escapeHtml(cleanStatusMessage(refreshStatus?.message || runningState?.stageText || "正在刷新"))}</div>`;
    } else if (currentRefreshError) {
      html += `<div class="tg-alert">最近刷新失败<br>错误：${escapeHtml(cleanStatusMessage(refreshStatus?.error || refreshStatus?.message || "未知错误"))}</div>`;
    } else if (lastError && lastError.message && !currentRefreshRunning) {
      html += `<div class="tg-alert">上次后台错误：${escapeHtml(cleanStatusMessage(lastError.message))}<br>时间：${escapeHtml(lastError.time || "--")}</div>`;
    }

    if (failedSiteLogins.length && !loginRequired) {
      html += failedSiteLogins.map(item => {
        const siteName = item.siteName || "站点";
        const loginUrl = item.siteKey === "educoder" ? "https://www.educoder.net" : getCurrentPageSite().pageOrigin;
        return `<div class="tg-alert">${escapeHtml(siteName)}未登录或登录态失效，请先打开 ${escapeHtml(loginUrl)} 并登录后重新刷新。<br>原因：${escapeHtml(cleanStatusMessage(item.error || "登录态预检失败"))}</div>`;
      }).join("");
    }

    html += `
      <div class="tg-current-filter">${escapeHtml(currentPageSite.viewHint)}</div>

      <div class="tg-meta">
        <div class="tg-meta-kicker">任务状态总览 / 实时监控</div>
        <div class="tg-meta-grid">
          <div class="tg-meta-chip"><span class="tg-meta-label">当前账号</span><span class="tg-meta-value">${escapeHtml(accountText)}</span></div>
          <div class="tg-meta-chip"><span class="tg-meta-label">账号来源</span><span class="tg-meta-value">${escapeHtml(accountSource)}</span></div>
          <div class="tg-meta-chip"><span class="tg-meta-label">上次扫描</span><span class="tg-meta-value">${escapeHtml(data.scanTime || "--")}</span></div>
        </div>
      </div>

      <div class="tg-summary">
        ${renderSummaryCard("ignored", `<div class="tg-summary-num">${summary.ignoredCount || 0}</div>`, "忽略", filter)}
        ${renderSummaryCard("all", `<div class="tg-summary-num">${summary.taskCount}</div>`, "总任务", filter)}
        ${renderSummaryCard("exercise", `<div class="tg-summary-num tg-muted">${summary.exerciseCount}</div>`, "考试", filter)}
        ${renderSummaryCard("common_homework", `<div class="tg-summary-num tg-ok">${summary.homeworkCount}</div>`, "图文", filter)}
        ${renderSummaryCard("classroom_experiment", `<div class="tg-summary-num tg-muted">${summary.experimentCount}</div>`, "实验", filter)}
        ${renderSummaryCard("danger", `<div class="tg-summary-num tg-warn">${summary.dangerCount}</div>`, "危险", filter)}
      </div>

      ${filter !== "all" ? `<div class="tg-current-filter">正在查看：<strong>${escapeHtml(getFilterLabel(filter))}</strong></div>` : ""}
    `;

    if (filter === "all" && dangerList.length) {
      html += `<div class="tg-alert">危险提醒：发现 ${dangerList.length} 个 10 天内截止的未完成任务，请优先处理。</div>`;
      html += renderSection("紧急任务", dangerList, "tg-section-urgent");
    }

    if (!filteredTasks.length) {
      html += `<div class="tg-empty">当前筛选下没有任务。</div>`;
    } else if (filter === "danger") {
      html += renderSection("危险任务", filteredTasks, "tg-section-urgent");
    } else if (filter === "ignored") {
      html += renderSection("已忽略任务", ignoredTasks);
    } else {
      html += renderCourseGroups(viewModel.courseGroups, courseCollapseState, sectionCollapseState);
    }

    if (errors.length || warnings.length) {
      html += `<div class="tg-alert">本次扫描：${errors.length} 个错误，${warnings.length} 个提醒。<br>需要排查时可以复制全部 JSON。</div>`;
    }

    html += `<div class="tg-json-container" style="display:none;"><textarea class="tg-json-box" readonly></textarea></div>`;
    body.innerHTML = html;

    updateCountdowns();
    ensureCountdownTimer();
    latestRenderedScanTimestamp = Number(data.scanTimestamp) || latestRenderedScanTimestamp;
  }
  function renderLauncherMenu(state) {
    const settings = normalizeLauncherSettings(state?.launcherSettings);
    const shortcutText = shortcutCaptureActive ? "录制中…" : formatShortcut(state?.shortcut);
    const semesterSettings = normalizeSemesterSettings(state?.semesterSettings);
    const semester = deriveCurrentSemester(semesterSettings);
    const monthOptions = month => Array.from({ length: 12 }, (_, i) => i + 1)
      .map(value => `<option value="${value}" ${value === month ? "selected" : ""}>${value} 月</option>`).join("");
    return `
      <div class="tg2-menu-section">快捷操作</div>
      <button class="tg2-menu-item" type="button" data-action="open-ignored"><span>已忽略任务</span><span>${Object.keys(state?.ignoredTaskMap || {}).length}</span></button>
      <div class="tg2-menu-divider"></div>
      <div class="tg2-menu-section">显示</div>
      <label class="tg2-menu-control"><span>视觉效果</span><select data-visual-mode><option value="auto" ${settings.visualMode === "auto" ? "selected" : ""}>Auto</option><option value="high" ${settings.visualMode === "high" ? "selected" : ""}>High Quality</option><option value="energy" ${settings.visualMode === "energy" ? "selected" : ""}>Energy Saving</option><option value="static" ${settings.visualMode === "static" ? "selected" : ""}>Static / Off</option></select></label>
      <label class="tg2-menu-control"><span>首页默认展开<small>打开 TG / 头歌首页时自动展开任务助手</small></span><input type="checkbox" data-auto-open-home ${state?.autoOpenSettings?.home !== false ? "checked" : ""}></label>
      <label class="tg2-menu-control"><span>其他页面默认展开<small>课程、作业、考试、实验页面自动展开</small></span><input type="checkbox" data-auto-open-other ${state?.autoOpenSettings?.other === true ? "checked" : ""}></label>
      <button class="tg2-menu-item" type="button" data-action="toggle-panel-lock">${settings.locked ? "解锁面板位置" : "锁定面板位置"}<span>${settings.locked ? "已锁定" : "可拖动"}</span></button>
      <button class="tg2-menu-item" type="button" data-action="reset-panel-layout"><span>重置面板位置与大小</span><span>恢复默认</span></button>
      <div class="tg2-menu-divider"></div>
      <div class="tg2-menu-section">任务</div>
      <button class="tg2-menu-item" type="button" data-action="open-ignored"><span>忽略任务</span><span>管理</span></button>
      <div class="tg2-menu-divider"></div>
      <div class="tg2-menu-section">学期</div>
      <label class="tg2-menu-control"><span>上学期开始月份</span><select data-semester-upper aria-label="上学期开始月份">${monthOptions(semesterSettings.upperSemesterStartMonth)}</select></label>
      <label class="tg2-menu-control"><span>下学期开始月份</span><select data-semester-lower aria-label="下学期开始月份">${monthOptions(semesterSettings.lowerSemesterStartMonth)}</select></label>
      <div class="tg2-menu-note">当前判断：${escapeHtml(`${semester.academicYearText} ${semester.termText}`)}。两个月份必须不同。</div>
      <button class="tg2-menu-item" type="button" data-action="reset-semester-settings"><span>恢复默认</span><span>8 月 / 3 月</span></button>
      <div class="tg2-menu-divider"></div>
      <div class="tg2-menu-section">快捷键</div>
      <div class="tg2-shortcut-state" data-shortcut-state>当前：${escapeHtml(shortcutText)}</div>
      <button class="tg2-menu-item" type="button" data-action="record-shortcut">${shortcutCaptureActive ? "等待按键…" : "重新设置"}</button>
      <button class="tg2-menu-item" type="button" data-action="clear-shortcut">清除快捷键</button>
      <div class="tg2-menu-divider"></div>
      <button class="tg2-menu-item" type="button" data-action="copy-json">复制全部 JSON</button>
      <button class="tg2-menu-item" type="button" data-action="clear-local-data">清除本地缓存</button>
    `;
  }

  function updateViewTabs(filter) {
    const root = document.getElementById(ROOT_ID);
    root?.querySelectorAll("[data-view]").forEach(tab => {
      const selected = tab.dataset.view === filter;
      tab.classList.toggle("tg2-selected", selected);
      tab.setAttribute("aria-selected", selected ? "true" : "false");
    });
  }

  async function renderPanelContent(body) {
    jumpTaskRegistry = new Map();
    jumpTaskSeq = 0;
    latestTaskRegistry = new Map();
    const state = await loadFrontendState();
    const data = state.result;
    const runningState = state.lastRunning;
    const lastError = state.lastError;
    const refreshRequest = state.refreshRequest;
    const refreshHandled = state.refreshHandled;
    const refreshStatus = state.refreshStatus;
    const currentPageSite = getCurrentPageSite();
    const loginRequired = refreshStatus?.errorKind === "login_required" || lastError?.errorKind === "login_required";
    const presentation = deriveRefreshPresentation({
      runningState,
      lastError,
      refreshRequest,
      refreshHandled,
      refreshStatus,
      loginRequired,
      result: data,
      pageMode: currentPageSite.siteKey === "educoder" ? "educoder" : "tg"
    });
    const isRunning = presentation.isRunning;
    const currentRefreshError = refreshStatus?.status === "error" && presentation.hasCurrentTerminalStatus;
    logInitialHydrationCheckpoint("06 viewmodel-input-ready");
    logRefreshDebugState({ state, result: data, presentation });
    if (!latestLatencyState) latestLatencyState = await getValue(STORE_KEY_LATENCY, null);
    const menu = document.querySelector(`#${DRAWER_ID} [data-menu]`);
    if (menu) menu.innerHTML = renderLauncherMenu(state);
    updateShortcutMenu();
    updateViewTabs(state.currentFilter);
    updateConnectionStatus(data, refreshStatus, lastError, loginRequired);

    if (loginRequired) {
      updateFloatingBadge({ dangerCount: 0, unfinishedCount: 0 });
      body.innerHTML = `${renderRefreshStatus(runningState, lastError, refreshRequest, refreshHandled, refreshStatus, true, data)}<div class="tg2-alert"><strong>${escapeHtml(currentPageSite.siteName)} 未登录</strong><br>请先登录 TG，登录后点击刷新。</div>`;
      logInitialHydrationCheckpoint("07 render-start");
      logInitialHydrationCheckpoint("08 render-done");
      initialHydrationTraceActive = false;
      return;
    }

    if (!data) {
      updateFloatingBadge({ dangerCount: 0 });
      body.innerHTML = `${renderRefreshStatus(runningState, lastError, refreshRequest, refreshHandled, refreshStatus, loginRequired, data)}${loginRequired ? `<div class="tg2-alert"><strong>${escapeHtml(currentPageSite.siteName)} 未登录</strong><br>请先登录当前站点，再点击刷新。</div>` : isRunning ? `<div class="tg2-empty"><strong>后台正在处理</strong><br>${escapeHtml(cleanStatusMessage(refreshStatus?.message || runningState?.stageText || "正在刷新任务"))}</div>` : currentRefreshError ? `<div class="tg2-alert"><strong>最近刷新失败</strong><br>${escapeHtml(cleanStatusMessage(refreshStatus?.error || refreshStatus?.message || "未知错误"))}</div>` : `<div class="tg2-empty"><strong>还没有任务数据</strong><br>点击右上角“刷新”获取 ${escapeHtml(currentPageSite.siteName)} 的任务。</div>`}`;
      logInitialHydrationCheckpoint("07 render-start");
      logInitialHydrationCheckpoint("08 render-done");
      initialHydrationTraceActive = false;
      return;
    }

    if (!isResultForCurrentSite(data)) {
      updateFloatingBadge({ dangerCount: 0 });
      body.innerHTML = `<div class="tg2-alert"><strong>数据来源不匹配</strong><br>当前缓存属于其他站点或账号，请重新刷新。</div>`;
      logInitialHydrationCheckpoint("07 render-start");
      logInitialHydrationCheckpoint("08 render-done");
      initialHydrationTraceActive = false;
      return;
    }

    latestResultLogin = String(data?.login || "").trim();

    const viewModel = buildViewModel(data, state);
    logInitialHydrationCheckpoint("06 viewmodel-built");
    const filter = state.currentFilter;
    const courseFocus = localStorage.getItem(COURSE_FOCUS_KEY) || "";
    const tasks = filter === "danger"
      ? viewModel.dangerTasks
      : filter === "completed"
        ? viewModel.activeTasks.filter(task => task.completed)
        : ["exercise", "common_homework", "classroom_experiment"].includes(filter)
          ? viewModel.activeTasks.filter(task => taskMatchesFilter(task, filter))
        : filter === "ignored"
          ? viewModel.ignoredDisplayTasks
          : filter === "course" && courseFocus
            ? viewModel.activeTasks.filter(task => getCourseKey(task) === courseFocus)
            : viewModel.activeTasks;
    const summary = viewModel.stats;
    updateFloatingBadge(summary);
    const failedSiteLogins = Array.isArray(data?.debug?.siteLogin) ? data.debug.siteLogin.filter(item => item && item.ok === false) : [];
    const statusHtml = renderRefreshStatus(runningState, lastError, refreshRequest, refreshHandled, refreshStatus, loginRequired, data);
    const errors = data.errors || [];
    const warnings = data.warnings || [];
    const viewTitle = filter === "danger" ? "现在最急的任务" : filter === "completed" ? "已完成" : filter === "ignored" ? "已忽略任务" : filter === "course" ? (courseFocus ? "课程任务" : "课程总览") : "全部待办";
    let html = `
      ${statusHtml}
      ${failedSiteLogins.length ? `<div class="tg2-alert">${failedSiteLogins.map(item => `${escapeHtml(item.siteName || "站点")} 登录态失效`).join("；")}</div>` : ""}
      <div class="tg2-summary">
        <button class="tg2-summary-item" type="button" data-view="all"><div class="tg2-summary-number">${summary.unfinishedCount}</div><div class="tg2-summary-label">待办</div></button>
        <button class="tg2-summary-item tg2-urgent" type="button" data-view="danger"><div class="tg2-summary-number">${summary.dangerCount}</div><div class="tg2-summary-label">紧急</div></button>
        <button class="tg2-summary-item tg2-exam" type="button" data-view="exercise"><div class="tg2-summary-number">${summary.exerciseCount}</div><div class="tg2-summary-label">考试</div></button>
      </div>
      <div class="tg2-view-caption"><span class="tg2-view-title">${escapeHtml(viewTitle)}</span><span class="tg2-view-count">${filter === "ignored" ? viewModel.ignoredDisplayTasks.length : tasks.length} 项</span></div>
    `;

    if (filter === "course") {
      const groups = groupTasksByCourseAndType(courseFocus ? tasks : viewModel.activeTasks);
      html += groups.length ? `<div class="tg2-course-list">${renderCourseGroups(groups, state.courseCollapse, state.pinnedCourses)}</div>` : `<div class="tg2-empty">暂无课程任务。</div>`;
    } else if (tasks.length) {
      html += `<div class="tg2-task-list">${renderTaskList(tasks)}</div>`;
    } else {
      html += `<div class="tg2-empty">${filter === "danger" ? "目前没有需要紧急处理的任务。" : filter === "completed" ? "还没有已完成任务。" : filter === "ignored" ? "没有已忽略任务。" : "当前筛选下没有任务。"}</div>`;
    }

    if (errors.length || warnings.length) html += `<div class="tg2-alert" style="margin-top:12px">本次扫描：${errors.length} 个错误，${warnings.length} 个提醒。需要排查时可从更多菜单复制 JSON。</div>`;
    html += `<div class="tg2-json-container" style="display:none"><textarea class="tg2-json-box" readonly></textarea></div>`;
    body.innerHTML = html;
    logInitialHydrationCheckpoint("07 render-start");
    updateViewTabs(filter);
    updateConnectionStatus(data, refreshStatus, lastError, loginRequired);
    updateCountdowns();
    ensureCountdownTimer();
    const footer = document.querySelector(`#${DRAWER_ID} [data-footer-summary]`);
    if (footer) footer.textContent = `${summary.courseCount || 0} 门课程 · ${summary.ignoredCount || 0} 已忽略`;
    latestRenderedScanTimestamp = Number(data.scanTimestamp) || latestRenderedScanTimestamp;
    logInitialHydrationCheckpoint("08 render-done");
    initialHydrationTraceActive = false;
  }

  async function getAllJsonText() {
    const state = await loadFrontendState();

    return JSON.stringify(
      {
        result: state.result,
        lastRunning: state.lastRunning,
        lastError: state.lastError,
        refreshRequest: state.refreshRequest,
        refreshHandled: state.refreshHandled,
        refreshStatus: state.refreshStatus,
        panelState: state.panelState,
        courseCollapse: state.courseCollapse,
        sectionCollapse: state.sectionCollapse,
        pinnedCourses: state.pinnedCourses,
        launcherSettings: state.launcherSettings,
        shortcut: state.shortcut,
        latency: latestLatencyState,
        copiedAt: new Date().toLocaleString(),
        pageUrl: location.href,
        pageMode: isOpen() ? "panel-open" : "button-only"
      },
      null,
      2
    );
  }

  async function copyAllJson() {
    const btn = document.querySelector("[data-copy-all-json]");
    const text = await getAllJsonText();

    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = "已复制";
      setTimeout(() => {
        btn.textContent = "复制 JSON";
      }, 1200);
    } catch (e) {
      showJsonBox(text);
      btn.textContent = "手动复制";
      setTimeout(() => {
        btn.textContent = "复制 JSON";
      }, 1500);
    }
  }

  function showJsonBox(text) {
    setDrawerOpen(true);

    const boxWrap = document.querySelector(`#${DRAWER_ID} .tg2-json-container`);
    const box = document.querySelector(`#${DRAWER_ID} .tg2-json-box`);
    if (!boxWrap || !box) return;

    box.value = text;
    boxWrap.style.display = boxWrap.style.display === "none" ? "block" : "none";
    box.focus();
    box.select();
  }

  window.__tgTaskAssistant = {
    render,
    loadData,
    loadRunningState,
    loadLastError
  };

  saveAutoLoginIfDetected();

  if (typeof GM_registerMenuCommand === "function") {
    GM_registerMenuCommand("显示/请求刷新 TG任务助手", () => {
      setDrawerOpen(true);
      render();
    });
  }

  window.addEventListener("resize", () => {
    clearTimeout(resizeApplyTimer);
    resizeApplyTimer = setTimeout(() => {
      applyPanelState();
      resetLauncherIdleTimer();
      scheduleAdaptiveBackdropDetection("window-resize");
    }, 120);
  });

  setTimeout(() => {
    initializePageOpenState()
      .then(() => {
        createRoot();
        return render();
      })
      .catch(error => {
        console.warn("[TG panel] initial-open failed", error);
        createRoot();
        render();
      });
  }, 1000);
})();




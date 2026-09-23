// ==UserScript==
// @name         TG任务状态后台扫描器
// @namespace    tg-task-monitor
// @version      3.4
// @updateURL    https://raw.githubusercontent.com/YuukiRitoTeng/browser-utilities/main/js/TG任务状态后台扫描器.js
// @downloadURL  https://raw.githubusercontent.com/YuukiRitoTeng/browser-utilities/main/js/TG任务状态后台扫描器.js
// @description  后台扫描 TG/Educoder 课堂考试、小测试和图文作业状态，并保存到共享存储
// @author       ChatGPT
// @background
// @match        https://tg.zcst.edu.cn/*
// @match        https://www.educoder.net/*
// @match        http://172.16.36.150/*
// @storageName  tg-exam-monitor-shared
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        GM_log
// @connect      tg.zcst.edu.cn
// @connect      data.educoder.net
// @connect      www.educoder.net
// @connect      172.16.36.150
// ==/UserScript==

/**
 * TG任务状态后台扫描器
 *
 * 功能：
 * 1. 后台请求所有正在进行的课堂
 * 2. 保留原考试 / 小测试 exercises 扫描逻辑
 * 3. 新增 common_homework 图文作业扫描逻辑
 * 4. 合并为 courses + tasks 统一结构并保存到共享存储
 *
 * 注意：
 * - 需要当前浏览器已经登录 tg.zcst.edu.cn
 * - 后台脚本依赖浏览器 Cookie 登录态
 * - 前台面板脚本通过相同 @storageName 读取结果
 */

const MANUAL_LOGIN = "";
const BASE = "https://tg.zcst.edu.cn";

const SITE_TG = {
  key: "tg",
  name: "TG 外网",
  pageHost: "tg.zcst.edu.cn",
  pageOrigin: "https://tg.zcst.edu.cn",
  apiOrigin: "https://tg.zcst.edu.cn",
  login: "user_04241025"
};

const SITE_TG_INTRANET = {
  ...SITE_TG,
  name: "TG 内网",
  pageHost: "172.16.36.150",
  pageOrigin: "http://172.16.36.150",
  apiOrigin: "http://172.16.36.150"
};

const SITE_EDUCODER = {
  key: "educoder",
  name: "头歌公网",
  pageHost: "www.educoder.net",
  pageOrigin: "https://www.educoder.net",
  apiOrigin: "https://data.educoder.net",
  login: "pchtkff9y",
  courses: [
    {
      courseId: 109348,
      courseIdentifier: "MOAPGNLO",
      courseName: "操作系统2026"
    }
  ]
};

const STORE_KEY = "TG_EXAM_MONITOR_RESULT";
const STORE_KEY_TG_RESULT = "TG_EXAM_MONITOR_TG_RESULT";
const STORE_KEY_EDUCODER_RESULT = "TG_EXAM_MONITOR_EDUCODER_RESULT";
const STORE_KEY_LAST_ERROR = "TG_EXAM_MONITOR_LAST_ERROR";
const STORE_KEY_LAST_RUNNING = "TG_EXAM_MONITOR_LAST_RUNNING";
const STORE_KEY_AUTO_LOGIN = "TG_TASK_MONITOR_AUTO_LOGIN";
const STORE_KEY_REFRESH_REQUEST = "TG_TASK_ASSISTANT_REFRESH_REQUEST";
const STORE_KEY_REFRESH_STATUS = "TG_TASK_ASSISTANT_REFRESH_STATUS";
const STORE_KEY_BACKEND_HEARTBEAT = "TG_TASK_ASSISTANT_BACKEND_HEARTBEAT";
const STORE_KEY_REFRESH_HANDLED = "TG_TASK_REFRESH_HANDLED";
const STORE_KEY_SEMESTER_SETTINGS = "TG_TASK_SEMESTER_SETTINGS";

const COURSE_PAGE_SIZE = 30;
const EXERCISE_LIMIT = 100;
const HOMEWORK_LIMIT = 100;

const ULTRA_ALL_IN_MODE = false;
const REQUEST_INTERVAL_MS = 0;
const COURSE_INTERVAL_MS = 0;
const COURSE_CONCURRENCY = 4;
const EXERCISE_USER_CONCURRENCY = 6;
const COURSE_SECTION_CONCURRENCY = 3;
const FAST_MODE_SKIP_EXERCISE_USER_DETAIL = true;
const DANGER_DAYS_THRESHOLD = 10;
const JSON_RETRY_DELAYS_MS = [2000, 4000];
const JSON_RETRY_TOTAL = JSON_RETRY_DELAYS_MS.length + 1;
let currentRefreshRequest = null;
let refreshPollTimerId = null;
let lastHandledRefreshRequestId = "";
let scanInProgress = false;

async function getCurrentLogin() {
  const manualLogin = String(MANUAL_LOGIN || "").trim();

  if (manualLogin) {
    return manualLogin;
  }

  const savedLogin = String(GM_getValue(STORE_KEY_AUTO_LOGIN, "") || "").trim();
  if (savedLogin) {
    return savedLogin;
  }

  if (SITE_TG.login) {
    return SITE_TG.login;
  }

  throw new Error("无法自动识别 TG 登录账号，请先打开 TG 页面让前台识别，或在后台脚本顶部填写 MANUAL_LOGIN，例如：user_04241025");
}

function logInfo(...args) {
  const text = args.map(formatLogArg).join(" ");
  if (typeof GM_log === "function") GM_log(text, "info");
  console.log("[TG任务状态后台扫描器]", ...args);
}

function logWarn(...args) {
  const text = args.map(formatLogArg).join(" ");
  if (typeof GM_log === "function") GM_log(text, "warn");
  console.warn("[TG任务状态后台扫描器]", ...args);
}

function logError(...args) {
  const text = args.map(formatLogArg).join(" ");
  if (typeof GM_log === "function") GM_log(text, "error");
  console.error("[TG任务状态后台扫描器]", ...args);
}

function formatLogArg(arg) {
  if (typeof arg === "string") return arg;
  try {
    return JSON.stringify(arg);
  } catch (e) {
    return String(arg);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex++;
      try {
        results[currentIndex] = await worker(items[currentIndex], currentIndex);
      } catch (err) {
        results[currentIndex] = {
          __error: err,
          __index: currentIndex,
          __item: items[currentIndex]
        };
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    () => runWorker()
  );

  await Promise.all(workers);
  return results;
}

async function setValue(key, value) {
  return await setSharedValue(key, value);
}

async function getValue(key, defaultValue) {
  return await getSharedValue(key, defaultValue);
}

async function setSharedValue(key, value) {
  logInfo("[DEBUG] setSharedValue: " + key + " = " + safeJsonPreview(value));

  if (typeof GM_setValue === "function") {
    return GM_setValue(key, value);
  }

  if (typeof GM !== "undefined" && GM.setValue) {
    return await GM.setValue(key, value);
  }

  localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
}

async function getSharedValue(key, defaultValue) {
  logInfo("[DEBUG] getSharedValue: " + key);

  if (typeof GM_getValue === "function") {
    return GM_getValue(key, defaultValue);
  }

  if (typeof GM !== "undefined" && GM.getValue) {
    const v = await GM.getValue(key);
    return v == null ? defaultValue : v;
  }

  const raw = localStorage.getItem(key);
  if (raw == null) return defaultValue;

  try {
    return JSON.parse(raw);
  } catch (e) {
    return raw;
  }
}

function safeJsonPreview(value) {
  try {
    return JSON.stringify(value).slice(0, 500);
  } catch (e) {
    return String(value).slice(0, 500);
  }
}

function getSiteByKey(siteKey) {
  const key = String(siteKey || "").trim();
  if (key === "educoder") return SITE_EDUCODER;
  if (key === "tg" || key === "tg-zcst") return SITE_TG;
  return null;
}

function getSiteByHost(hostname) {
  const host = String(hostname || "").trim();
  if (host === "www.educoder.net") return SITE_EDUCODER;
  if (host === "tg.zcst.edu.cn") return SITE_TG;
  if (host === "172.16.36.150") return SITE_TG_INTRANET;
  return null;
}

function getCurrentHost() {
  if (typeof location !== "undefined" && location.hostname) {
    return location.hostname;
  }

  return "";
}

function getActiveSite(refreshRequest = null) {
  const siteByKey = getSiteByKey(refreshRequest?.siteKey);
  const siteByRequestHost = getSiteByHost(refreshRequest?.pageHost);
  const siteByCurrentHost = getSiteByHost(getCurrentHost());
  const siteByHost = siteByRequestHost || siteByCurrentHost;

  // "tg" is the generic TG site key used by existing refresh requests. When
  // that request comes from the intranet, prefer the current host's Origin.
  if (siteByHost?.pageOrigin === SITE_TG_INTRANET.pageOrigin && (!siteByKey || siteByKey.key === "tg")) {
    return siteByHost;
  }

  return (
    siteByKey ||
    siteByHost ||
    null
  );
}

function getScanSites(refreshRequest = null) {
  const activeSite = getActiveSite(refreshRequest);
  return activeSite ? [activeSite] : [SITE_TG];
}

function getResultStoreKeyForSite(site) {
  if (site?.key === "educoder") return STORE_KEY_EDUCODER_RESULT;
  return STORE_KEY_TG_RESULT;
}

function getRuntimeScope(site = null, request = null) {
  const activeSite = site || getActiveSite(request) || SITE_TG;
  return {
    siteKey: activeSite.key,
    siteName: activeSite.name,
    pageHost: activeSite.pageHost,
    pageOrigin: activeSite.pageOrigin,
    requestId: request?.requestId || currentRefreshRequest?.requestId || ""
  };
}

async function markRefreshRequestHandledIfNeeded() {
  const request = await getValue(STORE_KEY_REFRESH_REQUEST, null);
  const handled = Number(await getValue(STORE_KEY_REFRESH_HANDLED, 0)) || 0;
  const requestedAt = Number(request?.requestedAt) || 0;

  if (requestedAt && requestedAt > handled) {
    await setValue(STORE_KEY_REFRESH_HANDLED, requestedAt);
  }
}

async function writeRefreshStatus(status, progress, message, extra = {}) {
  const requestId = extra.requestId || currentRefreshRequest?.requestId || "";
  const activeSite = getActiveSite(currentRefreshRequest) || getActiveSite(extra) || null;
  const payload = {
    status,
    requestId,
    progress,
    message,
    siteKey: extra.siteKey || activeSite?.key || "",
    siteName: extra.siteName || activeSite?.name || "",
    pageHost: extra.pageHost || activeSite?.pageHost || "",
    time: new Date().toLocaleString(),
    timestamp: Date.now(),
    ...extra
  };

  await setSharedValue(STORE_KEY_REFRESH_STATUS, payload);

  await setValue(STORE_KEY_LAST_RUNNING, {
    ...getRuntimeScope(activeSite, currentRefreshRequest),
    running: status === "running",
    timestamp: Date.now(),
    stage: status === "error" ? "failed" : status,
    stageText: message,
    current: progress,
    total: 100,
    percent: progress
  });
}

async function handleRefreshRequest(request) {
  if (!request?.requestId) return;
  if (request.requestId === lastHandledRefreshRequestId) return;

  lastHandledRefreshRequestId = request.requestId;
  currentRefreshRequest = request;
  logInfo("\u540e\u53f0\u5df2\u6536\u5230\u5237\u65b0\u8bf7\u6c42", request.requestId);
  await writeRefreshStatus("running", 18, "\u540e\u53f0\u5df2\u6536\u5230\u5237\u65b0\u8bf7\u6c42", { requestId: request.requestId });

  if (scanInProgress) {
    await writeRefreshStatus("running", 18, "\u540e\u53f0\u5df2\u6709\u626b\u63cf\u6b63\u5728\u8fd0\u884c\uff0c\u7b49\u5f85\u5f53\u524d\u626b\u63cf\u5b8c\u6210", { requestId: request.requestId });
    return;
  }

  await scanAll(request);
}

async function pollRefreshRequestOnce() {
  const request = await getSharedValue(STORE_KEY_REFRESH_REQUEST, null);
  if (!request?.requestId) return;
  await handleRefreshRequest(request);
}

function startRefreshRequestPolling() {
  if (refreshPollTimerId) return;

  pollRefreshRequestOnce().catch(err => logError("[DEBUG] \u8f6e\u8be2\u5237\u65b0\u8bf7\u6c42\u5931\u8d25", err));
  refreshPollTimerId = setInterval(() => {
    pollRefreshRequestOnce().catch(err => logError("[DEBUG] \u8f6e\u8be2\u5237\u65b0\u8bf7\u6c42\u5931\u8d25", err));
  }, 2000);
}

async function writeBackendHeartbeat() {
  await setSharedValue(STORE_KEY_BACKEND_HEARTBEAT, {
    status: "online",
    time: new Date().toLocaleString(),
    timestamp: Date.now(),
    message: "\u540e\u53f0\u811a\u672c\u8fd0\u884c\u4e2d",
    storageName: "tg-exam-monitor-shared"
  });
}

function startBackendHeartbeat() {
  writeBackendHeartbeat().catch(err => logError("\u540e\u53f0\u5fc3\u8df3\u5199\u5165\u5931\u8d25", err));
  setInterval(() => {
    writeBackendHeartbeat().catch(err => logError("\u540e\u53f0\u5fc3\u8df3\u5199\u5165\u5931\u8d25", err));
  }, 3000);
}

function startRefreshRequestListener() {
  if (typeof GM_addValueChangeListener === "function") {
    GM_addValueChangeListener(STORE_KEY_REFRESH_REQUEST, function (name, oldValue, newValue, remote) {
      logInfo("[DEBUG] \u76d1\u542c\u5230\u5237\u65b0\u8bf7\u6c42\u53d8\u5316", newValue);
      handleRefreshRequest(newValue).catch(err => {
        logError("[DEBUG] \u5904\u7406\u5237\u65b0\u8bf7\u6c42\u5931\u8d25", err);
        const errorKind = getErrorKind(err);
        const errorMessage = errorKind === "login_required" ? "TG 未登录，请先登录后刷新" : "\u5237\u65b0\u5931\u8d25";
        writeRefreshStatus("error", 100, errorMessage, {
          requestId: newValue?.requestId || "",
          error: errorMessage,
          ...(errorKind ? { errorKind } : {})
        });
      });
    });
  }

  startRefreshRequestPolling();
}

function isNotJsonError(error) {
  return Boolean(error?.detail?.notJson);
}

function isTgLoginPrompt(value) {
  return /(请登录后再操作|请先登录|未登录|登录态(?:已)?失效|登录已过期|authentication|sign[ -]?in)/i.test(String(value || ""));
}

function isTgLoginRequiredPayload(data, site = SITE_TG) {
  if (!isTgSite(site) || !data || typeof data !== "object" || Array.isArray(data)) return false;
  if (Number(data.status) !== 401) return false;
  return isTgLoginPrompt(data.message || data.msg || data.error);
}

function isTgLoginRequiredMeta(meta = {}) {
  if (!isTgSite({ key: meta.siteKey })) return false;

  const status = Number(meta.httpStatus ?? meta.status ?? 0);
  if (status === 401) return true;
  if (status === 403) {
    return isTgLoginPrompt(`${meta.message || ""} ${meta.preview || ""} ${meta.finalUrl || ""}`);
  }

  return Boolean(meta.notJson && isTgLoginPrompt(`${meta.preview || ""} ${meta.finalUrl || ""}`));
}

function markTgLoginRequiredError(error, site = SITE_TG, recognized = false) {
  if (!error || !(recognized || isTgLoginRequiredMeta({ ...(error.detail || {}), siteKey: site?.key }))) return error;

  error.errorKind = "login_required";
  error.detail = {
    ...(error.detail || {}),
    errorKind: "login_required",
    requestFailureClass: "terminal"
  };
  return error;
}

function getErrorKind(error) {
  return error?.errorKind || error?.detail?.errorKind || "";
}

function withErrorKind(record, error) {
  const errorKind = getErrorKind(error);
  return errorKind ? { ...record, errorKind } : record;
}

function getMonotonicNow() {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function classifyRequestFailure(detail = {}, error = null) {
  const status = Number(detail.httpStatus ?? detail.status ?? 0);
  const message = String(error?.message || detail.message || "");
  const preview = String(detail.preview || "");
  const finalUrl = String(detail.finalUrl || "");
  const source = `${message} ${preview} ${finalUrl}`.toLowerCase();

  if (detail.errorType === "configuration" || /gm_xmlhttprequest.*\u4e0d\u5b58\u5728|@grant/.test(source)) {
    return "terminal";
  }

  if ([401, 403, 404, 422].includes(status)) return "terminal";
  if ([408, 425, 429].includes(status) || (status >= 500 && status <= 599)) return "transient";

  if (detail.notJson && /\/login(?:[/?#]|$)|\u767b\u5f55|sign[ -]?in|authentication/.test(source)) {
    return "terminal";
  }

  if (detail.notJson || detail.parseError || detail.structureError || detail.errorType === "network" || detail.errorType === "timeout" || status === 0) {
    return "transient";
  }

  return null;
}

function gmRequestText(url, options = {}, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const requestStartedAt = getMonotonicNow();
    const getTiming = () => {
      const requestFinishedAt = getMonotonicNow();
      return {
        requestStartedAt,
        requestFinishedAt,
        durationMs: Math.max(0, Math.round((requestFinishedAt - requestStartedAt) * 100) / 100)
      };
    };

    if (typeof GM_xmlhttpRequest !== "function") {
      const error = new Error("GM_xmlhttpRequest \u4e0d\u5b58\u5728\uff0c\u8bf7\u68c0\u67e5 @grant GM_xmlhttpRequest");
      error.detail = {
        url,
        httpStatus: 0,
        errorType: "configuration",
        requestFailureClass: "terminal",
        ...getTiming()
      };
      reject(error);
      return;
    }

    GM_xmlhttpRequest({
      method: options.method || "GET",
      url,
      headers: {
        accept: "application/json, text/plain, */*",
        ...(options.headers || {})
      },
      data: options.body || options.data,
      timeout: timeoutMs,

      onload(res) {
        const timing = getTiming();
        const detail = {
          url,
          httpStatus: res.status,
          statusText: res.statusText || "",
          finalUrl: res.finalUrl || url,
          ...timing
        };
        resolve({
          status: res.status,
          statusText: res.statusText || "",
          responseText: res.responseText || "",
          responseHeaders: res.responseHeaders || "",
          finalUrl: res.finalUrl || url,
          ...timing,
          requestFailureClass: classifyRequestFailure(detail)
        });
      },

      onerror(err) {
        const message = "GM_xmlhttpRequest onerror: " + JSON.stringify(err);
        const error = new Error(message);
        error.detail = {
          url,
          httpStatus: 0,
          errorType: "network",
          requestFailureClass: "transient",
          message,
          ...getTiming()
        };
        reject(error);
      },

      ontimeout() {
        const message = "GM_xmlhttpRequest timeout: " + url;
        const error = new Error(message);
        error.detail = {
          url,
          httpStatus: 0,
          errorType: "timeout",
          requestFailureClass: "transient",
          message,
          ...getTiming()
        };
        reject(error);
      }
    });
  });
}

function attachJsonMeta(data, meta) {
  if (data && typeof data === "object") {
    try {
      Object.defineProperty(data, "__tgRequestMeta", {
        value: meta,
        enumerable: false,
        configurable: true
      });
    } catch (e) {}
  }

  return data;
}

function getJsonMeta(data) {
  return data?.__tgRequestMeta || null;
}

async function fetchJson(url, site = SITE_TG, options = {}, label = "JSON接口") {
  let res;

  try {
    res = await gmRequestText(url, options, options.timeoutMs || 15000);
  } catch (err) {
    const transportDetail = err?.detail || {};
    const error = new Error(`${label} 请求失败：${err.message}`);
    error.detail = {
      siteKey: site?.key || "",
      siteName: site?.name || "",
      url,
      httpStatus: 0,
      contentType: "",
      preview: "",
      message: err?.message || String(err),
      fetchError: String(err && err.stack ? err.stack : err),
      requestStartedAt: transportDetail.requestStartedAt ?? null,
      requestFinishedAt: transportDetail.requestFinishedAt ?? null,
      durationMs: transportDetail.durationMs ?? null,
      errorType: transportDetail.errorType || "network",
      requestFailureClass: transportDetail.requestFailureClass || classifyRequestFailure(transportDetail, err)
    };
    throw error;
  }

  const text = res.responseText || "";
  const contentType = res.responseHeaders || "";
  const meta = {
    siteKey: site?.key || "",
    siteName: site?.name || "",
    url,
    httpStatus: res.status,
    statusText: res.statusText || "",
    contentType,
    preview: text.slice(0, 300),
    finalUrl: res.finalUrl || url,
    ok: res.status >= 200 && res.status < 300,
    requestStartedAt: res.requestStartedAt ?? null,
    requestFinishedAt: res.requestFinishedAt ?? null,
    durationMs: res.durationMs ?? null,
    requestFailureClass: res.requestFailureClass || null
  };

  if (!meta.ok) {
    const error = new Error(`${label} HTTP ${res.status}`);
    error.detail = {
      ...meta,
      requestFailureClass: classifyRequestFailure(meta)
    };
    markTgLoginRequiredError(error, site);
    throw error;
  }

  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    const error = new Error(`返回的不是 JSON：${url}，响应前300字：${text.slice(0, 300)}`);
    error.detail = {
      ...meta,
      notJson: true,
      requestFailureClass: classifyRequestFailure({ ...meta, notJson: true })
    };
    markTgLoginRequiredError(error, site);
    throw error;
  }

  try {
    const data = JSON.parse(text);
    meta.jsonKeys = data && typeof data === "object" && !Array.isArray(data) ? Object.keys(data) : [];

    if (isTgLoginRequiredPayload(data, site)) {
      const error = new Error(`${label}：TG 未登录，请先登录后刷新`);
      error.detail = {
        ...meta,
        businessStatus: data.status,
        businessMessage: data.message || data.msg || data.error || ""
      };
      markTgLoginRequiredError(error, site, true);
      throw error;
    }

    return attachJsonMeta(data, meta);
  } catch (err) {
    if (err?.errorKind === "login_required") throw err;
    const error = new Error(`JSON解析失败：${url}，响应前300字：${text.slice(0, 300)}`);
    error.detail = {
      ...meta,
      message: err?.message || String(err),
      parseError: err?.message || String(err),
      requestFailureClass: "transient"
    };
    throw error;
  }
}

function getRequestLogBase(data, site, type, courseResult = null) {
  const meta = getJsonMeta(data) || {};
  return {
    siteKey: site?.key || courseResult?.siteKey || meta.siteKey || "",
    siteName: site?.name || courseResult?.siteName || meta.siteName || "",
    courseName: courseResult?.courseName || "",
    type,
    url: meta.url || "",
    httpStatus: meta.httpStatus ?? null,
    contentType: meta.contentType || "",
    preview: meta.preview || "",
    jsonKeys: meta.jsonKeys || [],
    requestStartedAt: meta.requestStartedAt ?? null,
    requestFinishedAt: meta.requestFinishedAt ?? null,
    durationMs: meta.durationMs ?? null,
    requestFailureClass: meta.requestFailureClass || null,
    ok: true
  };
}

function pushRequestLog(result, entry) {
  result.debug = result.debug || {};
  result.debug.requestLog = result.debug.requestLog || [];
  result.debug.requestLog.push(entry);
}

function pushFailedRequestLog(result, site, type, courseResult, error) {
  const detail = error?.detail || {};
  pushRequestLog(result, {
    siteKey: site?.key || courseResult?.siteKey || detail.siteKey || "",
    siteName: site?.name || courseResult?.siteName || detail.siteName || "",
    courseName: courseResult?.courseName || "",
    type,
    url: detail.url || "",
    httpStatus: detail.httpStatus ?? detail.status ?? null,
    contentType: detail.contentType || "",
    preview: detail.preview || "",
    jsonKeys: detail.jsonKeys || [],
    requestStartedAt: detail.requestStartedAt ?? null,
    requestFinishedAt: detail.requestFinishedAt ?? null,
    durationMs: detail.durationMs ?? null,
    requestFailureClass: detail.requestFailureClass || null,
    retryExhausted: detail.retryExhausted === true,
    ok: false,
    error: error?.message || String(error)
  });
}

function pushCourseScanFlow(result, site, courseResult, step) {
  result.debug = result.debug || {};
  result.debug.courseScanFlow = result.debug.courseScanFlow || [];
  result.debug.courseScanFlow.push({
    siteKey: site?.key || courseResult?.siteKey || "",
    siteName: site?.name || courseResult?.siteName || "",
    courseName: courseResult?.courseName || "",
    courseIdentifier: courseResult?.courseIdentifier || "",
    courseId: courseResult?.courseId ?? null,
    step,
    examsCount: courseResult?.exams?.length || 0,
    homeworksCount: courseResult?.homeworks?.length || 0,
    experimentsCount: courseResult?.experiments?.length || 0,
    timestamp: Date.now(),
    time: new Date().toLocaleString()
  });
}

async function checkSiteLogin(site) {
  if (site.key === "educoder") {
    const url =
      `${site.apiOrigin}/api/users/${encodeURIComponent(site.login)}/homepage_info.json` +
      `?zzud=${encodeURIComponent(site.login)}`;
    const data = await fetchJson(url, site, {}, `${site.name} 登录态预检`);

    if (!data || data.is_logged_user !== true) {
      throw new Error(`站点未登录或登录态失效：${site.name}`);
    }

    return {
      ok: true,
      siteKey: site.key,
      siteName: site.name,
      login: site.login,
      userName: data.name || "",
      userId: data.id || null,
      request: getRequestLogBase(data, site, "site_login_check")
    };
  }

  if (site.key === "tg" || site.key === "tg-zcst") {
    const url =
      `${site.apiOrigin}/api/users/${encodeURIComponent(site.login)}/courses.json` +
      `?category=&status=processing&page=1&per_page=1` +
      `&sort_by=updated_at&sort_direction=desc` +
      `&username=${encodeURIComponent(site.login)}` +
      `&zzud=${encodeURIComponent(site.login)}`;
    const data = await fetchJson(url, site, {}, `${site.name} 登录态预检`);

    if (!data || !Array.isArray(data.courses)) {
      throw new Error(`站点未登录或课程列表异常：${site.name}`);
    }

    return {
      ok: true,
      siteKey: site.key,
      siteName: site.name,
      login: site.login,
      request: getRequestLogBase(data, site, "site_login_check")
    };
  }

  return { ok: true, siteKey: site.key, siteName: site.name };
}

function isTgSite(site) {
  return site?.key === "tg" || site?.key === "tg-zcst";
}

function hasRecognizedCourseList(raw, list = parseCourseList(raw)) {
  const hasRecognizedCourseListShape =
    Array.isArray(raw?.courses) ||
    Array.isArray(raw?.data?.courses) ||
    Array.isArray(raw?.data?.course_list) ||
    Array.isArray(raw?.data?.list) ||
    Array.isArray(raw?.data);

  return hasRecognizedCourseListShape && list.every(course => course && typeof course === "object");
}

function createCourseListStructureError(raw, site, url) {
  const error = new Error(`课程列表返回结构异常：${site.name}`);
  error.detail = {
    ...(getJsonMeta(raw) || {}),
    url,
    structureError: true,
    requestFailureClass: "transient"
  };
  return error;
}

async function recordTgReadinessRetryStatus(site, refreshRequest, error, attempt, delayMs) {
  const detail = error?.detail || {};
  const requestId = refreshRequest?.requestId || currentRefreshRequest?.requestId || "";

  try {
    await setValue(STORE_KEY_LAST_RUNNING, {
      ...getRuntimeScope(site, refreshRequest),
      running: true,
      timestamp: Date.now(),
      stage: "tg_readiness_retrying",
      stageText: `TG 接口暂不可用，${Math.round(delayMs / 1000)} 秒后重试（${attempt}/${JSON_RETRY_TOTAL}）`,
      current: attempt,
      total: JSON_RETRY_TOTAL,
      percent: Math.min(18, 8 + attempt * 3),
      requestId,
      retryAttempt: attempt,
      retryTotal: JSON_RETRY_TOTAL,
      retryDelayMs: delayMs,
      requestFailureClass: detail.requestFailureClass || classifyRequestFailure(detail, error),
      durationMs: detail.durationMs ?? null
    });
  } catch (statusError) {
    logWarn("TG 就绪重试状态写入失败", statusError);
  }
}

async function waitForTgReadyAndFetchCourses(login, site, result = null, refreshRequest = null) {
  let lastError = null;

  for (let attempt = 1; attempt <= JSON_RETRY_TOTAL; attempt += 1) {
    const url = buildCoursesUrl(1, login, site);

    try {
      const raw = await fetchJson(url, site, {}, `${site.name} 课程列表 page=1`);
      if (!hasRecognizedCourseList(raw)) {
        throw createCourseListStructureError(raw, site, url);
      }

      return {
        raw,
        request: getRequestLogBase(raw, site, "course_list"),
        attempt
      };
    } catch (error) {
      lastError = error;
      const detail = error?.detail || {};
      const failureClass = detail.requestFailureClass || classifyRequestFailure(detail, error) || "terminal";

      if (failureClass !== "transient" || attempt >= JSON_RETRY_TOTAL) {
        if (failureClass === "transient" && attempt >= JSON_RETRY_TOTAL) {
          error.detail = {
            ...detail,
            requestFailureClass: "terminal",
            retryAttempt: attempt,
            retryTotal: JSON_RETRY_TOTAL,
            retryExhausted: true
          };
        }
        throw error;
      }

      const delayMs = JSON_RETRY_DELAYS_MS[attempt - 1];
      if (result) pushFailedRequestLog(result, site, "course_readiness_retry", null, error);
      await recordTgReadinessRetryStatus(site, refreshRequest, error, attempt, delayMs);
      await sleep(delayMs);
    }
  }

  throw lastError || new Error(`TG 就绪检查失败：${site.name}`);
}

function normalizeText(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function firstPresent(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") return value;
  }

  return null;
}

function looksLikeNumericId(value) {
  return typeof value === "number" || (typeof value === "string" && /^\d+$/.test(value));
}

function getNumericCourseId(course) {
  const candidates = [
    course.courseId,
    course.course_id,
    course.id,
    course.courses_id,
    course.course?.id,
    course.raw?.id
  ];

  const value = candidates.find(looksLikeNumericId);
  return value === undefined ? null : value;
}

function extractCourseIdentifier(course) {
  if (!course || typeof course !== "object") return null;

  const directCandidates = [
    course.courseIdentifier,
    course.identifier,
    course.course_identifier,
    course.invite_code,
    course.inviteCode,
    course.course_code,
    course.courseCode,
    course.classroom_identifier,
    course.classroomIdentifier
  ];

  for (const v of directCandidates) {
    if (typeof v === "string" && v.trim()) {
      return v.trim();
    }
  }

  const urlCandidates = [
    course.first_category_url,
    course.classroom_url,
    course.course_url,
    course.url,
    course.home_url
  ];

  for (const url of urlCandidates) {
    if (typeof url === "string") {
      const match = url.match(/\/classrooms\/([^/]+)/);
      if (match && match[1]) {
        return match[1];
      }
    }
  }

  const text = JSON.stringify(course);
  const match = text.match(/\/classrooms\/([^/]+)/);
  if (match && match[1]) {
    return match[1];
  }

  return null;
}

function getCourseName(course) {
  return normalizeText(
    firstPresent(
      course.name,
      course.course_name,
      course.courseName,
      course.title,
      course.subject,
      course.course_title,
      course.course?.name,
      "未识别课堂名"
    )
  );
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

function inferCurrentSemester(now = new Date(), settings = {}) {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const { upperSemesterStartMonth: upper, lowerSemesterStartMonth: lower } = normalizeSemesterSettings(settings);

  if (upper === lower) {
    return inferCurrentSemester(now, { upperSemesterStartMonth: 8, lowerSemesterStartMonth: 3 });
  }

  const upperDistance = (month - upper + 12) % 12;
  const lowerDistance = (month - lower + 12) % 12;
  const isUpper = upperDistance < lowerDistance;
  const startYear = isUpper
    ? (month >= upper ? year : year - 1)
    : (lower < upper ? year - 1 : year);
  const endYear = startYear + 1;
  const lowerDate = new Date(startYear + (lower < upper ? 1 : 0), lower - 1, 1, 0, 0, 0);
  const upperDateNext = new Date(endYear, upper - 1, 1, 0, 0, 0);
  const startDate = isUpper
    ? new Date(startYear, upper - 1, 1, 0, 0, 0)
    : lowerDate;
  const endDate = isUpper
    ? new Date(lowerDate.getTime() - 1000)
    : new Date(upperDateNext.getTime() - 1000);

  return {
    term: isUpper ? "fall" : "spring",
    termText: isUpper ? "上学期" : "下学期",
    seasonText: isUpper ? "秋" : "春",
    startYear,
    endYear,
    startDate,
    endDate,
    upperSemesterStartMonth: upper,
    lowerSemesterStartMonth: lower,
    academicYearText: `${startYear}-${endYear}`
  };
}

function getShortYear(year) {
  return String(year).slice(-2);
}

function getCourseCreatedDate(course) {
  const raw = course?.raw || {};
  const value = firstPresent(
    course?.created_at,
    course?.createdAt,
    raw.created_at,
    raw.createdAt,
    raw.course?.created_at,
    raw.course?.createdAt
  );

  if (!value) return null;

  const date = new Date(String(value).replace(/-/g, "/"));
  return Number.isNaN(date.getTime()) ? null : date;
}

function courseNameHasExplicitSemesterKeyword(courseName) {
  return /(?:\d{4}\s*(?:春|春季|春季学期|秋|秋季|秋季学期)|\d{4}\s*-\s*\d{4}\s*-\s*[12]|\d{2}\s*-\s*\d{2}\s*-\s*[12]|\d{4}\s*-\s*\d{4}\s*第\s*[12]\s*学期|上学期|下学期)/.test(courseName);
}

function courseNameMatchesSemester(courseName, semester) {
  const name = normalizeText(courseName);
  const startYear = semester.startYear;
  const endYear = semester.endYear;
  const shortStart = getShortYear(startYear);
  const shortEnd = getShortYear(endYear);

  if (semester.term === "spring") {
    const springYear = endYear;
    return [
      new RegExp(`${springYear}\\s*春`),
      new RegExp(`${springYear}\\s*春季`),
      new RegExp(`${springYear}\\s*春季学期`),
      new RegExp(`${startYear}\\s*-\\s*${endYear}\\s*-\\s*2`),
      new RegExp(`${shortStart}\\s*-\\s*${shortEnd}\\s*-\\s*2`),
      new RegExp(`${startYear}\\s*-\\s*${endYear}\\s*第\\s*2\\s*学期`),
      /下学期/
    ].some(pattern => pattern.test(name));
  }

  const fallYear = startYear;
  return [
    new RegExp(`${fallYear}\\s*秋`),
    new RegExp(`${fallYear}\\s*秋季`),
    new RegExp(`${fallYear}\\s*秋季学期`),
    new RegExp(`${startYear}\\s*-\\s*${endYear}\\s*-\\s*1`),
    new RegExp(`${shortStart}\\s*-\\s*${shortEnd}\\s*-\\s*1`),
    new RegExp(`${startYear}\\s*-\\s*${endYear}\\s*第\\s*1\\s*学期`),
    /上学期/
  ].some(pattern => pattern.test(name));
}

function isCourseInCurrentSemester(course, semester) {
  const courseName = course?.courseName || getCourseName(course?.raw || course || {});

  if (courseNameMatchesSemester(courseName, semester)) return true;
  if (courseNameHasExplicitSemesterKeyword(courseName)) return false;

  const createdDate = getCourseCreatedDate(course);
  if (!createdDate) return true;

  return createdDate >= semester.startDate && createdDate <= semester.endDate;
}

function formatLogDate(date) {
  if (!date) return "";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${d} ${h}:${min}:${s}`;
}

async function filterCoursesByCurrentSemester(courses, result = null, site = SITE_TG) {
  const semesterSettings = await loadSemesterSettings();
  const semester = inferCurrentSemester(new Date(), semesterSettings);
  const kept = [];
  const excluded = [];

  for (const course of courses) {
    if (isCourseInCurrentSemester(course, semester)) {
      kept.push(course);
    } else {
      excluded.push(course);
    }
  }

  const finalCourses = kept.length ? kept : courses;
  const filterInfo = {
    siteKey: site?.key || "",
    siteName: site?.name || "",
    academicYearText: semester.academicYearText,
    termText: semester.termText,
    startDate: formatLogDate(semester.startDate),
    endDate: formatLogDate(semester.endDate),
    beforeCount: courses.length,
    afterCount: finalCourses.length,
    fallbackToAll: kept.length === 0 && courses.length > 0,
    keptCourseNames: finalCourses.map(course => course.courseName),
    excludedCourseNames: kept.length ? excluded.map(course => course.courseName) : []
  };

  logInfo(
    "当前学期过滤：",
    `academicYearText=${filterInfo.academicYearText}`,
    `termText=${filterInfo.termText}`,
    `startDate=${filterInfo.startDate}`,
    `endDate=${filterInfo.endDate}`,
    `过滤前课程数=${filterInfo.beforeCount}`,
    `过滤后课程数=${filterInfo.afterCount}`,
    `保留课程名=${filterInfo.keptCourseNames.join(" | ") || "--"}`,
    `排除课程名=${filterInfo.excludedCourseNames.join(" | ") || "--"}`
  );

  if (result) {
    result.debug = result.debug || {};
    result.debug.currentSemesterFilter = result.debug.currentSemesterFilter || [];
    result.debug.currentSemesterFilter.push(filterInfo);
  }

  return finalCourses;
}

function normalizeCourse(course, site = SITE_TG) {
  return {
    courseId: getNumericCourseId(course),
    courseIdentifier: extractCourseIdentifier(course),
    courseName: getCourseName(course),
    site,
    siteKey: site.key,
    siteName: site.name,
    raw: course
  };
}

function parseCourseList(raw) {
  const list =
    raw?.courses ||
    raw?.data?.courses ||
    raw?.data?.course_list ||
    raw?.data?.list ||
    raw?.data ||
    [];

  return Array.isArray(list) ? list : [];
}

function parseExerciseCommitStatus(user) {
  const commitStatus = user?.commit_status;

  if (commitStatus === 0) {
    return {
      commitStatus,
      statusText: "未开始/未提交",
      completed: false
    };
  }

  if (commitStatus === 1) {
    return {
      commitStatus,
      statusText: "进行中/未提交",
      completed: false
    };
  }

  if (commitStatus === 2) {
    return {
      commitStatus,
      statusText: "已完成/已提交",
      completed: true
    };
  }

  return {
    commitStatus,
    statusText: `未知状态码：${commitStatus}`,
    completed: !!user?.end_at || (user?.score !== undefined && user?.score !== null && user?.score !== "--")
  };
}

function hasValidScore(score) {
  return score !== undefined &&
    score !== null &&
    String(score).trim() !== "" &&
    String(score).trim() !== "--";
}

function getExercisePersonalScoreText(value) {
  if (value === undefined || value === null || value === "") return "";
  return String(value);
}

function getExerciseFallbackRecord(commonHeaderJson = null) {
  return (
    (Array.isArray(commonHeaderJson?.simulate_exercise_records) && commonHeaderJson.simulate_exercise_records[0]) ||
    (Array.isArray(commonHeaderJson?.data?.simulate_exercise_records) && commonHeaderJson.data.simulate_exercise_records[0]) ||
    null
  );
}

function analyzeExamStatus(exam, userInfo = {}, headerInfo = null) {
  const tips = Array.isArray(exam?.exercise_tips) ? exam.exercise_tips : [];
  const hasTip = keyword => tips.some(tip => String(tip || "").includes(keyword));
  const fallbackRecord = getExerciseFallbackRecord(headerInfo);
  const commitStatus = firstPresent(userInfo?.commit_status, fallbackRecord?.commit_status);
  const score = firstPresent(userInfo?.score, fallbackRecord?.score);
  const totalScore = firstPresent(
    userInfo?.total_score,
    headerInfo?.total_score,
    headerInfo?.data?.total_score
  );
  const startAt = firstPresent(userInfo?.start_at, fallbackRecord?.start_at) || null;
  const endAt = firstPresent(userInfo?.end_at, fallbackRecord?.end_at) || null;
  const openTotalScore = firstPresent(userInfo?.open_total_score, fallbackRecord?.open_total_score);
  const maxAttempts = Math.max(1, Number(exam?.simulate_exercise_num || 1) || 1);
  const usedAttempts = Math.max(0, Number(exam?.user_simulate_num || 0) || 0);
  const scoreText = getExercisePersonalScoreText(score);
  const totalScoreText = getExercisePersonalScoreText(totalScore);
  const hasEndTime = !!endAt;
  const hasScore = hasValidScore(score);
  const hasSubmittedTip = hasTip("已提交") || hasTip("已交卷") || hasTip("已完成");
  const hasExplicitSubmittedEvidence = commitStatus === 2 || hasEndTime || hasScore || hasSubmittedTip;
  const isOpen =
    exam?.exercise_status === 2 ||
    exam?.whole_exercise_status === 2 ||
    hasTip("考试中") ||
    !!exam?.exercise_left_time;
  const isEnded =
    exam?.exercise_status === 3 ||
    exam?.whole_exercise_status === 3 ||
    hasTip("已截止");
  const isExplicitUnsubmitted =
    hasTip("未提交") ||
    exam?.current_status === 4;
  const canRetry = isOpen && maxAttempts > usedAttempts;

  // 已提交证据优先于“考试中”整体状态，避免允许重考时被误判为未提交/危险任务。
  if (hasExplicitSubmittedEvidence) {
    const examFinalStatus = canRetry ? "submitted_can_retry" : "submitted";
    const examStatusLabel = canRetry
      ? "已提交过 / 可重考"
      : (isEnded ? "已截止 / 已提交" : "已提交");

    return {
      examFinalStatus,
      examStatusLabel,
      statusText: examStatusLabel,
      submitStatusText: examStatusLabel,
      dangerous: false,
      submitted: true,
      completed: true,
      canRetry,
      usedAttempts,
      maxAttempts,
      score,
      scoreText,
      totalScore,
      totalScoreText,
      startAt,
      submitAt: endAt,
      endAt,
      openTotalScore,
      rawExerciseTips: tips,
      rawExerciseStatus: exam?.exercise_status ?? null,
      rawCurrentStatus: exam?.current_status ?? null,
      rawCommitStatus: commitStatus ?? null
    };
  }

  if (isEnded && isExplicitUnsubmitted) {
    return {
      examFinalStatus: "ended_unsubmitted",
      examStatusLabel: "已截止 / 未提交",
      statusText: "已截止 / 未提交",
      submitStatusText: "已截止 / 未提交",
      dangerous: true,
      submitted: false,
      completed: false,
      canRetry: false,
      usedAttempts,
      maxAttempts,
      score,
      scoreText,
      totalScore,
      totalScoreText,
      startAt,
      submitAt: endAt,
      endAt,
      openTotalScore,
      rawExerciseTips: tips,
      rawExerciseStatus: exam?.exercise_status ?? null,
      rawCurrentStatus: exam?.current_status ?? null,
      rawCommitStatus: commitStatus ?? null
    };
  }

  if (isOpen) {
    return {
      examFinalStatus: "open_unsubmitted",
      examStatusLabel: "考试中 / 未提交",
      statusText: "考试中 / 未提交",
      submitStatusText: "考试中 / 未提交",
      dangerous: false,
      submitted: false,
      completed: false,
      canRetry: false,
      usedAttempts,
      maxAttempts,
      score,
      scoreText,
      totalScore,
      totalScoreText,
      startAt,
      submitAt: endAt,
      endAt,
      openTotalScore,
      rawExerciseTips: tips,
      rawExerciseStatus: exam?.exercise_status ?? null,
      rawCurrentStatus: exam?.current_status ?? null,
      rawCommitStatus: commitStatus ?? null
    };
  }

  if (isEnded) {
    return {
      examFinalStatus: "ended_unknown",
      examStatusLabel: "已截止 / 状态待确认",
      statusText: "已截止 / 状态待确认",
      submitStatusText: "已截止 / 状态待确认",
      dangerous: false,
      submitted: false,
      completed: false,
      canRetry: false,
      usedAttempts,
      maxAttempts,
      score,
      scoreText,
      totalScore,
      totalScoreText,
      startAt,
      submitAt: endAt,
      endAt,
      openTotalScore,
      rawExerciseTips: tips,
      rawExerciseStatus: exam?.exercise_status ?? null,
      rawCurrentStatus: exam?.current_status ?? null,
      rawCommitStatus: commitStatus ?? null
    };
  }

  return {
    examFinalStatus: "unknown",
    examStatusLabel: "未知状态",
    statusText: "未知状态",
    submitStatusText: "未知状态",
    dangerous: false,
    submitted: false,
    completed: false,
    canRetry: false,
    usedAttempts,
    maxAttempts,
    score,
    scoreText,
    totalScore,
    totalScoreText,
    startAt,
    submitAt: endAt,
    endAt,
    openTotalScore,
    rawExerciseTips: tips,
    rawExerciseStatus: exam?.exercise_status ?? null,
    rawCurrentStatus: exam?.current_status ?? null,
    rawCommitStatus: commitStatus ?? null
  };
}

function parseExercisePersonalProgress(exam, exerciseUsersJson = null, commonHeaderJson = null) {
  const user =
    exerciseUsersJson?.data?.current_answer_user ||
    exerciseUsersJson?.current_answer_user ||
    null;
  const progressSource = user
    ? "exercise_users.current_answer_user"
    : getExerciseFallbackRecord(commonHeaderJson)
      ? "common_header.simulate_exercise_records[0]"
      : "exercise_list";
  const analyzed = analyzeExamStatus(exam, {
    ...user,
    total_score: firstPresent(
      exerciseUsersJson?.data?.total_score,
      exerciseUsersJson?.total_score
    )
  }, commonHeaderJson);

  return {
    ...analyzed,
    commitStatus: analyzed.rawCommitStatus,
    progressSource
  };
}

function parseExerciseFromListOnly(exam) {
  const analyzed = analyzeExamStatus(exam, {}, null);
  const fallbackStatus = analyzed.examFinalStatus === "unknown"
    ? "未知状态"
    : analyzed.examStatusLabel;
  const progressSource = "exercise_list";

  return {
    ...analyzed,
    commitStatus: analyzed.rawCommitStatus,
    statusText: fallbackStatus,
    submitStatusText: fallbackStatus,
    progressSource
  };
}

function parseCommonHomeworkFromListItem(courseResult, item) {
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
    notSubmitted =
      workStatusText.includes("提交作品") ||
      workStatusText.includes("未提交");

    submitted =
      workStatusText.includes("查看作品") ||
      workStatusText.includes("已提交") ||
      workStatusText.includes("已完成");
  }

  let statusText = "未知状态";

  if (notSubmitted) {
    statusText = ended ? "已截止/未提交" : "未提交";
  } else if (submitted) {
    statusText = ended ? "已截止/已提交" : "已提交";
  }

  return {
    taskType: "common_homework",
    taskTypeText: "图文作业",
    siteKey: courseResult.siteKey,
    siteName: courseResult.siteName,

    courseId: courseResult.courseId,
    courseIdentifier: courseResult.courseIdentifier,
    courseName: courseResult.courseName,

    homeworkId: item?.homework_id || item?.id,
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
    source: "homework_commons_list",

    raw: item
  };
}

function parseClassroomExperimentFromListItem(courseResult, item) {
  const finishedStatus = Number(item?.shixun_finished_status);
  const completed = finishedStatus === 1;
  const ended =
    item?.time_status === 5 ||
    (Array.isArray(item?.status) && item.status.includes("已截止"));

  let statusText = "未知状态";

  if (completed) {
    statusText = "已完成";
  } else if (ended) {
    statusText = "已截止/未完成";
  } else {
    statusText = "进行中/未完成";
  }

  const homeworkId = item?.homework_id || item?.id;

  return {
    taskType: "classroom_experiment",
    taskTypeText: "课堂实验",
    siteKey: courseResult.siteKey,
    siteName: courseResult.siteName,

    courseId: courseResult.courseId,
    courseIdentifier: courseResult.courseIdentifier,
    courseName: courseResult.courseName,

    homeworkId,
    title: item?.name || item?.shixun_name || "未命名课堂实验",

    statusText,
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

    shixunIdentifier: item?.shixun_identifier || "",
    myshixunIdentifier: item?.myshixun_identifier || "",

    taskOperation: item?.task_operation || [],
    detailUrl: buildClassroomExperimentDetailUrl(courseResult.courseIdentifier, homeworkId, courseResult.site),

    source: "homework_commons_type_4",
    raw: item
  };
}

function getApiOrigin(site = SITE_TG) {
  return site?.apiOrigin || BASE;
}

function getPageOrigin(site = SITE_TG) {
  return site?.pageOrigin || BASE;
}

function buildCoursesUrl(page, login, site = SITE_TG) {
  const apiOrigin = getApiOrigin(site);
  return (
    `${apiOrigin}/api/users/${encodeURIComponent(login)}/courses.json` +
    `?category=&status=processing` +
    `&page=${page}` +
    `&per_page=${COURSE_PAGE_SIZE}` +
    `&sort_by=updated_at` +
    `&sort_direction=desc` +
    `&username=${encodeURIComponent(login)}` +
    `&zzud=${encodeURIComponent(login)}` +
    `&_t=${Date.now()}`
  );
}

function buildExercisesUrl(courseId, login, site = SITE_TG) {
  const apiOrigin = getApiOrigin(site);
  return (
    `${apiOrigin}/api/v2/courses/${courseId}/exercises.json` +
    `?coursesId=${encodeURIComponent(courseId)}` +
    `&limit=${EXERCISE_LIMIT}` +
    `&type=` +
    `&id=${encodeURIComponent(courseId)}` +
    `&zzud=${encodeURIComponent(login)}` +
    `&_t=${Date.now()}`
  );
}

function getCourseApiId(course) {
  if (course?.siteKey === "educoder" || course?.site?.key === "educoder") {
    return course.courseIdentifier || course.courseId;
  }

  return course?.courseId || course?.courseIdentifier;
}

function buildExerciseUsersUrl(courseId, exerciseId, login, site = SITE_TG) {
  const apiOrigin = getApiOrigin(site);
  return (
    `${apiOrigin}/api/exercises/${exerciseId}/exercise_users.json` +
    `?page=1` +
    `&limit=20` +
    `&coursesId=${encodeURIComponent(courseId)}` +
    `&categoryId=${encodeURIComponent(exerciseId)}` +
    `&zzud=${encodeURIComponent(login)}` +
    `&_t=${Date.now()}`
  );
}

function buildExerciseCommonHeaderUrl(courseIdentifier, exerciseId, login, site = SITE_TG) {
  const apiOrigin = getApiOrigin(site);
  return (
    `${apiOrigin}/api/exercises/${exerciseId}/common_header.json` +
    `?coursesId=${encodeURIComponent(courseIdentifier)}` +
    `&categoryId=${encodeURIComponent(exerciseId)}` +
    `&category=${encodeURIComponent(exerciseId)}` +
    `&zzud=${encodeURIComponent(login)}` +
    `&_t=${Date.now()}`
  );
}

function buildExerciseDetailUrl(courseIdentifier, exerciseId, login, site = SITE_TG) {
  if (!courseIdentifier || !exerciseId || !login) return "";
  return `${getPageOrigin(site)}/classrooms/${courseIdentifier}/exercisenotice/${exerciseId}/users/${encodeURIComponent(login)}`;
}

function buildHomeworkDetailUrl(courseIdentifier, homeworkId, site = SITE_TG) {
  if (!courseIdentifier || !homeworkId) return "";
  return `${getPageOrigin(site)}/classrooms/${courseIdentifier}/common_homework/${homeworkId}/detail?tabs=0`;
}

function buildClassroomExperimentDetailUrl(courseIdentifier, homeworkId, site = SITE_TG) {
  if (!courseIdentifier || !homeworkId) return "";
  return `${getPageOrigin(site)}/classrooms/${courseIdentifier}/shixun_homework/${homeworkId}/detail?tabs=1`;
}

function getConfiguredCourses(site) {
  if (!Array.isArray(site?.courses) || !site.courses.length) return [];

  return site.courses.map(course => ({
    courseId: course.courseId,
    courseIdentifier: course.courseIdentifier,
    courseName: course.courseName,
    configured: true,
    site,
    siteKey: site.key,
    siteName: site.name,
    raw: {
      ...course,
      configured: true
    }
  }));
}

async function fetchAllCourses(login, site = SITE_TG, result = null, initialPage = null) {
  if (Array.isArray(site?.courses) && site.courses.length > 0) {
    return getConfiguredCourses(site);
  }

  const allCourses = [];
  let page = 1;
  let totalCount = null;
  let initialRaw = initialPage?.raw || null;

  while (page <= 10) {
    const url = buildCoursesUrl(page, login, site);
    let raw;

    if (page === 1 && initialRaw) {
      raw = initialRaw;
      initialRaw = null;
      logInfo(`复用已通过 TG 就绪检查的课堂列表 ${site.name} page=1`);
    } else {
      logInfo(`请求课堂列表 ${site.name} page=${page}`);
      raw = await fetchJson(url, site, {}, `${site.name} 课程列表 page=${page}`);
    }

    const list = parseCourseList(raw);

    if (!raw || !hasRecognizedCourseList(raw, list)) {
      throw createCourseListStructureError(raw, site, url);
    }

    if (result && !(page === 1 && initialPage?.requestLogged)) {
      pushRequestLog(result, {
        ...getRequestLogBase(raw, site, "course_list"),
        rawCount: list.length,
        page
      });
    }

    if (typeof raw?.total_count === "number") totalCount = raw.total_count;
    allCourses.push(...list);

    if (list.length < COURSE_PAGE_SIZE) break;
    if (totalCount !== null && allCourses.length >= totalCount) break;

    page++;
    await sleep(REQUEST_INTERVAL_MS);
  }

  const normalizedCourses = allCourses.map(course => normalizeCourse(course, site));
  return await filterCoursesByCurrentSemester(normalizedCourses, result, site);
}

async function fetchExercises(courseId, login, site = SITE_TG) {
  const raw = await fetchJson(buildExercisesUrl(courseId, login, site), site, {}, `${site.name} 考试/小测试列表`);
  if (!raw || !Array.isArray(raw.exercises)) {
    const error = new Error(`考试列表返回结构异常：${site.name}`);
    error.detail = getJsonMeta(raw) || {};
    throw error;
  }
  return {
    raw,
    exams: raw.exercises,
    meta: getJsonMeta(raw)
  };
}

async function fetchExerciseUser(courseId, exerciseId, login, site = SITE_TG) {
  const raw = await fetchJson(buildExerciseUsersUrl(courseId, exerciseId, login, site), site, {}, `${site.name} 考试用户状态`);
  return {
    raw,
    user: raw?.current_answer_user || raw?.data?.current_answer_user || null,
    totalScore: raw?.total_score ?? raw?.data?.total_score ?? "--",
    meta: getJsonMeta(raw)
  };
}

async function fetchExerciseCommonHeader(courseIdentifier, exerciseId, login, site = SITE_TG) {
  const raw = await fetchJson(buildExerciseCommonHeaderUrl(courseIdentifier, exerciseId, login, site), site, {}, `${site.name} 考试头部信息`);
  return {
    raw,
    record:
      (Array.isArray(raw?.simulate_exercise_records) && raw.simulate_exercise_records[0]) ||
      (Array.isArray(raw?.data?.simulate_exercise_records) && raw.data.simulate_exercise_records[0]) ||
      null,
    totalScore: raw?.total_score ?? raw?.data?.total_score ?? "--",
    meta: getJsonMeta(raw)
  };
}

function buildHomeworkCommonsByTypeUrl(courseIdentifier, login, type, site = SITE_TG) {
  const apiOrigin = getApiOrigin(site);
  return (
    `${apiOrigin}/api/courses/${encodeURIComponent(courseIdentifier)}/homework_commons.json` +
    `?limit=${HOMEWORK_LIMIT}` +
    `&status=0` +
    `&id=${encodeURIComponent(courseIdentifier)}` +
    `&type=${encodeURIComponent(type)}` +
    `&sort_by=updated_at` +
    `&sort_direction=asc` +
    `&order=0` +
    `&zzud=${encodeURIComponent(login)}` +
    `&_t=${Date.now()}`
  );
}

async function fetchHomeworkCommonsByType(courseResult, login, type) {
  const courseIdentifier = courseResult.courseIdentifier;
  if (!courseIdentifier) return [];

  const siteName = type === 1 ? courseResult.site?.name : courseResult.siteName || "站点";
  const requestLabel = type === 1 ? `${siteName} 图文作业列表` : `${siteName} 实验/图文作业分类列表`;
  const data = await fetchJson(buildHomeworkCommonsByTypeUrl(courseIdentifier, login, type, courseResult.site), courseResult.site, {}, requestLabel);
  if (!data || !Array.isArray(data.homeworks)) {
    const errorContext = type === 1 ? siteName : `${siteName} / ${courseResult.courseName}`;
    const error = new Error(`homework_commons type=${type} 返回结构异常：${errorContext}`);
    error.detail = getJsonMeta(data) || {};
    throw error;
  }
  return {
    raw: data,
    list: data.homeworks,
    meta: getJsonMeta(data)
  };
}

function createExerciseTask(course, exam, user, totalScore, parsed, login) {
  const exerciseId = exam.id;

  return {
    taskType: "exercise",
    taskTypeText: "考试/小测试",
    siteKey: course.siteKey,
    siteName: course.siteName,

    courseId: course.courseId,
    courseIdentifier: course.courseIdentifier,
    courseName: course.courseName,

    exerciseId,
    title: normalizeText(exam.exercise_name || exam.name || exam.title || "未识别考试名"),
    detailUrl: buildExerciseDetailUrl(course.courseIdentifier, exerciseId, login, course.site),

    deadlineRemaining: exam.exercise_left_time || exam.deadlineRemaining || "--",
    exerciseLeftTime: exam.exercise_left_time || "",
    durationMinutes: exam.time ?? null,

    exerciseStatus: exam.exercise_status ?? null,
    currentStatus: exam.current_status ?? null,
    wholeExerciseStatus: exam.whole_exercise_status ?? null,
    exerciseUserId: exam.exercise_user_id ?? user?.exercise_user_id ?? null,
    startAt: user?.start_at || null,
    endAt: user?.end_at || null,
    submitAt: user?.end_at || null,
    score: user?.score ?? "--",
    totalScore,

    objectiveScore: user?.objective_score ?? "--",
    subjectiveScore: user?.subjective_score ?? "--",
    reviewStatus: user?.review_status ?? false,
    isForceCommit: user?.is_force_commit ?? false,
    userName: user?.user_name || "",
    studentId: user?.student_id || "",

    ...parsed,

    scanTime: new Date().toLocaleString(),
    raw: {
      exam,
      user
    }
  };
}

async function scanExercisesForCourse(course, result, courseResult, login) {
  const courseApiId = getCourseApiId(course);
  const exerciseProgressCourseId = course.courseIdentifier || courseApiId;
  const isTgSite = course.site?.key === "tg" || course.siteKey === "tg";

  if (!courseApiId) {
    const warning = {
      stage: "course",
      courseName: course.courseName,
      message: "未识别课程 API ID，跳过考试/小测试扫描",
      course: course.raw
    };

    result.warnings.push(warning);
    logWarn(warning.message, course.courseName);
    return;
  }

  try {
    const { raw, exams } = await fetchExercises(courseApiId, login, course.site);
    pushRequestLog(result, {
      ...getRequestLogBase(raw, course.site, "exercise_list", courseResult),
      rawCount: exams.length
    });
    logInfo(`课堂 ${course.courseName} 考试数量：${exams.length}`);

    if (FAST_MODE_SKIP_EXERCISE_USER_DETAIL && !isTgSite) {
      for (const exam of exams) {
        const exerciseId = exam.id;

        if (!exerciseId) {
          result.errors.push({
            stage: "exam",
            siteKey: course.siteKey,
            siteName: course.siteName,
            courseId: course.courseId,
            courseName: course.courseName,
            message: "未识别 exerciseId",
            exam
          });
          continue;
        }

        const parsed = parseExerciseFromListOnly(exam);
        const task = createExerciseTask(course, exam, null, "--", parsed, login);
        courseResult.exams.push(task);
        result.tasks.push(task);
      }

      return;
    }

    const examResults = await mapLimit(exams, EXERCISE_USER_CONCURRENCY, async exam => {
      const examLocalResult = createCourseLocalResult();
      const exerciseId = exam.id;
      const title = normalizeText(exam.exercise_name || exam.name || exam.title || "未识别考试名");

      if (!exerciseId) {
        return {
          task: null,
          errors: [{
            stage: "exam",
            siteKey: course.siteKey,
            siteName: course.siteName,
            courseId: course.courseId,
            courseName: course.courseName,
            message: "未识别 exerciseId",
            exam
          }],
          warnings: [],
          debug: examLocalResult.debug
        };
      }

      let user = null;
      let totalScore = "--";
      let parsed = {};
      let exerciseUsersJson = null;
      let userFetchError = null;
      let commonHeaderJson = null;
      let commonHeaderFetchError = null;

      try {
        const userResult = await fetchExerciseUser(exerciseProgressCourseId, exerciseId, login, course.site);
        exerciseUsersJson = userResult.raw;
        user = userResult.user;
        totalScore = userResult.totalScore;
        pushRequestLog(examLocalResult, {
          ...getRequestLogBase(userResult.raw, course.site, "exercise_user", courseResult),
          exerciseId,
          ok: true
        });
      } catch (err) {
        userFetchError = err;
        pushFailedRequestLog(examLocalResult, course.site, "exercise_user", courseResult, err);
      }

      const shouldFetchCommonHeader = isTgSite && getErrorKind(userFetchError) !== "login_required" && (
        userFetchError ||
        !user ||
        user?.commit_status === undefined ||
        user?.commit_status === null ||
        user?.score === undefined ||
        user?.score === null ||
        user?.score === ""
      );

      if (shouldFetchCommonHeader && exerciseProgressCourseId) {
        try {
          const commonHeaderResult = await fetchExerciseCommonHeader(exerciseProgressCourseId, exerciseId, login, course.site);
          commonHeaderJson = commonHeaderResult.raw;
          if (commonHeaderResult.totalScore !== undefined && commonHeaderResult.totalScore !== null && commonHeaderResult.totalScore !== "") {
            totalScore = commonHeaderResult.totalScore;
          }
          pushRequestLog(examLocalResult, {
            ...getRequestLogBase(commonHeaderResult.raw, course.site, "exercise_common_header", courseResult),
            exerciseId,
            ok: true
          });
        } catch (err) {
          commonHeaderFetchError = err;
          pushFailedRequestLog(examLocalResult, course.site, "exercise_common_header", courseResult, err);
        }
      }

      const loginRequiredError = getErrorKind(userFetchError) === "login_required"
        ? userFetchError
        : getErrorKind(commonHeaderFetchError) === "login_required"
          ? commonHeaderFetchError
          : null;

      if (loginRequiredError) {
        const stage = loginRequiredError === userFetchError ? "exercise_user" : "exercise_common_header";
        return {
          task: null,
          errors: [withErrorKind({
            stage,
            siteKey: course.siteKey,
            siteName: course.siteName,
            courseId: course.courseId,
            courseName: course.courseName,
            exerciseId,
            title,
            error: loginRequiredError.message || String(loginRequiredError)
          }, loginRequiredError)],
          warnings: examLocalResult.warnings,
          debug: examLocalResult.debug
        };
      }

      if (isTgSite) {
        parsed = parseExercisePersonalProgress(exam, exerciseUsersJson, commonHeaderJson);
      } else {
        parsed = parseExerciseCommitStatus(user);
      }

      if (parsed.totalScore !== undefined && parsed.totalScore !== null && parsed.totalScore !== "") {
        totalScore = parsed.totalScore;
      }

      if (userFetchError && !commonHeaderJson) {
        examLocalResult.errors.push(withErrorKind({
          stage: "exercise_user",
          siteKey: course.siteKey,
          siteName: course.siteName,
          courseId: course.courseId,
          courseName: course.courseName,
          exerciseId,
          title,
          error: String(userFetchError)
        }, userFetchError));
      }

      if (commonHeaderFetchError && !exerciseUsersJson) {
        examLocalResult.errors.push(withErrorKind({
          stage: "exercise_common_header",
          siteKey: course.siteKey,
          siteName: course.siteName,
          courseId: course.courseId,
          courseName: course.courseName,
          exerciseId,
          title,
          error: String(commonHeaderFetchError)
        }, commonHeaderFetchError));
      }

      const task = createExerciseTask(course, exam, user, totalScore, parsed, login);
      if (isTgSite) {
        console.log("[TG考试个人进度] exerciseId=", exerciseId);
        console.log("[TG考试个人进度] exerciseUsers=", exerciseUsersJson);
        console.log("[TG考试个人进度] current_answer_user=", user);
        console.log("[TG考试个人进度] parsed=", {
          examFinalStatus: task.examFinalStatus,
          examStatusLabel: task.examStatusLabel,
          submitted: task.submitted,
          canRetry: task.canRetry,
          submitStatusText: task.submitStatusText,
          score: task.score,
          totalScore: task.totalScore,
          startAt: task.startAt,
          submitAt: task.submitAt,
          progressSource: task.progressSource
        });
      }
      await sleep(REQUEST_INTERVAL_MS);

      return {
        task,
        errors: examLocalResult.errors,
        warnings: examLocalResult.warnings,
        debug: examLocalResult.debug
      };
    });

    for (const item of examResults) {
      if (!item) continue;

      if (item.__error) {
        const exam = item.__item || {};
        const exerciseId = exam.id;
        result.errors.push(withErrorKind({
          stage: "exercise_user",
          siteKey: course.siteKey,
          siteName: course.siteName,
          courseId: course.courseId,
          courseName: course.courseName,
          exerciseId,
          title: normalizeText(exam.exercise_name || exam.name || exam.title || "未识别考试名"),
          error: item.__error?.message || String(item.__error),
          stack: item.__error?.stack || ""
        }, item.__error));
        continue;
      }

      result.errors.push(...(item.errors || []));
      result.warnings.push(...(item.warnings || []));
      mergeCourseDebug(result.debug, item.debug);

      if (item.task) {
        courseResult.exams.push(item.task);
        result.tasks.push(item.task);
      }
    }
  } catch (err) {
    pushFailedRequestLog(result, course.site, "exercise_list", courseResult, err);
    result.errors.push(withErrorKind({
      stage: "exercises",
      siteKey: course.siteKey,
      siteName: course.siteName,
      courseId: course.courseId,
      courseName: course.courseName,
      error: String(err)
    }, err));
  }
}

async function scanCommonHomeworksForCourse(course, result, courseResult, login) {
  if (!course.courseIdentifier) {
    const warning = {
      stage: "homework_commons",
      courseId: course.courseId,
      courseName: course.courseName,
      message: "未识别课堂短 ID，跳过图文作业扫描",
      course: course.raw
    };

    result.warnings.push(warning);
    result.debug.homeworkScan.push({
      courseName: course.courseName,
      courseId: course.courseId,
      courseIdentifier: course.courseIdentifier,
      status: "skipped",
      reason: "missing_course_identifier",
      homeworkListCount: 0,
      homeworkIds: [],
      parsedHomeworkCount: courseResult.homeworks.length
    });
    logWarn(warning.message, course.courseName);
    return;
  }

  try {
    const listData = await fetchHomeworkCommonsByType(courseResult, login, 1);
    const homeworkItems = listData.list;
    pushRequestLog(result, {
      ...getRequestLogBase(listData.raw, course.site, "homework_commons_1", courseResult),
      rawCount: homeworkItems.length
    });

    logInfo(`课堂 ${course.courseName} 图文作业数量：${homeworkItems.length}`);

    const parsedListTasks = homeworkItems.map(item => {
      const task = parseCommonHomeworkFromListItem(courseResult, item);
      task.detailUrl = buildHomeworkDetailUrl(course.courseIdentifier, task.homeworkId, course.site);
      return task;
    });

    for (const task of parsedListTasks) {
      courseResult.homeworks.push(task);
      result.tasks.push(task);
    }

    result.debug.homeworkScan.push({
      courseName: course.courseName,
      courseId: course.courseId,
      courseIdentifier: course.courseIdentifier,
      status: "success",
      homeworkListCount: homeworkItems.length,
      homeworkIds: homeworkItems.map(x => x?.homework_id || x?.id),
      parsedHomeworkCount: parsedListTasks.length,
      source: "homework_commons_list"
    });
  } catch (err) {
    pushFailedRequestLog(result, course.site, "homework_commons_1", courseResult, err);
    result.errors.push(withErrorKind({
      stage: "homework_commons",
      siteKey: course.siteKey,
      siteName: course.siteName,
      courseId: course.courseId,
      courseIdentifier: course.courseIdentifier,
      courseName: course.courseName,
      error: String(err)
    }, err));

    result.debug.homeworkScan.push({
      courseName: course.courseName,
      courseId: course.courseId,
      courseIdentifier: course.courseIdentifier,
      status: "failed",
      error: String(err),
      homeworkListCount: 0,
      homeworkIds: [],
      parsedHomeworkCount: courseResult.homeworks.length
    });
  }
}

async function scanClassroomExperimentsForCourse(courseResult, result, login) {
  result.debug = result.debug || {};
  result.debug.experimentScan = result.debug.experimentScan || [];

  if (!courseResult.courseIdentifier) {
    result.debug.experimentScan.push({
      courseId: courseResult.courseId,
      courseIdentifier: courseResult.courseIdentifier,
      courseName: courseResult.courseName,
      status: "skipped",
      reason: "missing_course_identifier",
      count: 0
    });
    return;
  }

  try {
    const experimentResult = await fetchHomeworkCommonsByType(courseResult, login, 4);
    const experimentList = experimentResult.list;
    pushRequestLog(result, {
      ...getRequestLogBase(experimentResult.raw, courseResult.site, "homework_commons_4", courseResult),
      rawCount: experimentList.length
    });
    const experiments = experimentList.map(item =>
      parseClassroomExperimentFromListItem(courseResult, item)
    );

    courseResult.experiments = experiments;

    for (const task of experiments) {
      result.tasks.push(task);
    }

    result.debug.experimentScan.push({
      courseId: courseResult.courseId,
      courseIdentifier: courseResult.courseIdentifier,
      courseName: courseResult.courseName,
      status: "success",
      count: experiments.length,
      rawCount: experimentList.length
    });
  } catch (error) {
    pushFailedRequestLog(result, courseResult.site, "homework_commons_4", courseResult, error);
    courseResult.experiments = [];

    result.errors.push(withErrorKind({
      stage: "classroom_experiment",
      siteKey: courseResult.siteKey,
      siteName: courseResult.siteName,
      courseId: courseResult.courseId,
      courseIdentifier: courseResult.courseIdentifier,
      courseName: courseResult.courseName,
      message: error?.message || String(error)
    }, error));

    result.debug.experimentScan.push({
      courseId: courseResult.courseId,
      courseIdentifier: courseResult.courseIdentifier,
      courseName: courseResult.courseName,
      status: "failed",
      error: error?.message || String(error),
      stack: error?.stack || ""
    });
  }
}

function parseDateSafe(value) {
  if (!value) return null;

  const text = String(value).trim();
  if (!text || text === "--") return null;

  const d = new Date(text.replace(/-/g, "/"));
  if (Number.isNaN(d.getTime())) return null;

  return d;
}

function getTaskDeadlineDate(task) {
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
    const d = parseDateSafe(value);
    if (d) return d;
  }

  return null;
}

function getDaysUntilDeadline(deadline, now = new Date()) {
  if (!deadline) return null;
  return (deadline.getTime() - now.getTime()) / 86400000;
}

function parseChineseRemainingTimeToDays(value) {
  if (!value) return null;

  const text = String(value)
    .replace(/\s+/g, " ")
    .trim();

  if (!text || text === "--") return null;

  let days = 0;
  let hours = 0;
  let minutes = 0;

  const dayMatch = text.match(/(\d+)\s*天/);
  const hourMatch = text.match(/(\d+)\s*小时/);
  const minuteMatch = text.match(/(\d+)\s*分/);

  if (dayMatch) days = Number(dayMatch[1]);
  if (hourMatch) hours = Number(hourMatch[1]);
  if (minuteMatch) minutes = Number(minuteMatch[1]);

  if (!dayMatch && !hourMatch && !minuteMatch) {
    return null;
  }

  return days + hours / 24 + minutes / 1440;
}

function getTaskRemainingDays(task, now = new Date()) {
  const remainingMs = Number(task?.remainingMs ?? task?.raw?.remainingMs);
  if (Number.isFinite(remainingMs)) {
    return remainingMs / 86400000;
  }

  const deadlineTimestamp = Number(task?.deadlineTimestamp ?? task?.raw?.deadlineTimestamp);
  if (Number.isFinite(deadlineTimestamp) && deadlineTimestamp > 0) {
    const normalizedTimestamp = deadlineTimestamp < 10000000000 ? deadlineTimestamp * 1000 : deadlineTimestamp;
    return (normalizedTimestamp - now.getTime()) / 86400000;
  }

  const deadline = getTaskDeadlineDate(task);

  if (deadline) {
    const days = getDaysUntilDeadline(deadline, now);
    if (days !== null) return days;
  }

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
    const days = parseChineseRemainingTimeToDays(value);
    if (days !== null) return days;
  }

  return null;
}

function isDangerTask(task, now = new Date(), remainingDays = undefined) {
  if (!task) return false;
  if (task.completed || task.submitted) return false;
  if (task?.ended) return false;

  const daysLeft = remainingDays === undefined
    ? getTaskRemainingDays(task, now)
    : remainingDays;

  if (daysLeft !== null) {
    if (daysLeft < 0) return false;
    if (daysLeft <= DANGER_DAYS_THRESHOLD) return true;
  }

  return false;
}

function enrichTaskDangerMeta(task, now = new Date()) {
  const deadline = getTaskDeadlineDate(task);
  const daysLeft = getTaskRemainingDays(task, now);
  const danger = isDangerTask(task, now, daysLeft);
  const dangerDaysLeft = daysLeft === null ? null : Math.max(0, Math.ceil(daysLeft));

  return {
    ...task,
    danger,
    isDanger: danger,
    dangerDaysLeft,
    dangerDeadline: deadline ? deadline.toLocaleString() : "",
    dangerReason: danger
      ? `距离截止还有 ${dangerDaysLeft} 天`
      : ""
  };
}

function enrichResultDangerMeta(result, now = new Date()) {
  result.tasks = (result.tasks || []).map(task => enrichTaskDangerMeta(task, now));

  for (const course of result.courses || []) {
    if (Array.isArray(course.exams)) {
      course.exams = course.exams.map(task => enrichTaskDangerMeta(task, now));
    }

    if (Array.isArray(course.homeworks)) {
      course.homeworks = course.homeworks.map(task => enrichTaskDangerMeta(task, now));
    }

    if (Array.isArray(course.experiments)) {
      course.experiments = course.experiments.map(task => enrichTaskDangerMeta(task, now));
    }
  }

  return result;
}

function logDangerStats(result) {
  logInfo("危险任务统计", {
    dangerThresholdDays: DANGER_DAYS_THRESHOLD,
    dangerCount: result.summary?.dangerCount || 0,
    dangerTasks: (result.tasks || [])
      .filter(task => task.danger || task.isDanger)
      .map(task => ({
        courseName: task.courseName,
        title: task.title,
        taskType: task.taskType,
        statusText: task.statusText,
        deadlineRemaining: task.deadlineRemaining,
        exerciseLeftTime: task.exerciseLeftTime,
        dangerDaysLeft: task.dangerDaysLeft,
        dangerReason: task.dangerReason
      }))
  });
}

function hasCompleteDangerMeta(task) {
  return typeof task?.danger === "boolean" &&
    typeof task?.isDanger === "boolean" &&
    Object.prototype.hasOwnProperty.call(task, "dangerDaysLeft") &&
    Object.prototype.hasOwnProperty.call(task, "dangerDeadline") &&
    Object.prototype.hasOwnProperty.call(task, "dangerReason");
}

function getTaskDangerValue(task, now = new Date()) {
  if (task?.danger === true || task?.isDanger === true) return true;
  if (hasCompleteDangerMeta(task)) return false;
  return isDangerTask(task, now);
}

function sortTasks(tasks, now = new Date()) {
  const decoratedTasks = tasks.map(task => ({
    task,
    priority: getTaskDangerValue(task, now)
      ? 1
      : !task.completed && task.ended
        ? 2
        : !task.completed
          ? 3
          : 5,
    deadline: getTaskDeadlineDate(task)
  }));

  return decoratedTasks.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;

    const da = a.deadline;
    const db = b.deadline;

    if (da && db) return da.getTime() - db.getTime();
    if (da) return -1;
    if (db) return 1;

    return 0;
  }).map(item => item.task);
}

function summarizeResult(result, now = new Date()) {
  const tasks = result.tasks || [];
  const exerciseCount = tasks.filter(task => task.taskType === "exercise").length;
  const homeworkCount = tasks.filter(task => task.taskType === "common_homework").length;
  const experimentCount = tasks.filter(task => task.taskType === "classroom_experiment").length;
  const completedCount = tasks.filter(task => task.completed).length;
  const unfinishedCount = tasks.filter(task => !task.completed).length;
  const runningCount = tasks.filter(task => String(task.statusText || "").includes("进行中") || String(task.statusText || "").includes("考试中")).length;
  const dangerCount = tasks.filter(task => getTaskDangerValue(task, now)).length;

  return {
    courseCount: result.courses.length,
    taskCount: tasks.length,
    examCount: exerciseCount,
    exerciseCount,
    homeworkCount,
    experimentCount,
    completedCount,
    unfinishedCount,
    runningCount,
    dangerCount,
    errorCount: result.errors.length,
    warningCount: result.warnings.length
  };
}

function createCourseLocalResult() {
  return {
    courses: [],
    tasks: [],
    errors: [],
    warnings: [],
    debug: {
      homeworkScan: [],
      experimentScan: [],
      requestLog: [],
      courseScanFlow: []
    }
  };
}

function mergeCourseDebug(targetDebug, sourceDebug) {
  if (!sourceDebug || typeof sourceDebug !== "object") return;

  for (const key of ["homeworkScan", "experimentScan", "requestLog", "courseScanFlow"]) {
    if (!Array.isArray(sourceDebug[key]) || !sourceDebug[key].length) continue;
    targetDebug[key] = targetDebug[key] || [];
    targetDebug[key].push(...sourceDebug[key]);
  }
}

async function scanOneCourse(coursePair, index, courses, login, requestId) {
  const { site, siteLogin, course } = coursePair;
  const localResult = createCourseLocalResult();
  const courseResult = {
    courseId: course.courseId,
    courseIdentifier: course.courseIdentifier,
    courseName: course.courseName,
    site,
    siteKey: site.key,
    siteName: site.name,
    pageOrigin: site.pageOrigin,
    apiOrigin: site.apiOrigin,
    login: siteLogin,
    exams: [],
    homeworks: [],
    experiments: [],
    raw: course.raw
  };

  try {
    logInfo(`扫描课堂：${site.name} / ${course.courseName} / courseId=${course.courseId || "--"} / courseIdentifier=${course.courseIdentifier || "--"}`);
    pushCourseScanFlow(localResult, site, courseResult, "before_scan_course_tasks");

    const sections = [
      {
        name: "exercises",
        afterStep: "after_scan_exams",
        run: () => scanExercisesForCourse(course, localResult, courseResult, siteLogin)
      },
      {
        name: "experiments",
        afterStep: "after_scan_experiments",
        run: () => scanClassroomExperimentsForCourse(courseResult, localResult, siteLogin)
      },
      {
        name: "homeworks",
        afterStep: "after_scan_homeworks",
        run: () => scanCommonHomeworksForCourse(course, localResult, courseResult, siteLogin)
      }
    ];

    const activeSections = sections.slice(0, COURSE_SECTION_CONCURRENCY);
    const sectionResults = await Promise.allSettled(activeSections.map(async section => {
      await section.run();
      pushCourseScanFlow(localResult, site, courseResult, section.afterStep);
      return section.name;
    }));

    sectionResults.forEach((sectionResult, sectionIndex) => {
      if (sectionResult.status !== "rejected") return;

      const section = activeSections[sectionIndex] || {};
      localResult.errors.push(withErrorKind({
        stage: `course_section:${section.name || "unknown"}`,
        siteKey: site.key,
        siteName: site.name,
        courseId: course.courseId,
        courseIdentifier: course.courseIdentifier,
        courseName: course.courseName,
        error: sectionResult.reason?.message || String(sectionResult.reason),
        stack: sectionResult.reason?.stack || ""
      }, sectionResult.reason));
    });

    pushCourseScanFlow(localResult, site, courseResult, "after_push_tasks");
  } catch (err) {
    localResult.errors.push(withErrorKind({
      stage: "course",
      siteKey: site.key,
      siteName: site.name,
      courseId: course.courseId,
      courseIdentifier: course.courseIdentifier,
      courseName: course.courseName,
      error: err?.message || String(err),
      stack: err?.stack || ""
    }, err));
  }

  await sleep(Math.min(COURSE_INTERVAL_MS, 100));

  return {
    index,
    site,
    siteLogin,
    course,
    courseResult,
    tasks: localResult.tasks,
    errors: localResult.errors,
    warnings: localResult.warnings,
    debug: localResult.debug,
    requestId,
    total: courses.length
  };
}

function formatErrorForStorage(err, stage) {
  const isHtmlInsteadOfJson = isNotJsonError(err);
  const detail = err?.detail || null;
  const errorKind = getErrorKind(err);

  return {
    time: new Date().toLocaleString(),
    message: errorKind === "login_required"
      ? "TG 未登录，请先登录后刷新"
      : isHtmlInsteadOfJson
      ? "\u63a5\u53e3\u8fd4\u56de\u7684\u4e0d\u662f JSON\uff0c\u53ef\u80fd\u662f\u9996\u6b21\u6253\u5f00\u6d4f\u89c8\u5668\u65f6\u9875\u9762\u672a\u5c31\u7eea\u3002\u5df2\u81ea\u52a8\u91cd\u8bd5\uff1a\u7b2c 3 \u6b21 / \u5171 3 \u6b21\u3002\u53ef\u70b9\u51fb\u201c\u8bf7\u6c42\u5237\u65b0\u201d\u624b\u52a8\u91cd\u8bd5\u3002"
      : (err?.message || String(err)),
    stack: err?.stack || "",
    stage: stage || "unknown",
    ...(errorKind ? { errorKind } : {}),
    retryAttempt: isHtmlInsteadOfJson ? JSON_RETRY_TOTAL : detail?.retryAttempt,
    retryTotal: isHtmlInsteadOfJson ? JSON_RETRY_TOTAL : detail?.retryTotal,
    requestFailureClass: detail?.requestFailureClass || null,
    retryExhausted: detail?.retryExhausted === true,
    durationMs: detail?.durationMs ?? null,
    detail
  };
}

async function scanAll(refreshRequest = null) {
  if (scanInProgress) {
    await writeRefreshStatus("running", 18, "\u540e\u53f0\u5df2\u6709\u626b\u63cf\u6b63\u5728\u8fd0\u884c", { requestId: (currentRefreshRequest || refreshRequest)?.requestId });
    return null;
  }

  scanInProgress = true;
  await writeRefreshStatus("running", 12, "\u6b63\u5728\u51c6\u5907\u5237\u65b0", { requestId: (currentRefreshRequest || refreshRequest)?.requestId });
  currentRefreshRequest = refreshRequest || currentRefreshRequest;
  const startedAt = new Date();
  const startTime = startedAt.toLocaleString();
  const scanSites = getScanSites(refreshRequest);
  const primarySite = scanSites[0] || SITE_TG;
  let login = "";
  let currentStage = "init";
  let totalCourses = 0;

  await markRefreshRequestHandledIfNeeded();
  await writeRefreshStatus("running", 18, "\u6b63\u5728\u83b7\u53d6\u8bfe\u7a0b\u5217\u8868", { requestId: (currentRefreshRequest || refreshRequest)?.requestId });

  await setValue(STORE_KEY_LAST_RUNNING, {
    ...getRuntimeScope(primarySite, currentRefreshRequest || refreshRequest),
    running: true,
    startTime,
    timestamp: startedAt.getTime(),
    stage: "fetch_courses",
    stageText: "正在获取课程列表",
    current: 0,
    total: 0,
    percent: 5
  });
  await setValue(STORE_KEY_LAST_ERROR, null);

  try {
    currentStage = "getCurrentLogin";
    login = primarySite.key === "educoder" ? primarySite.login : await getCurrentLogin();
  } catch (err) {
    const message = err?.message || String(err);

    await setValue(STORE_KEY_LAST_ERROR, {
      ...getRuntimeScope(primarySite, currentRefreshRequest || refreshRequest),
      time: startTime,
      message,
      stack: err?.stack || "",
      stage: "getCurrentLogin"
    });
    await setValue(STORE_KEY_LAST_RUNNING, {
      ...getRuntimeScope(primarySite, currentRefreshRequest || refreshRequest),
      running: false,
      endTime: new Date().toLocaleString(),
      timestamp: Date.now(),
      stage: "failed",
      stageText: "扫描失败",
      current: 0,
      total: 0,
      percent: 100
    });

    await writeRefreshStatus("error", 100, "\u5237\u65b0\u5931\u8d25", { requestId: (currentRefreshRequest || refreshRequest)?.requestId, error: message });
    scanInProgress = false;
    logError(message);
    return null;
  }

  const result = {
    login,
    currentSite: {
      key: primarySite.key,
      name: primarySite.name,
      pageOrigin: primarySite.pageOrigin,
      apiOrigin: primarySite.apiOrigin
    },
    sites: scanSites.map(site => ({
      key: site.key,
      name: site.name,
      pageOrigin: site.pageOrigin,
      apiOrigin: site.apiOrigin,
      login: site.key === "tg" ? login : site.login
    })),
    scanTime: startTime,
    scanTimestamp: startedAt.getTime(),
    source: "scriptcat-background",
    courses: [],
    tasks: [],
    errors: [],
    warnings: [],
    debug: {
      homeworkScan: [],
      experimentScan: [],
      siteLogin: [],
      siteScan: [],
      requestLog: [],
      courseScanFlow: [],
      loginSource: {
        manualLoginConfigured: Boolean(String(MANUAL_LOGIN || "").trim()),
        autoLoginFromStorage: String(GM_getValue(STORE_KEY_AUTO_LOGIN, "") || "").trim(),
        resolvedLogin: login,
        educoderLogin: SITE_EDUCODER.login,
        activeSiteKey: primarySite.key
      }
    },
    summary: {
      courseCount: 0,
      taskCount: 0,
      examCount: 0,
      exerciseCount: 0,
      homeworkCount: 0,
      experimentCount: 0,
      completedCount: 0,
      unfinishedCount: 0,
      runningCount: 0,
      dangerCount: 0,
      errorCount: 0,
      warningCount: 0
    }
  };

  logInfo("开始扫描");
  logInfo(
    "全并发极限模式：",
    `ULTRA_ALL_IN_MODE = ${ULTRA_ALL_IN_MODE}`,
    `COURSE_CONCURRENCY = ${COURSE_CONCURRENCY}`,
    `COURSE_SECTION_CONCURRENCY = ${COURSE_SECTION_CONCURRENCY}`,
    `EXERCISE_USER_CONCURRENCY = ${EXERCISE_USER_CONCURRENCY}`,
    `FAST_MODE_SKIP_EXERCISE_USER_DETAIL = ${FAST_MODE_SKIP_EXERCISE_USER_DETAIL}`,
    `REQUEST_INTERVAL_MS = ${REQUEST_INTERVAL_MS}`,
    `COURSE_INTERVAL_MS = ${COURSE_INTERVAL_MS}`
  );

  try {
    currentStage = "courses";
    const siteCoursePairs = [];
    const siteScanMap = new Map();

    for (const site of scanSites) {
      const siteLogin = site.key === "tg" ? login : site.login;
      const siteScan = {
        siteKey: site.key,
        siteName: site.name,
        login: siteLogin,
        loginOk: false,
        status: "success",
        courseSource: Array.isArray(site?.courses) && site.courses.length > 0 ? "configured" : "api",
        courseCount: 0,
        taskCount: 0,
        error: ""
      };

      siteScanMap.set(site.key, siteScan);
      result.debug.siteScan.push(siteScan);

      let tgReadyPage = null;
      try {
        if (isTgSite(site)) {
          tgReadyPage = await waitForTgReadyAndFetchCourses(
            siteLogin,
            { ...site, login: siteLogin },
            result,
            currentRefreshRequest || refreshRequest
          );
          siteScan.loginOk = true;
          const loginCheck = {
            ok: true,
            siteKey: site.key,
            siteName: site.name,
            login: siteLogin,
            request: tgReadyPage.request
          };
          result.debug.siteLogin.push({
            ...loginCheck,
            request: undefined
          });
          if (loginCheck.request) {
            pushRequestLog(result, loginCheck.request);
          }
        } else {
          const loginCheck = await checkSiteLogin({ ...site, login: siteLogin });
          siteScan.loginOk = true;
          result.debug.siteLogin.push({
            ...loginCheck,
            request: undefined
          });
          if (loginCheck.request) {
            pushRequestLog(result, loginCheck.request);
          }
        }
      } catch (error) {
        const message = error?.message || String(error);
        siteScan.status = "login_failed";
        siteScan.error = message;

        result.debug.siteLogin.push(withErrorKind({
          ok: false,
          siteKey: site.key,
          siteName: site.name,
          login: siteLogin,
          error: message
        }, error));

        result.errors.push(withErrorKind({
          stage: "site_login_check",
          siteKey: site.key,
          siteName: site.name,
          message
        }, error));

        pushFailedRequestLog(result, site, "site_login_check", null, error);
        continue;
      }

      let courses = [];
      try {
        courses = await fetchAllCourses(siteLogin, site, result, tgReadyPage ? {
          raw: tgReadyPage.raw,
          requestLogged: true
        } : null);
      } catch (error) {
        const message = error?.message || String(error);
        siteScan.status = "request_failed";
        siteScan.error = message;

        result.errors.push(withErrorKind({
          stage: "site_courses",
          siteKey: site.key,
          siteName: site.name,
          message
        }, error));

        pushFailedRequestLog(result, site, "course_list", null, error);
        continue;
      }

      siteScan.courseCount = courses.length;

      for (const course of courses) {
        siteCoursePairs.push({ site, siteLogin, course });
      }
    }

    const courses = siteCoursePairs.map(item => item.course);
    totalCourses = courses.length;
    logInfo(`识别到课堂数量：${courses.length}`);
    logInfo(
      "全并发极限模式课程规模：",
      `预计课程数 = ${courses.length}`,
      `预计课程分类请求数约 = ${courses.length * COURSE_SECTION_CONCURRENCY}`
    );

    let completedCourses = 0;
    const requestId = (currentRefreshRequest || refreshRequest)?.requestId;

    await writeRefreshStatus("running", 18, "正在准备全并发扫描", { requestId, totalCourses: courses.length });
    await writeRefreshStatus("running", 35, "正在全并发扫描课程", { requestId, totalCourses: courses.length });

    const runCourseScan = async (coursePair, index) => {
      currentStage = `course:${coursePair.course.courseName || coursePair.course.courseId || "unknown"}`;

      try {
        return await scanOneCourse(coursePair, index, courses, login, requestId);
      } finally {
        completedCourses += 1;
        const percent = Math.max(35, Math.min(95, Math.round((completedCourses / Math.max(courses.length, 1)) * 90)));

        await setValue(STORE_KEY_LAST_RUNNING, {
          ...getRuntimeScope(primarySite, currentRefreshRequest || refreshRequest),
          running: true,
          startTime,
          timestamp: Date.now(),
          stage: "scan_course",
          stageText: `正在扫描课程：${completedCourses}/${courses.length}`,
          current: completedCourses,
          total: courses.length,
          percent
        });

        await writeRefreshStatus("running", percent, `正在扫描课程：${completedCourses}/${courses.length}`, {
          requestId,
          completedCourses,
          totalCourses: courses.length
        });
      }
    };

    const courseScanResults = ULTRA_ALL_IN_MODE
      ? (await Promise.allSettled(siteCoursePairs.map((coursePair, index) => runCourseScan(coursePair, index))))
        .map((settled, index) => settled.status === "fulfilled"
          ? settled.value
          : {
            __error: settled.reason,
            __index: index,
            __item: siteCoursePairs[index]
          })
      : await mapLimit(siteCoursePairs, COURSE_CONCURRENCY, runCourseScan);

    await writeRefreshStatus("running", 92, "正在整理扫描结果", { requestId, totalCourses: courses.length });

    for (const item of courseScanResults) {
      if (!item) continue;

      if (item.__error) {
        const failedPair = item.__item || {};
        const failedCourse = failedPair.course || {};
        const failedSite = failedPair.site || {};
        result.errors.push(withErrorKind({
          stage: "course",
          siteKey: failedSite.key || "",
          siteName: failedSite.name || "",
          courseId: failedCourse.courseId,
          courseIdentifier: failedCourse.courseIdentifier,
          courseName: failedCourse.courseName,
          error: item.__error?.message || String(item.__error),
          stack: item.__error?.stack || ""
        }, item.__error));
        continue;
      }

      if (item.courseResult) {
        result.courses.push(item.courseResult);
      }

      result.tasks.push(...(item.tasks || []));
      result.errors.push(...(item.errors || []));
      result.warnings.push(...(item.warnings || []));
      mergeCourseDebug(result.debug, item.debug);

      const siteScan = siteScanMap.get(item.site?.key);
      if (siteScan) {
        const courseResult = item.courseResult || {};
        const courseTaskCount =
          (courseResult.exams?.length || 0) +
          (courseResult.homeworks?.length || 0) +
          (courseResult.experiments?.length || 0);
        siteScan.taskCount += courseTaskCount;

        if ((item.errors || []).length && siteScan.status === "success") {
          siteScan.status = courseTaskCount > 0 ? "partial_failed" : "request_failed";
          siteScan.error = "部分课程请求失败，请查看 requestLog / errors";
        }
      }
    }

    const dangerNow = new Date();
    enrichResultDangerMeta(result, dangerNow);
    result.tasks = sortTasks(result.tasks, dangerNow);
    result.summary = summarizeResult(result, dangerNow);
    logDangerStats(result);

    const loginRequiredError = result.errors.find(item => item?.errorKind === "login_required");
    if (loginRequiredError) {
      const loginMessage = "TG 未登录，请先登录后刷新";
      await setValue(STORE_KEY_LAST_ERROR, {
        ...formatErrorForStorage({
          errorKind: "login_required",
          message: loginMessage,
          stack: "",
          detail: loginRequiredError
        }, loginRequiredError.stage || "login_required"),
        ...getRuntimeScope(primarySite, currentRefreshRequest || refreshRequest)
      });
      await setValue(STORE_KEY_LAST_RUNNING, {
        ...getRuntimeScope(primarySite, currentRefreshRequest || refreshRequest),
        running: false,
        endTime: new Date().toLocaleString(),
        timestamp: Date.now(),
        stage: "failed",
        stageText: loginMessage,
        current: totalCourses,
        total: totalCourses,
        percent: 100
      });
      await writeRefreshStatus("error", 100, loginMessage, {
        requestId: (currentRefreshRequest || refreshRequest)?.requestId,
        errorKind: "login_required",
        error: loginMessage,
        summary: result.summary
      });
      scanInProgress = false;
      logWarn(loginMessage);
      return result;
    }

    await setValue(getResultStoreKeyForSite(primarySite), result);
    await setValue(STORE_KEY, result);
    await setValue(STORE_KEY_LAST_ERROR, null);
    await setValue(STORE_KEY_LAST_RUNNING, {
      ...getRuntimeScope(primarySite, currentRefreshRequest || refreshRequest),
      running: false,
      endTime: new Date().toLocaleString(),
      timestamp: Date.now(),
      stage: "done",
      stageText: "扫描完成",
      current: totalCourses,
      total: totalCourses,
      percent: 100
    });

    await writeRefreshStatus("done", 100, "\u5237\u65b0\u5b8c\u6210", { requestId: (currentRefreshRequest || refreshRequest)?.requestId, summary: result.summary });
    scanInProgress = false;

    logInfo("scan done", result.summary);
    return result;
  } catch (err) {
    result.errors.push(withErrorKind({
      stage: "main",
      error: String(err)
    }, err));

    const dangerNow = new Date();
    enrichResultDangerMeta(result, dangerNow);
    result.tasks = sortTasks(result.tasks, dangerNow);
    result.summary = summarizeResult(result, dangerNow);
    logDangerStats(result);

    await setValue(STORE_KEY_LAST_ERROR, {
      ...formatErrorForStorage(err, currentStage || "unknown"),
      ...getRuntimeScope(primarySite, currentRefreshRequest || refreshRequest)
    });
    await setValue(STORE_KEY_LAST_RUNNING, {
      ...getRuntimeScope(primarySite, currentRefreshRequest || refreshRequest),
      running: false,
      endTime: new Date().toLocaleString(),
      timestamp: Date.now(),
      stage: "failed",
      stageText: "扫描失败",
      current: 0,
      total: totalCourses,
      percent: 100
    });

    const errorKind = getErrorKind(err);
    const errorMessage = errorKind === "login_required" ? "TG 未登录，请先登录后刷新" : err?.message || String(err);
    await writeRefreshStatus("error", 100, errorMessage, {
      requestId: (currentRefreshRequest || refreshRequest)?.requestId,
      error: errorMessage,
      ...(errorKind ? { errorKind } : {})
    });
    scanInProgress = false;

    logError("scan failed", err);
    return result;
  }
}

startBackendHeartbeat();
startRefreshRequestListener();

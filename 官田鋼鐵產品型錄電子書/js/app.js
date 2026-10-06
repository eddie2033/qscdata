/**
 * flipbook-viewer v2.3.3 ── 【電子書安全基線模板 / SECURE BASELINE】
 * Image-based flipbook — no PDF.js, lazy loading
 * StPageFlip (MIT) + 自行撰寫整合邏輯
 * Zero eval(), zero jQuery, zero external CDN
 *
 * ★ 套用本模板做新電子書：唯一要改的設定在下方 Config 區（TOTAL_PAGES / PRELOAD_RADIUS）。
 * ★ 資安基線勿動（Checkmarx 已過）：preloadWindow 必維持「固定常數次數迴圈」，
 *   嚴禁讓使用者輸入（e.data / idx）進入任何迴圈條件；flip handler 的 parseInt+範圍 gate 保留。
 *
 * v2.3.3 (2026-06-16): 安全修正（Checkmarx 弱掃第 2 次報告仍中風險 ×2）——根治 Unchecked Input For Loop Condition。
 *                      v2.3.2 雖加了 isNaN gate + Math.max/min 夾擠，但 Checkmarx CWE-606 查詢追的是「迴圈條件本身」，
 *                      不認 if-guard 也不認 Math 夾擠為 sanitizer，只要輸入經算術流入迴圈邊界就照樣標記。
 *                      解法：preloadWindow 改為固定常數次數迴圈（for k < PRELOAD_RADIUS*2+1），迴圈條件不含任何使用者輸入，
 *                      輸入只用於計算陣列索引並先做邊界檢查 → e.data 不再到達任何迴圈條件，污染資料流被切斷。
 *                      （flip handler 的 parseInt+範圍 gate 保留為縱深防禦；clickjacking 低風險第 2 次報告已顯示修復，未動。）
 * v2.3.2 (2026-06-16): 安全修正（Checkmarx 掃描）——
 *                      ① flip handler 在 preloadWindow(e.data) 前以 parseInt + 範圍檢查驗證輸入
 *                         （修 Unchecked Input For Loop Condition，中風險；同段碼涵蓋兩條資料流路徑）。
 *                      ② index.html 加 framebusting 防點擊劫持（修 Potential Clickjacking，低風險）。
 *                      ③ vercel.json 加 X-Frame-Options/CSP frame-ancestors（線上版縱深防禦）。
 * v2.3.1 (2026-06-16): 修復 file:// 雙擊離線開啟卡 0%——index.html 原以 type="module" 載入本檔，
 *                      ES module 在 file:// 協定被瀏覽器 CORS 擋而完全不執行（畫面停在初始 0%）。
 *                      本檔無 import/export，index.html 改回普通 <script> 即可（線上 https 不受影響）。
 * v2.3.0 (2026-06-15): 中灰主題 #545454 + 縮放功能
 *                      - CSS transform scale 縮放（StPageFlip 無內建 zoom）
 *                      - ＋/－/還原 按鈕、滑鼠滾輪縮放（容器中心錨點）
 *                      - 放大後拖曳平移（pan）：以 capture 階段攔截 pointer 事件，
 *                        zoom>1 時 stopPropagation 阻止傳到 StPageFlip canvas（避免誤翻頁），
 *                        zoom===1 時放行讓翻頁正常
 *                      - 翻頁 / resize 時自動還原縮放
 * v2.2 (2026-06-12): 修復內頁左右裁切——書本比例改以內頁（page-002）量測，
 *                    內頁 objectFit 改 contain；封面/封底（比例不同）維持 cover
 * v2.1 (2026-06-12): 封面/封底替換為客戶補充之電子版（20260611，無裁切標記），總頁數維持 140
 */

// ── Config ──
const TOTAL_PAGES = 20;    // ★ 改這裡：新電子書的總頁數（= pages/ 內 page-NNN.jpg 數量）
const PRELOAD_RADIUS = 4;  // 當前頁 ±4 頁預先載入（一般不用改）

function buildPageSrc(n) {
  return './pages/page-' + String(n).padStart(3, '0') + '.jpg';
}

// ── DOM refs ──
const flipbookEl = document.getElementById('flipbook');
const bookContainer = document.getElementById('book-container');
const loadingOverlay = document.getElementById('loading-overlay');
const progressFill = document.getElementById('progress-fill');
const progressText = document.getElementById('progress-text');
const pageInfo = document.getElementById('page-info');
const btnFirst = document.getElementById('btn-first');
const btnPrev = document.getElementById('btn-prev');
const btnNext = document.getElementById('btn-next');
const btnLast = document.getElementById('btn-last');
const btnFullscreen = document.getElementById('btn-fullscreen');
const btnZoomIn = document.getElementById('btn-zoom-in');
const btnZoomOut = document.getElementById('btn-zoom-out');
const btnZoomReset = document.getElementById('btn-zoom-reset');
const zoomInfo = document.getElementById('zoom-info');

let pageFlip = null;
let pageElements = [];

// ── 縮放 / 平移狀態 ──
const ZOOM_MIN = 1;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.25;
let zoom = 1;
let panX = 0;
let panY = 0;
let isPanning = false;
let panStartX = 0;
let panStartY = 0;

// ── 建立頁面元素（全部 placeholder，不設定 src）──
function createPageElements() {
  return Array.from({ length: TOTAL_PAGES }, function(_, i) {
    var div = document.createElement('div');
    div.className = 'page-content';
    var img = document.createElement('img');
    img.dataset.src = buildPageSrc(i + 1);
    img.alt = '第 ' + (i + 1) + ' 頁';
    img.draggable = false;
    img.style.width = '100%';
    img.style.height = '100%';
    // 封面/封底（1275×1824）與內頁（1198×1670）長寬比不同：
    // 內頁用 contain 確保不裁切；封面是滿版設計圖，用 cover 裁出血邊避免露底色
    var isCoverPage = i === 0 || i === TOTAL_PAGES - 1;
    img.style.objectFit = isCoverPage ? 'cover' : 'contain';
    div.appendChild(img);
    return div;
  });
}

// ── 懶載入：只載入 currentIdx ± PRELOAD_RADIUS 範圍內的頁面 ──
// 安全修正 v2.3.3：迴圈固定執行 (PRELOAD_RADIUS*2+1) 次，迴圈條件只用常數；
//   使用者輸入(currentIdx)只用於計算陣列索引並先做邊界檢查，完全不進入迴圈條件
//   → 切斷 Checkmarx「Unchecked Input For Loop Condition」(CWE-606) 的污染資料流。
//   v2.3.2 的 isNaN gate + Math.max/min 夾擠 Checkmarx 不認（仍把算術後的輸入視為污染），故改用此固定次數寫法。
function preloadWindow(currentIdx) {
  if (!Number.isInteger(currentIdx)) return;     // 防 NaN/非整數進固定迴圈造成 pageElements[NaN]
  var WINDOW = PRELOAD_RADIUS * 2 + 1;           // 編譯期常數（= 9）
  for (var k = 0; k < WINDOW; k++) {             // ← 迴圈條件僅依賴常數
    var i = currentIdx - PRELOAD_RADIUS + k;
    if (i < 0 || i >= TOTAL_PAGES) continue;     // 邊界檢查後才存取陣列
    var img = pageElements[i].querySelector('img');
    if (img && img.dataset.src && !img.getAttribute('src')) {
      img.src = img.dataset.src;
    }
  }
}

// ── 計算書本尺寸以填滿容器 ──
function calcBookSize(pageW, pageH) {
  var rect = bookContainer.getBoundingClientRect();
  var controlsH = 60;
  var availW = rect.width * 0.92;
  var availH = (rect.height - controlsH) * 0.92;

  // Portrait page: show two side-by-side → spread aspect
  var spreadAspect = (pageW * 2) / pageH;
  var containerAspect = availW / availH;

  var displayW, displayH;
  if (spreadAspect > containerAspect) {
    displayW = availW;
    displayH = availW / spreadAspect;
  } else {
    displayH = availH;
    displayW = availH * spreadAspect;
  }

  return {
    width: Math.floor(displayW / 2),
    height: Math.floor(displayH),
  };
}

// ── 更新頁碼顯示 ──
function updatePageInfo() {
  if (!pageFlip) return;
  var current = pageFlip.getCurrentPageIndex();
  var orientation = pageFlip.getOrientation();

  if (orientation === 'landscape') {
    var left = current + 1;
    var right = Math.min(current + 2, TOTAL_PAGES);
    pageInfo.textContent = left === right
      ? left + ' / ' + TOTAL_PAGES
      : left + '-' + right + ' / ' + TOTAL_PAGES;
  } else {
    pageInfo.textContent = (current + 1) + ' / ' + TOTAL_PAGES;
  }

  btnFirst.disabled = current <= 0;
  btnPrev.disabled = current <= 0;
  btnNext.disabled = current >= TOTAL_PAGES - 1;
  btnLast.disabled = current >= TOTAL_PAGES - 1;
}

// ── 縮放 / 平移 ──
function applyTransform() {
  flipbookEl.style.transform =
    'translate(' + panX + 'px,' + panY + 'px) scale(' + zoom + ')';
  bookContainer.classList.toggle('zoomed', zoom > 1);
  zoomInfo.textContent = Math.round(zoom * 100) + '%';
  btnZoomIn.disabled = zoom >= ZOOM_MAX;
  btnZoomOut.disabled = zoom <= ZOOM_MIN;
}

// 限制平移範圍，避免書本被拖出視野（scale 後溢出量的一半）
function clampPan() {
  var maxX = flipbookEl.offsetWidth * (zoom - 1) / 2;
  var maxY = flipbookEl.offsetHeight * (zoom - 1) / 2;
  panX = Math.max(-maxX, Math.min(maxX, panX));
  panY = Math.max(-maxY, Math.min(maxY, panY));
}

function setZoom(next) {
  zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(next * 100) / 100));
  if (zoom <= 1) { panX = 0; panY = 0; }
  clampPan();
  applyTransform();
}

function resetZoom() {
  setZoom(1);
}

// 拖曳平移：capture 階段攔截，zoom>1 時 stopPropagation 阻止傳到 StPageFlip（避免誤翻頁）
function onPanStart(e) {
  if (zoom <= 1) return;          // 未放大 → 放行給翻頁
  e.stopPropagation();
  isPanning = true;
  panStartX = e.clientX - panX;
  panStartY = e.clientY - panY;
  bookContainer.classList.add('grabbing');
}
function onPanMove(e) {
  if (!isPanning) return;
  e.stopPropagation();
  panX = e.clientX - panStartX;
  panY = e.clientY - panStartY;
  clampPan();
  applyTransform();
}
function onPanEnd(e) {
  if (!isPanning) return;
  e.stopPropagation();
  isPanning = false;
  bookContainer.classList.remove('grabbing');
}

// ── 主初始化 ──
async function init() {
  try {
    // 以內頁（page-002）量測頁面尺寸：書本比例必須以內頁為準，
    // 內頁佔 138/140 頁；若用封面量測（比例不同）會導致整本內頁被左右裁切
    progressText.textContent = '載入頁面中…';
    progressFill.style.width = '30%';

    const sizeRefImg = new Image();
    await new Promise(function(resolve, reject) {
      sizeRefImg.onload = resolve;
      sizeRefImg.onerror = reject;
      sizeRefImg.src = buildPageSrc(2);
    });

    progressFill.style.width = '60%';

    const pageW = sizeRefImg.naturalWidth;
    const pageH = sizeRefImg.naturalHeight;
    const bookSize = calcBookSize(pageW, pageH);

    // 建立所有頁面元素（placeholder）
    pageElements = createPageElements();

    // 封面立即載入（page-002 已由量測載入快取，preloadWindow 會補上 src）
    pageElements[0].querySelector('img').src = buildPageSrc(1);

    progressFill.style.width = '90%';

    // 初始化 StPageFlip
    pageFlip = new St.PageFlip(flipbookEl, {
      width: bookSize.width,
      height: bookSize.height,
      size: 'fixed',
      minWidth: 160,
      minHeight: 220,
      maxWidth: bookSize.width,
      maxHeight: bookSize.height,
      showCover: true,
      maxShadowOpacity: 0.5,
      mobileScrollSupport: true,
      clickEventForward: false,
      useMouseEvents: true,
      swipeDistance: 30,
      showPageCorners: true,
      flippingTime: 800,
      usePortrait: true,
      autoSize: true,
      drawShadow: true,
    });

    pageFlip.loadFromHTML(pageElements);

    // 翻頁事件 → 更新 UI + 懶載入 + 還原縮放（避免下一頁停在放大狀態）
    pageFlip.on('flip', function(e) {
      updatePageInfo();
      // 翻頁索引驗證（縱深防禦）：parseInt + 範圍檢查後才呼叫 preloadWindow。
      // v2.3.3 起 Checkmarx CWE-606 的根治在 preloadWindow（迴圈條件已改純常數，不含使用者輸入）；此 gate 保留為第一道防線。
      var idx = parseInt(e.data, 10);
      if (!isNaN(idx) && idx >= 0 && idx < TOTAL_PAGES) {
        preloadWindow(idx);
      }
      resetZoom();
    });

    // 初始預載
    preloadWindow(0);
    updatePageInfo();
    applyTransform();

    progressFill.style.width = '100%';
    loadingOverlay.classList.add('hidden');
    setTimeout(function() {
      loadingOverlay.style.display = 'none';
    }, 400);

  } catch (err) {
    progressText.textContent = '載入失敗：' + err.message;
    console.error('Flipbook init error:', err);
  }
}

// ── 按鈕事件 ──
btnPrev.addEventListener('click', function() {
  if (pageFlip) pageFlip.flipPrev();
});
btnNext.addEventListener('click', function() {
  if (pageFlip) pageFlip.flipNext();
});
btnFirst.addEventListener('click', function() {
  if (pageFlip) pageFlip.flip(0);
});
btnLast.addEventListener('click', function() {
  if (pageFlip) pageFlip.flip(TOTAL_PAGES - 1);
});
btnFullscreen.addEventListener('click', function() {
  var app = document.getElementById('app');
  if (!document.fullscreenElement) {
    (app.requestFullscreen || app.webkitRequestFullscreen).call(app);
  } else {
    (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  }
});

// ── 縮放按鈕 ──
btnZoomIn.addEventListener('click', function() { setZoom(zoom + ZOOM_STEP); });
btnZoomOut.addEventListener('click', function() { setZoom(zoom - ZOOM_STEP); });
btnZoomReset.addEventListener('click', resetZoom);

// ── 滑鼠滾輪縮放（容器中心錨點；preventDefault 防止頁面捲動）──
bookContainer.addEventListener('wheel', function(e) {
  if (!pageFlip) return;
  e.preventDefault();
  setZoom(zoom + (e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP));
}, { passive: false });

// ── 拖曳平移（Pointer Events，capture 階段優先於 StPageFlip 攔截）──
bookContainer.addEventListener('pointerdown', onPanStart, true);
window.addEventListener('pointermove', onPanMove, true);
window.addEventListener('pointerup', onPanEnd, true);
window.addEventListener('pointercancel', onPanEnd, true);

// ── 鍵盤導覽 ──
document.addEventListener('keydown', function(e) {
  if (!pageFlip) return;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
    pageFlip.flipPrev();
  } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ') {
    e.preventDefault();
    pageFlip.flipNext();
  } else if (e.key === 'Home') {
    pageFlip.flip(0);
  } else if (e.key === 'End') {
    pageFlip.flip(TOTAL_PAGES - 1);
  } else if (e.key === 'f' || e.key === 'F') {
    btnFullscreen.click();
  } else if (e.key === '+' || e.key === '=') {
    setZoom(zoom + ZOOM_STEP);
  } else if (e.key === '-' || e.key === '_') {
    setZoom(zoom - ZOOM_STEP);
  } else if (e.key === '0') {
    resetZoom();
  }
});

// ── Resize ──
var resizeTimer;
window.addEventListener('resize', function() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(function() {
    if (pageFlip) { updatePageInfo(); resetZoom(); }
  }, 250);
});

// ── 啟動 ──
init();

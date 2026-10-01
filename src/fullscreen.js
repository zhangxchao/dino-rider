// =====================================================================
//  手机全屏：安卓 / 平板 / 桌面用全屏 API（点按时进入，并锁定横屏）；
//  iPhone Safari 不支持网页元素全屏，只能「添加到主屏幕」以网页应用方式打开
// =====================================================================
const doc = document;
const root = doc.documentElement;

export const isStandalone = () => navigator.standalone === true
  || !!(window.matchMedia && (window.matchMedia('(display-mode: fullscreen)').matches || window.matchMedia('(display-mode: standalone)').matches));
export const canFullscreen = () => !!(root.requestFullscreen || root.webkitRequestFullscreen) && (doc.fullscreenEnabled ?? doc.webkitFullscreenEnabled ?? true);
export const isFullscreen = () => !!(doc.fullscreenElement || doc.webkitFullscreenElement);
export const isIPhone = () => /iPhone|iPod/.test(navigator.userAgent);
/** App 内置浏览器（微信、QQ、微博、Facebook、Instagram、Line……或 iOS 上不是 Safari 的壳） */
export function isInAppBrowser() {
  const ua = navigator.userAgent;
  if (/MicroMessenger|QQ\/|Weibo|FBAN|FBAV|Instagram|Line\/|DingTalk|AlipayClient|baiduboxapp|Claude/i.test(ua)) return true;
  // iOS 上真正的 Safari 带 "Safari/" 且不带 CriOS / FxiOS 等标记；内置 WebView 一般没有 "Safari/"
  return /iPhone|iPad|iPod/.test(ua) && !/Safari\//.test(ua);
}

export async function enterFullscreen() {
  if (isStandalone() || isFullscreen() || !canFullscreen()) return false;
  try {
    if (root.requestFullscreen) await root.requestFullscreen({ navigationUI: 'hide' });
    else root.webkitRequestFullscreen();
  } catch { return false; }
  try { await screen.orientation?.lock?.('landscape'); } catch { /* 有的浏览器不允许锁定方向 */ }
  return true;
}

export async function exitFullscreen() {
  try {
    if (doc.exitFullscreen) await doc.exitFullscreen();
    else if (doc.webkitExitFullscreen) doc.webkitExitFullscreen();
  } catch { /* ignore */ }
}

export function toggleFullscreen() { return isFullscreen() ? exitFullscreen() : enterFullscreen(); }

// 截取游戏菜单场景（真实地形 + 天空 + 后处理）作为卡片背景立绘
// 用法：先 `npx vite --port 5199`，再 node cards/render-scene.mjs <dino> <rider> <biome> [orbit]
import { createRequire } from 'module';
const require = createRequire('/opt/node22/lib/node_modules/');
const { chromium } = require('playwright');
const [dino, rider, biome, orbit = '0.7', expo = '1', zoom = '1'] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1300, height: 1150 }, deviceScaleFactor: 1.5 });
p.on('pageerror', (e) => console.log('[err]', e.message));
await p.addInitScript(() => localStorage.setItem('dino-rider-save-v1', JSON.stringify({ tutorialDone: true, settings: { quality: 'high' } })));
await p.goto('http://localhost:5199/');
await p.waitForFunction(() => window.__app && window.__app.mode === 'menu' && window.__app.showcase, null, { timeout: 180000 });
await p.evaluate(({ dino, rider, biome, orbit, expo, zoom }) => {
  const app = window.__app;
  const Show = app.showcase.constructor;
    app.showcase.dispose();
  app.saveRef.dino = dino; app.saveRef.rider = rider;
  app.showcase = new Show(app, biome);
  const s = app.showcase;
  s.setFrame('center'); s.frameK = 0; s.orbit = +orbit; s.dragging = true; s.actionT = 999;
  s.model.root.rotation.y = 0;
  // 覆盖镜头：侧前方 3/4 角度、略低机位，让坐骑占满画面
  const orig = s.update.bind(s);
  s.update = (dt) => {
    orig(dt);
    const cam = app.camera, base = s.model.root.position, size = s.model.size;
    const h = size.height, L = size.length;
    const fov = 34; cam.fov = fov; cam.updateProjectionMatrix();
    const d = Math.max(L * 0.62, h * 1.25) / Math.tan(fov / 2 * Math.PI / 180) * +(window.__zoom || 1);
    const a = +orbit;
    const cx = base.x, cy = base.y + h * 0.62, cz = base.z;
    cam.position.set(cx + Math.sin(a) * d, cy + d * 0.2, cz + Math.cos(a) * d);
    cam.lookAt(cx, cy + h * 0.05, cz);
  };
  const st = document.createElement('style');
  st.textContent = '* { visibility: hidden !important } canvas, canvas * { visibility: visible !important }';
  document.head.appendChild(st);
  app.renderer.toneMappingExposure *= +expo; window.__zoom = +zoom;
}, { dino, rider, biome, orbit, expo, zoom });
await p.waitForTimeout(9000);
await p.screenshot({ timeout: 120000, path: `cards/scene-${dino}.png` });
await b.close();

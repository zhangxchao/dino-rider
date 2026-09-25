# 模块接口契约 (Module Contracts)

项目：`dino-rider` —— Three.js (npm `three`, ES modules, Vite)。所有模块 `import * as THREE from 'three'`。
共享数据在 `src/data.js`（DINOS / RIDERS / ENEMIES / BOSSES / LEVELS / UPGRADES）。

坐标约定：Y 向上，模型**面朝 +Z**，1 单位 ≈ 1 米。
材质约定：**MeshStandardMaterial（flatShading: true）**，低多边形卡通风格；**每次调用都新建材质实例**（不要在不同实例间共享材质，玩法层会逐个修改 `emissive` 来做受击闪白）。发光部件（眼睛、魔法核心）可使用 `emissive`，玩法层会保存并恢复原值。
几何体可以在模块级缓存复用（几何体共享没问题）。
不要在模型模块里 `scene.add`，不要创建灯光（世界模块除外）。玩法层会遍历网格设置 `castShadow = true`。

---

## 1. `src/models/dinos.js`

```js
export function createDinoModel(def)   // def = DINOS 中的一项
```
返回：
```js
{
  root,     // THREE.Group。原点在两脚之间的地面上，面朝 +Z，已按 def.scale 缩放完成
  saddle,   // THREE.Object3D，挂在身体骨架上（跟随身体起伏）；骑手的“坐点”放这里，+Y 向上 +Z 向前
  mouth,    // THREE.Object3D，头部/嘴部前端（近战特效位置、音波/毒液发射点）
  size: { height, length, radius }, // height=背部高度(世界单位)，length=全长，radius=水平碰撞半径（大约躯干半长）
  update(dt, s),
}
```
动画状态 `s`：
```js
{
  t,          // 累计时间（秒）
  move,       // 0 静止 … 1 奔跑 … 最高 1.8（冲刺）；驱动步态频率与幅度
  air,        // bool 是否在空中（跳跃）
  attack,     // -1 或 0..1：近战攻击动画进度，按 def.attack 风格（bite/horn/claw/tail/stomp/peck/headbutt）
  skill,      // -1 或 0..1：技能动画进度，按 def.skill.type（roar 张嘴仰头 / charge 低头 / spin 由玩法层旋转 root 即可 / stomp 人立踏地 / dive 振翅 等）
  hurt,       // 0..1 受击后仰
  dead,       // 0..1 死亡（倒地侧翻）
}
```
尺寸参考（scale=1 时）：中型兽脚类背高约 2.0、全长约 5；腕龙 scale 1.55 背高约 4、脖子更高；迅猛龙 scale 0.72 背高约 1.2。翼龙：身体悬停在离地约 2.2 处并持续扇翅（move 越大扇得越快）。

## 2. `src/models/riders.js`

```js
export function createRiderModel(def)  // def = RIDERS 中的一项
```
返回：
```js
{
  root,     // THREE.Group。原点 = 臀部坐点（会被挂到恐龙 saddle 上），面朝 +Z。坐姿：双腿分开跨骑向下。坐点到头顶约 1.1
  muzzle,   // THREE.Object3D，武器发射点（手中武器前端）
  update(dt, s),
}
```
`s = { t, bounce /*0..1 坐骑奔跑强度*/, shoot /* -1 或 0..1 射击动作进度 */, cheer /* bool 胜利欢呼 */, lean /* -1..1 转弯侧倾 */ }`

## 3. `src/models/enemies.js`

```js
export function createEnemyModel(type, def) // type = ENEMIES 的键, def = ENEMIES[type]
export function createBossModel(type, def)  // type = BOSSES 的键,  def = BOSSES[type]
```
返回：
```js
{
  root,     // 原点在地面，面朝 +Z。飞行怪（def.flying）在模型内部自行上浮到 def.hover 高度并上下漂浮
  muzzle,   // 远程/首领的弹幕发射点（没有远程也要给一个大致在头部的点）
  size: { height, radius },  // radius 应≈ def.radius
  update(dt, s),
}
```
普通怪 `s = { t, move 0..1, attack -1|0..1, hurt 0..1, dead 0..1 }`
首领 `s = { t, move, attack -1|0..1, pattern /* 当前招式名或 null */, hurt, dead, phase /*1..3*/, burrow /*0..1 沙虫潜地程度*/ }`

## 4. `src/world.js`

```js
export function createWorld(biome, scene, opts = { quality: 'high' | 'low' })
// biome: 'jungle' | 'desert' | 'frost' | 'swamp' | 'volcano' | 'shadow'
```
返回：
```js
{
  heightAt(x, z),     // 地形高度（必须与网格一致）；竞技场中央区域相对平坦
  arenaRadius,        // 可活动半径（约 62）；边界外有悬崖/岩壁/树墙作视觉封闭
  obstacles,          // [{x, z, r}] 竞技场内部的实心障碍（树干、岩石），数量适中（15~35），不要挡在中心 12 米内
  sun,                // 投射阴影的 DirectionalLight
  update(dt, t, focus /* Vector3 玩家位置 */),  // 天气粒子、水/岩浆动画；阴影相机跟随 focus
  dispose(),          // 从 scene 移除所有对象并释放资源；恢复 scene.fog/background
}
```
世界模块负责：scene.background / scene.fog、半球光 + 方向光(阴影)、天空穹顶、地形、植被（InstancedMesh）、岩石、水/岩浆面、天气粒子。

## 5. `src/audio.js`

```js
export class AudioSystem {
  unlock()                     // 首次用户手势时调用，创建/恢复 AudioContext
  play(name, opts = {})        // opts: { volume = 1, pitch = 1, pan = 0 }
  roar(size = 1)               // 恐龙吼叫，size 0.6(小)~1.6(巨)
  startMusic(theme)            // 'menu' | 'jungle' | 'desert' | 'frost' | 'swamp' | 'volcano' | 'shadow' | 'boss' | 'victory'
  stopMusic(fade = 1)
  setMusicVolume(v), setSfxVolume(v)   // 0..1
}
```
音效名见 `src/audio.js` 顶部注释。

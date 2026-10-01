// =====================================================================
//  环境贴图：用当前生态的天空渐变 + 地面色 + 太阳光斑渲一张 PMREM
//  让标准材质有正确的环境漫反射和高光反射（冰面、水、盔甲、黑曜石不再“死平”）
//  每个关卡只生成一次，开销很低
// =====================================================================
import * as THREE from 'three';

const VERT = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const FRAG = /* glsl */`
  uniform vec3 uTop, uHorizon, uGround, uSun;
  uniform vec3 uSunDir;
  uniform float uSunI;
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    vec3 c = h > 0.0 ? mix(uHorizon, uTop, pow(smoothstep(0.0, 1.0, h), 0.6))
                     : mix(uHorizon, uGround, smoothstep(0.0, 0.25, -h));
    float s = max(dot(d, uSunDir), 0.0);
    c += uSun * (pow(s, 600.0) * uSunI + pow(s, 12.0) * 0.35);
    gl_FragColor = vec4(c, 1.0);
  }`;

/**
 * sky: { top, horizon, sunColor, sunDir }，light: { hemiGround }
 * 返回 PMREM 渲染目标（调用方负责 dispose）
 */
export function buildEnvironment(renderer, sky, light) {
  const scene = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: {
      uTop: { value: new THREE.Color(sky.top) },
      uHorizon: { value: new THREE.Color(sky.horizon) },
      uGround: { value: new THREE.Color(light.hemiGround).multiplyScalar(0.8) },
      uSun: { value: new THREE.Color(sky.sunColor) },
      uSunDir: { value: new THREE.Vector3(...sky.sunDir).normalize() },
      uSunI: { value: 6 },
    },
    vertexShader: VERT, fragmentShader: FRAG,
  });
  const geo = new THREE.SphereGeometry(10, 48, 24);
  scene.add(new THREE.Mesh(geo, mat));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(scene, 0, 0.1, 100);
  pmrem.dispose();
  geo.dispose(); mat.dispose();
  return rt;
}

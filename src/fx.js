// WebGL2 video effects: background blur/replace, looks (colour filters), lighting, touch-up.
// Face touch-up, makeup and warps use the face landmarks (see face.js).
// Runs on the sender's device; the processed picture is what everyone else receives.

const VS = `#version 300 es
in vec2 p; out vec2 uv;
void main(){ uv = p*0.5+0.5; gl_Position = vec4(p,0.,1.); }`;

// background-only downsample: weight colour by (1 - person) so the person doesn't bleed into the blur
const FS_DOWN = `#version 300 es
precision highp float; in vec2 uv; out vec4 o;
uniform sampler2D uVideo; uniform sampler2D uAlpha; uniform float uMaskOn;
void main(){
  vec3 c = texture(uVideo, vec2(uv.x, 1.-uv.y)).rgb;
  float m = uMaskOn > 0.5 ? texture(uAlpha, uv).r : 0.;
  float w = 1. - smoothstep(0.1, 0.5, m);
  o = vec4(c*w, w);
}`;

const FS_BLUR = `#version 300 es
precision highp float; in vec2 uv; out vec4 o;
uniform sampler2D uTex; uniform vec2 uDir;
void main(){
  vec4 s = texture(uTex, uv) * 0.2270270270;
  s += (texture(uTex, uv + uDir*1.3846153846) + texture(uTex, uv - uDir*1.3846153846)) * 0.3162162162;
  s += (texture(uTex, uv + uDir*3.2307692308) + texture(uTex, uv - uDir*3.2307692308)) * 0.0702702703;
  o = s;
}`;


// Edge refinement: a guided filter (He, Sun and Tang) steered by the camera picture itself,
// so the cutout follows real edges (hair, shoulders) instead of the model's coarse outline.
// 1) pack guide I and mask p at half resolution
const FS_PACK = `#version 300 es
precision highp float; in vec2 uv; out vec4 o;
uniform sampler2D uVideo, uMask;
void main(){
  vec2 t = vec2(uv.x, 1.-uv.y);
  float I = dot(texture(uVideo, t).rgb, vec3(0.299, 0.587, 0.114)) - 0.5;
  float p = texture(uMask, t).r;
  o = vec4(I, p, I*I, I*p);
}`;

// separable box mean
const FS_BOX = `#version 300 es
precision highp float; out vec4 o;
uniform sampler2D uTex; uniform ivec2 uDir; uniform int uR;
void main(){
  ivec2 sz = textureSize(uTex, 0) - 1;
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 s = vec4(0.);
  for (int i = -16; i <= 16; i++) {
    if (i < -uR || i > uR) continue;
    s += texelFetch(uTex, clamp(c + uDir * i, ivec2(0), sz), 0);
  }
  o = s / float(2 * uR + 1);
}`;

// 2) per-pixel linear model q = a*I + b
const FS_COEF = `#version 300 es
precision highp float; out vec4 o;
uniform sampler2D uTex; uniform float uEps;
void main(){
  vec4 m = texelFetch(uTex, ivec2(gl_FragCoord.xy), 0);
  float varI = max(m.z - m.x*m.x, 0.);
  float cov = m.w - m.x*m.y;
  float a = cov / (varI + uEps);
  o = vec4(a, m.y - a*m.x, 0., 1.);
}`;

// 3) apply at full resolution with the full-resolution guide; write the final alpha upright
const FS_ALPHA = `#version 300 es
precision highp float; in vec2 uv; out vec4 o;
uniform sampler2D uVideo, uMask, uCoef; uniform int uGuided; uniform vec2 uEdge;
void main(){
  vec2 t = vec2(uv.x, 1.-uv.y);
  float q;
  if (uGuided == 1) {
    float I = dot(texture(uVideo, t).rgb, vec3(0.299, 0.587, 0.114)) - 0.5;
    vec2 ab = texture(uCoef, uv).xy;
    q = ab.x * I + ab.y;
  } else q = texture(uMask, t).r;
  o = vec4(smoothstep(uEdge.x, uEdge.y, q), 0., 0., 1.);
}`;

const FS_FINAL = `#version 300 es
precision highp float; in vec2 uv; out vec4 o;
uniform sampler2D uVideo, uAlpha, uBlur, uImage;
uniform vec2 uRes;
uniform int uBgMode;          // 0 none, 1 blur, 2 image
uniform vec4 uImgFit;         // scale.xy, offset.xy for cover fit
uniform float uMaskOn;
// lighting
uniform float uExposure, uGamma, uSmooth, uVignette, uSpot;
uniform vec3 uKeyColor; uniform vec2 uKeyPos; uniform float uKeyRadius, uKeyStrength;
uniform vec3 uRimL, uRimR; uniform float uRim;
// look
uniform float uSat, uCon, uBri, uSepia, uFade, uPoster, uSplit;
uniform vec3 uTint, uShadowTint, uHighTint;
// face (positions are in frame coordinates, 0..1 with y down; sizes in aspect units)
uniform float uFaceOn, uAsp, uRoll, uSkinR;
uniform sampler2D uFaceMask;
uniform vec4 uBox, uEyeR, uEyeL, uFace;
uniform vec3 uMouth, uCheekR, uCheekL;
uniform float uSkin, uEyeBright, uTeeth, uSlim, uEyeBig, uLipAmt, uBlushAmt;
uniform vec3 uLipCol, uBlushCol;
uniform int uWarp;

vec3 vid(vec2 t){ return texture(uVideo, vec2(t.x, 1.-t.y)).rgb; }
vec3 vidI(vec2 p){ return texture(uVideo, p).rgb; }
float luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }

// face-aligned frame: undo the head's tilt so "across" and "down" follow the face
vec2 toLocal(vec2 d){ float c = cos(uRoll), s = sin(uRoll); return vec2(c*d.x + s*d.y, -s*d.x + c*d.y); }
vec2 toWorld(vec2 d){ float c = cos(uRoll), s = sin(uRoll); return vec2(c*d.x - s*d.y, s*d.x + c*d.y); }
vec2 A(vec2 p){ return p * vec2(uAsp, 1.); }
// magnify (k > 0) or shrink (k < 0) inside an ellipse, smoothly back to normal at its edge
vec2 bulge(vec2 P, vec2 C, vec2 R, float k){
  vec2 d = toLocal(P - C); float t = length(d / R);
  if (t >= 1. || k == 0.) return P;
  float w = (1. - t*t); w *= w;
  return C + toWorld(d * (1. - k * w));
}
// stretch along the face's own axes; s > 1 samples further out, so that part looks narrower
vec2 stretch(vec2 P, vec2 C, vec2 R, vec2 k, float bottomBias){
  vec2 d = toLocal(P - C); float t = length(d / R);
  if (t >= 1.) return P;
  float w = (1. - t*t); w *= w;
  w *= mix(1., smoothstep(-0.7, 0.4, d.y / R.y), bottomBias);
  return C + toWorld(d * (1. + k * w));
}
float ellipse(vec2 P, vec2 C, vec2 R){ return length(toLocal(P - C) / R); }

vec2 warp(vec2 ip){
  vec2 P = A(ip);
  vec2 eR = A(uEyeR.xy), eL = A(uEyeL.xy), fc = A(uFace.xy), mo = A(uMouth.xy);
  float fw = uFace.z * 0.5, fh = uFace.w * 0.5;
  // touch-up
  if (uSlim > 0.) P = stretch(P, fc + toWorld(vec2(0., fh * 0.35)), vec2(fw * 1.3, fh * 0.95), vec2(uSlim * 0.13, 0.), 1.);
  if (uEyeBig > 0.) { P = bulge(P, eR, vec2(uEyeR.z * 1.9, uEyeR.z * 1.6), uEyeBig * 0.3); P = bulge(P, eL, vec2(uEyeL.z * 1.9, uEyeL.z * 1.6), uEyeBig * 0.3); }
  // fun
  if (uWarp == 1) { P = bulge(P, eR, vec2(uEyeR.z * 2.7, uEyeR.z * 2.3), 0.55); P = bulge(P, eL, vec2(uEyeL.z * 2.7, uEyeL.z * 2.3), 0.55); }
  else if (uWarp == 2) P = bulge(P, fc, vec2(fw * 1.75, fh * 1.45), -0.55);
  else if (uWarp == 3) P = bulge(P, fc - toWorld(vec2(0., fh * 0.15)), vec2(fw * 1.75, fh * 1.5), 0.5);
  else if (uWarp == 4) {
    P = stretch(P, fc + toWorld(vec2(0., fh * 0.45)), vec2(fw * 1.3, fh * 1.0), vec2(0.45, -0.05), 1.);
    P = bulge(P, mo, vec2(uMouth.z * 1.6, uMouth.z * 1.1), -0.5);
    vec2 up = toWorld(vec2(0., -uEyeR.z * 0.35));
    P = bulge(P, eR + up, vec2(uEyeR.z * 3.0, uEyeR.z * 2.6), 0.6); P = bulge(P, eL + up, vec2(uEyeL.z * 3.0, uEyeL.z * 2.6), 0.6);
  }
  else if (uWarp == 5) P = stretch(P, fc, vec2(fw * 1.7, fh * 1.45), vec2(-0.28, 0.5), 0.);
  else if (uWarp == 6) P = stretch(P, fc, vec2(fw * 1.7, fh * 1.45), vec2(0.3, -0.45), 0.);
  return P / vec2(uAsp, 1.);
}

// skin, lips and inside of the mouth for a point in the frame
vec3 faceMask(vec2 ip){
  vec2 m = (ip - uBox.xy) / uBox.zw;
  if (m.x <= 0. || m.y <= 0. || m.x >= 1. || m.y >= 1.) return vec3(0.);
  return texture(uFaceMask, m).rgb;
}

vec3 faceFx(vec3 fg, vec2 sp){
  vec3 fm = faceMask(sp);
  float skin = fm.r, lips = fm.g * (1. - fm.b), mouth = fm.b;
  vec2 P = A(sp);
  vec3 col = fg;
  // skin: two rings of samples, keep edges, then put a little texture back so it doesn't look plastic
  if (uSkin > 0.001 && skin > 0.01) {
    vec3 acc = fg; float ws = 1.;
    for (int ring = 1; ring <= 2; ring++) {
      float r = uSkinR * float(ring);
      for (int i = 0; i < 8; i++) {
        float a = float(i) * 0.7853981 + float(ring) * 0.39;
        vec3 c = vidI(sp + vec2(cos(a) / uAsp, sin(a)) * r);
        float w = exp(-dot(c - fg, c - fg) * 55.);
        acc += c * w; ws += w;
      }
    }
    vec3 sm = acc / ws;
    vec3 soft = sm + (fg - sm) * 0.22;
    col = mix(col, soft, skin * min(1., uSkin * 1.1));
  }
  // eyes: brighter whites and iris, lighter shadows underneath
  if (uEyeBright > 0.001) {
    for (int e = 0; e < 2; e++) {
      vec4 E = e == 0 ? uEyeR : uEyeL;
      vec2 C = A(E.xy);
      float t = ellipse(P, C, vec2(E.z * 1.05, max(E.w, E.z * 0.2) * 1.3));
      float w = smoothstep(1., 0.55, t) * uEyeBright;
      vec3 b = (col - 0.5) * 1.12 + 0.5;
      col = mix(col, b * 1.16 + 0.025, w);
      float u = ellipse(P, C + toWorld(vec2(0., E.z * 0.62)), vec2(E.z * 1.15, E.z * 0.42));
      col = mix(col, col * 1.12 + 0.025, smoothstep(1., 0.2, u) * skin * uEyeBright * 0.75);
    }
  }
  float l = luma(col);
  // teeth: only the bright parts inside the mouth, less yellow and a touch brighter
  if (uTeeth > 0.001 && mouth > 0.01) {
    float w = mouth * smoothstep(0.28, 0.55, l) * uTeeth;
    vec3 white = mix(vec3(l), col, 0.3) * 1.08 + 0.03;
    col = mix(col, white, w * 0.9);
  }
  // lips: new colour with the lips' own light and shade
  if (uLipAmt > 0.001 && lips > 0.01) {
    vec3 tint = uLipCol * (0.3 + 1.35 * l) + max(l - 0.62, 0.) * 0.9;
    col = mix(col, tint, lips * uLipAmt);
  }
  // blush: soft colour on the cheeks, skin only
  if (uBlushAmt > 0.001) {
    float t1 = ellipse(P, A(uCheekR.xy), vec2(uCheekR.z, uCheekR.z * 0.72));
    float t2 = ellipse(P, A(uCheekL.xy), vec2(uCheekL.z, uCheekL.z * 0.72));
    float w = (exp(-t1 * t1 * 2.6) + exp(-t2 * t2 * 2.6)) * skin * uBlushAmt;
    col = mix(col, col * uBlushCol * 1.22, w * 0.55);
  }
  return col;
}

void main(){
  vec2 px = 1./uRes;
  vec2 ip = vec2(uv.x, 1. - uv.y);
  vec2 sp = uFaceOn > 0.5 ? warp(ip) : ip;   // where in the camera frame this pixel comes from
  vec3 fg = vidI(sp);
  if (uFaceOn > 0.5) fg = faceFx(fg, sp);
  // touch-up without a face in view: edge-preserving smoothing on the whole picture
  else if (uSmooth > 0.001) {
    vec3 acc = fg; float wsum = 1.;
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 0.7853981;
      vec2 off = vec2(cos(a), sin(a)) * px * 3.0;
      vec3 c = vid(uv + off);
      float w = exp(-dot(c-fg, c-fg) * 60.);
      acc += c*w; wsum += w;
    }
    fg = mix(fg, acc/wsum, uSmooth);
  }
  float m = uMaskOn > 0.5 ? texture(uAlpha, vec2(sp.x, 1. - sp.y)).r : 1.;
  vec3 bg = fg;
  if (uBgMode == 1) { vec4 b = texture(uBlur, uv); bg = b.a > 0.002 ? b.rgb / b.a : vid(uv); }
  else if (uBgMode == 2) { vec2 t = (vec2(uv.x, 1.-uv.y) - 0.5) * uImgFit.xy + 0.5 + uImgFit.zw; bg = texture(uImage, t).rgb; }
  vec3 col = uBgMode == 0 ? fg : mix(bg, fg, m);
  float person = uMaskOn > 0.5 ? m : 1.;

  // lighting
  col = pow(max(col, 0.), vec3(uGamma)) * uExposure;
  vec2 d = (uv - vec2(uKeyPos.x, 1.-uKeyPos.y)) * vec2(uRes.x/uRes.y, 1.);
  float key = exp(-dot(d, d) / max(0.001, uKeyRadius*uKeyRadius));
  col += uKeyColor * key * uKeyStrength * mix(0.35, 1., person);
  col += (uRimL * smoothstep(0.55, 0.0, uv.x) + uRimR * smoothstep(0.45, 1.0, uv.x)) * uRim * person;
  col *= mix(1., mix(0.25, 1., key), uSpot);
  vec2 v = uv - 0.5; col *= 1. - uVignette * dot(v, v) * 2.2;

  // look
  col = (col - 0.5) * uCon + 0.5 + uBri;
  float l = luma(col);
  col = mix(vec3(l), col, uSat);
  vec3 sep = vec3(dot(col, vec3(0.393, 0.769, 0.189)), dot(col, vec3(0.349, 0.686, 0.168)), dot(col, vec3(0.272, 0.534, 0.131)));
  col = mix(col, sep, uSepia);
  col *= uTint;
  col += (uShadowTint * (1. - l) + uHighTint * l) * uSplit;
  col = uFade + col * (1. - uFade);
  if (uPoster > 1.5) col = floor(col * uPoster + 0.5) / uPoster;
  o = vec4(clamp(col, 0., 1.), 1.);
}`;

import { LIPS, BLUSH, WARPS } from "./face.js";

export const LOOKS = {
  natural: { label: "Natural", sat: 1, con: 1, bri: 0, tint: [1, 1, 1], sepia: 0, fade: 0, poster: 0, split: 0 },
  warm: { label: "Warm", sat: 1.08, con: 1.04, bri: 0.01, tint: [1.07, 1.0, 0.9], sepia: 0, fade: 0, poster: 0, split: 0 },
  cool: { label: "Cool", sat: 0.95, con: 1.05, bri: 0, tint: [0.92, 1.0, 1.1], sepia: 0, fade: 0, poster: 0, split: 0 },
  vivid: { label: "Vivid", sat: 1.45, con: 1.12, bri: 0.0, tint: [1, 1, 1], sepia: 0, fade: 0, poster: 0, split: 0 },
  noir: { label: "Noir", sat: 0, con: 1.35, bri: -0.03, tint: [1, 1, 1], sepia: 0, fade: 0.02, poster: 0, split: 0 },
  vintage: { label: "Vintage", sat: 0.8, con: 0.92, bri: 0.02, tint: [1.04, 1.0, 0.92], sepia: 0.45, fade: 0.08, poster: 0, split: 0 },
  neon: { label: "Neon", sat: 1.35, con: 1.15, bri: 0, tint: [1, 1, 1], sepia: 0, fade: 0, poster: 0, split: 0.22, shadowTint: [0.15, -0.05, 0.35], highTint: [0.3, -0.08, 0.15] },
  comic: { label: "Comic", sat: 1.6, con: 1.25, bri: 0.02, tint: [1, 1, 1], sepia: 0, fade: 0, poster: 5, split: 0 },
  dream: { label: "Dream", sat: 0.9, con: 0.85, bri: 0.04, tint: [1.05, 0.98, 1.06], sepia: 0, fade: 0.12, poster: 0, split: 0.12, shadowTint: [0.1, 0.0, 0.18], highTint: [0.15, 0.08, 0.05] },
};

export const LIGHTS = {
  off: { label: "Off" },
  studio: { label: "Soft studio", exposure: 1.06, key: [1.0, 0.92, 0.82], keyStrength: 0.16, keyRadius: 0.32, vignette: 0.25 },
  boost: { label: "Low-light boost", exposure: 1.35, gamma: 0.8, smooth: 0.35, key: [1, 1, 1], keyStrength: 0.06, keyRadius: 0.4 },
  ring: { label: "Ring light", exposure: 1.12, key: [0.95, 0.98, 1.0], keyStrength: 0.22, keyRadius: 0.26, vignette: 0.1 },
  golden: { label: "Golden hour", exposure: 1.04, key: [1.0, 0.62, 0.25], keyStrength: 0.28, keyRadius: 0.38, vignette: 0.3, keyShift: [-0.12, -0.08] },
  rim: { label: "Neon rim", exposure: 0.95, rimL: [0.9, 0.1, 0.8], rimR: [0.1, 0.8, 1.0], rim: 0.35, vignette: 0.35 },
  spot: { label: "Spotlight", exposure: 1.1, key: [1, 0.95, 0.9], keyStrength: 0.15, keyRadius: 0.3, spot: 0.75, vignette: 0.2 },
};

export class Fx {
  constructor(width, height) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = width;
    this.canvas.height = height;
    const gl = this.canvas.getContext("webgl2", { premultipliedAlpha: false, preserveDrawingBuffer: false, antialias: false });
    if (!gl) throw new Error("WebGL2 not available");
    this.gl = gl;
    this.progDown = this.program(FS_DOWN);
    this.progBlur = this.program(FS_BLUR);
    this.progFinal = this.program(FS_FINAL);
    this.progPack = this.program(FS_PACK);
    this.progBox = this.program(FS_BOX);
    this.progCoef = this.program(FS_COEF);
    this.progAlpha = this.program(FS_ALPHA);
    // float targets are needed for the guided filter; without them we fall back to the plain mask
    this.floatOK = !!gl.getExtension("EXT_color_buffer_float");
    this.matte = { radius: 6, eps: 0.001, edge: [0.45, 0.65] };
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.texVideo = this.texture();
    this.texMask = this.texture();
    this.texImage = this.texture();
    this.texFace = this.texture();
    this.face = null; this.faceVersion = -1;
    gl.bindTexture(gl.TEXTURE_2D, this.texMask);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([255]));
    gl.bindTexture(gl.TEXTURE_2D, this.texImage);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([40, 30, 60, 255]));
    this.imgAspect = 1;
    this.resizeTargets(width, height);
    this.maskBytes = null;
    this.settings = { bg: "none", look: "natural", light: "off", brightness: 0, touchup: 0 };
    this.facePos = [0.5, 0.42];
    this.hasMask = false;
  }

  program(fs) {
    const gl = this.gl;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, "p");
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    p.u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); p.u[info.name] = gl.getUniformLocation(p, info.name); }
    return p;
  }

  texture() {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  target(w, h, float) {
    const gl = this.gl;
    const tex = this.texture();
    if (float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fb, w, h };
  }

  resizeTargets(w, h) {
    this.small = [this.target(Math.round(w / 4), Math.round(h / 4)), this.target(Math.round(w / 4), Math.round(h / 4))];
    this.alpha = this.target(w, h);
    if (this.floatOK) {
      const gw = Math.round(w / 2), gh = Math.round(h / 2);
      this.mid = [this.target(gw, gh, true), this.target(gw, gh, true)];
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.mid[0].fb);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) this.floatOK = false;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
  }

  // background images for thumbnails: upload each one once, then just switch between them
  useImage(key, source) {
    if (!this.images) this.images = new Map();
    let t = this.images.get(key);
    if (!t) {
      const gl = this.gl;
      t = { tex: this.texture(), aspect: (source.width || source.videoWidth) / (source.height || source.videoHeight) };
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      this.images.set(key, t);
    }
    this.texImage = t.tex;
    this.imgAspect = t.aspect;
  }

  setImage(source) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texImage);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    this.imgAspect = (source.width || source.videoWidth) / (source.height || source.videoHeight);
  }

  // mask: Uint8Array (w*h) person matte, already cleaned up by MatteCleaner
  setMask(bytes, w, h) {
    const gl = this.gl;
    if (!this.maskBytes || this.maskBytes.length !== w * h) { this.maskBytes = new Uint8Array(w * h); this.maskW = w; this.maskH = h; }
    const b = this.maskBytes;
    b.set(bytes);
    gl.bindTexture(gl.TEXTURE_2D, this.texMask);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, b);
    this.hasMask = true;
  }

  // reuse another Fx's latest person mask (for thumbnails)
  copyMaskFrom(other) {
    if (!other.maskBytes) { this.hasMask = false; return; }
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texMask);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, other.maskW, other.maskH, 0, gl.RED, gl.UNSIGNED_BYTE, other.maskBytes);
    this.hasMask = other.hasMask;
    this.facePos = other.facePos;
  }

  // face geometry from face.js (or null when no face is in view)
  setFace(geo) {
    this.face = geo;
    if (!geo || geo.version === this.faceVersion) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texFace);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, geo.canvas);
    this.faceVersion = geo.version;
  }

  quad(prog) {
    const gl = this.gl;
    gl.useProgram(prog);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // person mask -> refined alpha (this.alpha, full output size). Video texture must be current.
  refineMask() {
    const gl = this.gl, M = this.matte;
    const guided = this.floatOK && M.radius > 0;
    const R = Math.max(2, Math.min(16, Math.round((M.radius * this.canvas.width) / 800)));
    if (guided) {
      const [a, b] = this.mid;
      gl.viewport(0, 0, a.w, a.h);
      gl.bindFramebuffer(gl.FRAMEBUFFER, a.fb);
      gl.useProgram(this.progPack);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texVideo); gl.uniform1i(this.progPack.u.uVideo, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.texMask); gl.uniform1i(this.progPack.u.uMask, 1);
      this.quad(this.progPack);
      const box = () => {
        const p = this.progBox;
        gl.useProgram(p);
        gl.uniform1i(p.u.uTex, 0); gl.uniform1i(p.u.uR, R);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, b.fb); gl.bindTexture(gl.TEXTURE_2D, a.tex);
        gl.uniform2i(p.u.uDir, 1, 0); this.quad(p);
        gl.bindFramebuffer(gl.FRAMEBUFFER, a.fb); gl.bindTexture(gl.TEXTURE_2D, b.tex);
        gl.uniform2i(p.u.uDir, 0, 1); this.quad(p);
      };
      box(); // a = means of I, p, II, Ip
      gl.useProgram(this.progCoef);
      gl.bindFramebuffer(gl.FRAMEBUFFER, b.fb);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, a.tex);
      gl.uniform1i(this.progCoef.u.uTex, 0); gl.uniform1f(this.progCoef.u.uEps, M.eps);
      this.quad(this.progCoef);
      // b = a,b coefficients; average them (box reads a, so swap roles)
      gl.useProgram(this.progBox);
      const p = this.progBox;
      gl.uniform1i(p.u.uTex, 0); gl.uniform1i(p.u.uR, R);
      gl.bindFramebuffer(gl.FRAMEBUFFER, a.fb); gl.bindTexture(gl.TEXTURE_2D, b.tex);
      gl.uniform2i(p.u.uDir, 1, 0); this.quad(p);
      gl.bindFramebuffer(gl.FRAMEBUFFER, b.fb); gl.bindTexture(gl.TEXTURE_2D, a.tex);
      gl.uniform2i(p.u.uDir, 0, 1); this.quad(p);
    }
    const p = this.progAlpha, u = p.u;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.alpha.fb);
    gl.viewport(0, 0, this.alpha.w, this.alpha.h);
    gl.useProgram(p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texVideo); gl.uniform1i(u.uVideo, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.texMask); gl.uniform1i(u.uMask, 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, guided ? this.mid[1].tex : this.texMask); gl.uniform1i(u.uCoef, 2);
    gl.uniform1i(u.uGuided, guided ? 1 : 0);
    gl.uniform2f(u.uEdge, M.edge[0], M.edge[1]);
    this.quad(p);
  }

  // reuseFrame: the camera frame is already on the GPU (several thumbnails from one frame)
  render(video, reuseFrame = false) {
    const gl = this.gl, s = this.settings;
    const W = this.canvas.width, H = this.canvas.height;
    gl.bindTexture(gl.TEXTURE_2D, this.texVideo);
    if (!reuseFrame) {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    }

    const bgMode = s.bg === "none" ? 0 : s.bg.startsWith("blur") ? 1 : 2;
    const maskOn = bgMode !== 0 && this.hasMask ? 1 : 0;

    if (maskOn) this.refineMask();

    if (bgMode === 1) {
      const [a, b] = this.small;
      gl.bindFramebuffer(gl.FRAMEBUFFER, a.fb);
      gl.viewport(0, 0, a.w, a.h);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texVideo);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.alpha.tex);
      gl.useProgram(this.progDown);
      gl.uniform1i(this.progDown.u.uVideo, 0); gl.uniform1i(this.progDown.u.uAlpha, 1); gl.uniform1f(this.progDown.u.uMaskOn, maskOn);
      this.quad(this.progDown);
      const passes = s.bg === "blur-strong" ? 4 : 2;
      gl.useProgram(this.progBlur);
      gl.uniform1i(this.progBlur.u.uTex, 0);
      gl.activeTexture(gl.TEXTURE0);
      for (let i = 0; i < passes; i++) {
        const spread = 1 + i * 0.8;
        gl.bindFramebuffer(gl.FRAMEBUFFER, b.fb); gl.bindTexture(gl.TEXTURE_2D, a.tex);
        gl.uniform2f(this.progBlur.u.uDir, spread / a.w, 0); this.quad(this.progBlur);
        gl.bindFramebuffer(gl.FRAMEBUFFER, a.fb); gl.bindTexture(gl.TEXTURE_2D, b.tex);
        gl.uniform2f(this.progBlur.u.uDir, 0, spread / a.h); this.quad(this.progBlur);
      }
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    const p = this.progFinal, u = p.u;
    gl.useProgram(p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texVideo); gl.uniform1i(u.uVideo, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.alpha.tex); gl.uniform1i(u.uAlpha, 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.small[0].tex); gl.uniform1i(u.uBlur, 2);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.texImage); gl.uniform1i(u.uImage, 3);
    gl.uniform2f(u.uRes, W, H);
    gl.uniform1i(u.uBgMode, bgMode);
    gl.uniform1f(u.uMaskOn, maskOn);
    // cover-fit the background image
    const va = W / H, ia = this.imgAspect || va;
    const sx = ia > va ? va / ia : 1, sy = ia > va ? 1 : ia / va;
    gl.uniform4f(u.uImgFit, sx, sy, 0, 0);

    const L = LIGHTS[s.light] || LIGHTS.off;
    const bright = s.brightness || 0;
    gl.uniform1f(u.uExposure, (L.exposure || 1) * (1 + bright * 0.4) * (this.gain || 1));
    gl.uniform1f(u.uGamma, L.gamma || 1);
    gl.uniform1f(u.uSmooth, Math.min(0.9, (s.touchup || 0) * 0.85 + (L.smooth || 0)));
    gl.uniform1f(u.uVignette, L.vignette || 0);
    gl.uniform1f(u.uSpot, L.spot || 0);
    gl.uniform3fv(u.uKeyColor, L.key || [0, 0, 0]);
    const shift = L.keyShift || [0, 0];
    gl.uniform2f(u.uKeyPos, this.facePos[0] + shift[0], this.facePos[1] + shift[1]);
    gl.uniform1f(u.uKeyRadius, L.keyRadius || 0.3);
    gl.uniform1f(u.uKeyStrength, L.keyStrength || 0);
    gl.uniform3fv(u.uRimL, L.rimL || [0, 0, 0]);
    gl.uniform3fv(u.uRimR, L.rimR || [0, 0, 0]);
    gl.uniform1f(u.uRim, L.rim || 0);

    // face
    const f = this.face;
    const lip = LIPS[s.lips] || LIPS.none, blush = BLUSH[s.blush] || BLUSH.none;
    const mk = s.makeup == null ? 0.6 : s.makeup;
    const warpId = (WARPS[s.warp] || WARPS.none).id;
    const faceOn = !!f && (s.touchup > 0 || s.eyeBright > 0 || s.teeth > 0 || s.slim > 0 || s.eyeBig > 0 || !!lip.c || !!blush.c || warpId > 0 || (L.smooth || 0) > 0);
    gl.uniform1f(u.uFaceOn, faceOn ? 1 : 0);
    if (faceOn) {
      gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, this.texFace); gl.uniform1i(u.uFaceMask, 4);
      gl.uniform1f(u.uAsp, W / H);
      gl.uniform1f(u.uRoll, f.roll);
      gl.uniform1f(u.uSkinR, f.faceW * 0.022);
      gl.uniform4fv(u.uBox, f.box);
      gl.uniform4fv(u.uEyeR, f.eyeR); gl.uniform4fv(u.uEyeL, f.eyeL);
      gl.uniform4f(u.uFace, f.center[0], f.center[1], f.faceW, f.faceH);
      gl.uniform3fv(u.uMouth, f.mouth);
      gl.uniform3fv(u.uCheekR, f.cheekR); gl.uniform3fv(u.uCheekL, f.cheekL);
      gl.uniform1f(u.uSkin, Math.max(s.touchup || 0, L.smooth || 0));
      gl.uniform1f(u.uEyeBright, s.eyeBright || 0);
      gl.uniform1f(u.uTeeth, s.teeth || 0);
      gl.uniform1f(u.uSlim, s.slim || 0);
      gl.uniform1f(u.uEyeBig, s.eyeBig || 0);
      gl.uniform1f(u.uLipAmt, lip.c ? 0.25 + mk * 0.6 : 0);
      gl.uniform3fv(u.uLipCol, lip.c || [0, 0, 0]);
      gl.uniform1f(u.uBlushAmt, blush.c ? 0.2 + mk * 0.8 : 0);
      gl.uniform3fv(u.uBlushCol, blush.c || [1, 1, 1]);
      gl.uniform1i(u.uWarp, warpId);
    }

    const K = LOOKS[s.look] || LOOKS.natural;
    gl.uniform1f(u.uSat, K.sat); gl.uniform1f(u.uCon, K.con); gl.uniform1f(u.uBri, K.bri);
    gl.uniform1f(u.uSepia, K.sepia); gl.uniform1f(u.uFade, K.fade); gl.uniform1f(u.uPoster, K.poster || 0);
    gl.uniform1f(u.uSplit, K.split || 0);
    gl.uniform3fv(u.uTint, K.tint);
    gl.uniform3fv(u.uShadowTint, K.shadowTint || [0, 0, 0]);
    gl.uniform3fv(u.uHighTint, K.highTint || [0, 0, 0]);
    this.quad(p);
    return this.canvas;
  }
}

// GLSL ES 3.00 sources. The chunk shader is the important one: it reproduces
// vanilla's directional face shading, smooth lighting, biome tinting via a
// second overlay texture lookup, and linear distance fog.

const COMMON_FOG = /* glsl */ `
  uniform vec3  uFogColor;
  uniform float uFogStart;
  uniform float uFogEnd;
  uniform float uFogDensity;   // >0 switches to exponential (underwater / lava)

  vec3 applyFog(vec3 color, float dist) {
    float f;
    if (uFogDensity > 0.0) {
      f = 1.0 - exp(-dist * uFogDensity);
    } else {
      f = (dist - uFogStart) / max(0.001, uFogEnd - uFogStart);
    }
    return mix(color, uFogColor, clamp(f, 0.0, 1.0));
  }
`;

// Vanilla's light curve: b = f / (4 - 3f), lifted by an ambient floor.
const COMMON_LIGHT = /* glsl */ `
  uniform float uSkyLight;    // 0..1, from the day/night cycle
  uniform float uGamma;       // brightness option, 0 = moody, 1 = bright
  uniform float uNightVision;

  float lightCurve(float f) {
    return f / (4.0 - 3.0 * f);
  }

  float computeBrightness(float skyLevel, float blockLevel) {
    float level = max(skyLevel * uSkyLight, blockLevel);
    float b = lightCurve(level);
    // The brightness slider lifts the darkest values without blowing out highlights.
    b = mix(b, b * 0.6 + 0.4, uGamma * 0.55);
    b = max(b, uNightVision);
    return clamp(b + 0.03, 0.0, 1.0);
  }
`;

// ---------------------------------------------------------------- chunk

export const CHUNK_VS = /* glsl */ `#version 300 es
precision highp float;

// Buffer 0 (uint16): position, uv, layer, overlay
in vec3  aPos;        // chunk-local, in 1/32 block units
in vec2  aUV;         // in 1/256 units
in float aLayer;
in float aOverlay;    // 65535 = no overlay
// Buffer 1 (uint8): sky light, block light, shade (AO * face shade), flags, tint
in vec3  aLight;      // normalized: sky, block, shade
in float aFlags;      // 0..255, bit0 = water anim, bit1 = lava anim
in vec3  aTint;       // normalized rgb

uniform mat4  uViewProj;
uniform vec3  uChunkOrigin;
uniform vec3  uCameraPos;
uniform float uTime;

out vec2  vUV;
flat out float vLayer;
flat out float vOverlay;
flat out float vFlags;
out vec3  vTint;
out vec2  vLightShade;   // x = sky light level (0..1), y = shade (AO * face shade)
out float vBlockLight;
out float vDist;
out vec3  vWorld;

void main() {
  vec3 local = aPos * (1.0 / 32.0);
  vec3 world = local + uChunkOrigin;
  vWorld = world;

  vec2 uv = aUV * (1.0 / 256.0);
  int flags = int(aFlags + 0.5);
  if ((flags & 1) != 0) {
    // Flowing water: scroll the sheet and add a gentle lateral wobble.
    uv.y += uTime * 0.35;
    uv.x += sin(uTime * 1.6 + world.z * 0.7) * 0.03;
  } else if ((flags & 2) != 0) {
    uv.y += uTime * 0.12;
    uv.x += sin(uTime * 0.7 + world.x * 0.4) * 0.05;
  }
  vUV = uv;

  vLayer = aLayer;
  vOverlay = aOverlay;
  vFlags = aFlags;
  vTint = aTint;
  // Sky and block light stay separate so the fragment stage can apply the
  // vanilla curve after the day/night multiplier is folded into sky light.
  vLightShade = vec2(aLight.x, aLight.z);
  vBlockLight = aLight.y;
  vDist = distance(world, uCameraPos);

  gl_Position = uViewProj * vec4(world, 1.0);
}
`;

export const CHUNK_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2DArray;

in vec2  vUV;
flat in float vLayer;
flat in float vOverlay;
flat in float vFlags;
in vec3  vTint;
in vec2  vLightShade;
in float vBlockLight;
in float vDist;
in vec3  vWorld;

uniform sampler2DArray uAtlas;
uniform float uAlphaCutoff;
uniform float uOpacity;

${COMMON_LIGHT}
${COMMON_FOG}

out vec4 fragColor;

void main() {
  vec4 c = texture(uAtlas, vec3(vUV, vLayer));

  if (vOverlay < 65000.0) {
    // Grass-block sides: the base stays neutral, only the overlay is tinted.
    vec4 ov = texture(uAtlas, vec3(vUV, vOverlay));
    c.rgb = mix(c.rgb, ov.rgb * vTint, ov.a);
  } else {
    c.rgb *= vTint;
  }

  if (c.a < uAlphaCutoff) discard;

  float brightness = computeBrightness(vLightShade.x, vBlockLight);
  c.rgb *= brightness * vLightShade.y;
  c.rgb = applyFog(c.rgb, vDist);

  fragColor = vec4(c.rgb, c.a * uOpacity);
}
`;

// ---------------------------------------------------------------- sky

export const SKY_VS = /* glsl */ `#version 300 es
precision highp float;
in vec3 aPos;
uniform mat4 uViewProj;
uniform vec3 uCameraPos;
out vec3 vDir;
void main() {
  vDir = aPos;
  vec4 p = uViewProj * vec4(aPos * 256.0 + uCameraPos, 1.0);
  // Force the dome to the far plane so it never occludes geometry.
  gl_Position = p.xyww;
}
`;

export const SKY_FS = /* glsl */ `#version 300 es
precision highp float;
in vec3 vDir;

uniform vec3  uSkyTop;
uniform vec3  uSkyHorizon;
uniform vec3  uSunsetColor;
uniform float uSunsetStrength;
uniform vec3  uSunDir;
uniform float uStarAlpha;

out vec4 fragColor;

// Cheap hash-based starfield.
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 col = mix(uSkyHorizon, uSkyTop, pow(h, 0.65));

  // Sunset/sunrise band hugging the horizon on the sun's side.
  if (uSunsetStrength > 0.0) {
    float band = pow(1.0 - abs(d.y), 6.0);
    float side = max(0.0, dot(normalize(vec3(uSunDir.x, 0.0, uSunDir.z)), normalize(vec3(d.x, 0.0, d.z))));
    col = mix(col, uSunsetColor, band * pow(side, 2.0) * uSunsetStrength);
  }

  if (uStarAlpha > 0.001 && d.y > -0.05) {
    vec3 cell = floor(d * 220.0);
    float s = hash13(cell);
    if (s > 0.9975) {
      float tw = 0.6 + 0.4 * hash13(cell + 7.0);
      col += vec3(uStarAlpha * tw);
    }
  }

  fragColor = vec4(col, 1.0);
}
`;

// ---------------------------------------------------------------- celestial (sun / moon)

export const CELESTIAL_VS = /* glsl */ `#version 300 es
precision highp float;
in vec2 aCorner;
uniform mat4 uViewProj;
uniform vec3 uCameraPos;
uniform vec3 uDir;      // direction from camera toward the body
uniform float uSize;
out vec2 vUV;
void main() {
  vUV = aCorner * 0.5 + 0.5;
  vec3 f = normalize(uDir);
  vec3 r = normalize(cross(abs(f.y) > 0.99 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0), f));
  vec3 u = cross(f, r);
  vec3 pos = uCameraPos + f * 150.0 + (r * aCorner.x + u * aCorner.y) * uSize;
  vec4 p = uViewProj * vec4(pos, 1.0);
  gl_Position = p.xyww;
}
`;

export const CELESTIAL_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2DArray;
in vec2 vUV;
uniform sampler2DArray uAtlas;
uniform float uLayer;
uniform float uAlpha;
uniform vec3 uColor;
out vec4 fragColor;
void main() {
  vec4 c = texture(uAtlas, vec3(vUV, uLayer));
  if (c.a < 0.05) discard;
  fragColor = vec4(c.rgb * uColor, c.a * uAlpha);
}
`;

// ---------------------------------------------------------------- clouds

export const CLOUD_VS = /* glsl */ `#version 300 es
precision highp float;
in vec3 aPos;
in vec3 aNormal;
uniform mat4 uViewProj;
uniform vec3 uOffset;
out float vShade;
out vec3 vWorld;
void main() {
  vec3 world = aPos + uOffset;
  vWorld = world;
  // Flat directional shading, matching the block face shades.
  vShade = aNormal.y > 0.5 ? 1.0 : (aNormal.y < -0.5 ? 0.7 : 0.85);
  gl_Position = uViewProj * vec4(world, 1.0);
}
`;

export const CLOUD_FS = /* glsl */ `#version 300 es
precision highp float;
in float vShade;
in vec3 vWorld;
uniform vec3 uColor;
uniform float uAlpha;
uniform vec3 uCameraPos;
uniform float uFadeStart;
uniform float uFadeEnd;
out vec4 fragColor;
void main() {
  float d = distance(vWorld.xz, uCameraPos.xz);
  float a = uAlpha * (1.0 - clamp((d - uFadeStart) / max(1.0, uFadeEnd - uFadeStart), 0.0, 1.0));
  if (a < 0.01) discard;
  fragColor = vec4(uColor * vShade, a);
}
`;

// ---------------------------------------------------------------- entities

export const ENTITY_VS = /* glsl */ `#version 300 es
precision highp float;

in vec3  aPos;
in vec2  aUV;
in vec3  aNormal;
in float aPart;

uniform mat4 uViewProj;
uniform mat4 uModel;
uniform mat4 uParts[16];
uniform vec3 uCameraPos;

out vec2  vUV;
out float vShade;
out float vDist;

void main() {
  mat4 part = uParts[int(aPart + 0.5)];
  vec4 local = part * vec4(aPos, 1.0);
  vec4 world = uModel * local;

  vec3 n = normalize(mat3(uModel) * mat3(part) * aNormal);
  // Same directional shading the terrain uses, so mobs sit in the world.
  float shade = 0.6;
  if (n.y > 0.5) shade = 1.0;
  else if (n.y < -0.5) shade = 0.5;
  else if (abs(n.z) > abs(n.x)) shade = 0.8;
  vShade = shade;

  vUV = aUV;
  vDist = distance(world.xyz, uCameraPos);
  gl_Position = uViewProj * world;
}
`;

export const ENTITY_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2DArray;

in vec2  vUV;
in float vShade;
in float vDist;

uniform sampler2DArray uSkins;
uniform float uLayer;
uniform float uBrightness;
uniform vec4  uOverlayColor;   // damage flash / spawn tint, rgb + strength
uniform float uAlpha;

${COMMON_FOG}

out vec4 fragColor;

void main() {
  vec4 c = texture(uSkins, vec3(vUV, uLayer));
  if (c.a < 0.1) discard;
  c.rgb *= vShade * uBrightness;
  c.rgb = mix(c.rgb, uOverlayColor.rgb, uOverlayColor.a);
  c.rgb = applyFog(c.rgb, vDist);
  fragColor = vec4(c.rgb, c.a * uAlpha);
}
`;

// ---------------------------------------------------------------- particles

export const PARTICLE_VS = /* glsl */ `#version 300 es
precision highp float;

in vec2  aCorner;     // -0.5 .. 0.5 quad corner
in vec3  aCenter;     // world position
in vec2  aSize;       // width, height
in vec4  aColor;
in vec4  aUVRect;     // u0, v0, u1, v1
in float aLayer;
in float aLight;

uniform mat4 uViewProj;
uniform vec3 uRight;
uniform vec3 uUp;
uniform vec3 uCameraPos;

out vec2  vUV;
flat out float vLayer;
out vec4  vColor;
out float vDist;

void main() {
  vec3 world = aCenter + uRight * (aCorner.x * aSize.x) + uUp * (aCorner.y * aSize.y);
  vUV = mix(aUVRect.xy, aUVRect.zw, aCorner + 0.5);
  vLayer = aLayer;
  vColor = vec4(aColor.rgb * aLight, aColor.a);
  vDist = distance(world, uCameraPos);
  gl_Position = uViewProj * vec4(world, 1.0);
}
`;

export const PARTICLE_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2DArray;

in vec2  vUV;
flat in float vLayer;
in vec4  vColor;
in float vDist;

uniform sampler2DArray uAtlas;
uniform float uUseTexture;

${COMMON_FOG}

out vec4 fragColor;

void main() {
  vec4 c = vColor;
  if (uUseTexture > 0.5) {
    vec4 t = texture(uAtlas, vec3(vUV, vLayer));
    if (t.a < 0.1) discard;
    c.rgb *= t.rgb;
    c.a *= t.a;
  }
  c.rgb = applyFog(c.rgb, vDist);
  fragColor = c;
}
`;

// ---------------------------------------------------------------- flat colour (selection box, debug lines)

export const LINE_VS = /* glsl */ `#version 300 es
precision highp float;
in vec3 aPos;
uniform mat4 uViewProj;
uniform mat4 uModel;
void main() { gl_Position = uViewProj * uModel * vec4(aPos, 1.0); }
`;

export const LINE_FS = /* glsl */ `#version 300 es
precision highp float;
uniform vec4 uColor;
out vec4 fragColor;
void main() { fragColor = uColor; }
`;

// ---------------------------------------------------------------- block breaking overlay

export const BREAK_VS = /* glsl */ `#version 300 es
precision highp float;
in vec3 aPos;
in vec2 aUV;
uniform mat4 uViewProj;
uniform mat4 uModel;
out vec2 vUV;
void main() {
  vUV = aUV;
  gl_Position = uViewProj * uModel * vec4(aPos, 1.0);
}
`;

export const BREAK_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2DArray;
in vec2 vUV;
uniform sampler2DArray uAtlas;
uniform float uLayer;
out vec4 fragColor;
void main() {
  vec4 c = texture(uAtlas, vec3(vUV, uLayer));
  if (c.a < 0.02) discard;
  fragColor = vec4(0.0, 0.0, 0.0, c.a * 0.75);
}
`;

// ---------------------------------------------------------------- fullscreen post (underwater tint, damage vignette)

export const POST_VS = /* glsl */ `#version 300 es
precision highp float;
in vec2 aPos;
out vec2 vUV;
void main() {
  vUV = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

export const POST_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUV;
uniform vec4 uTint;
out vec4 fragColor;
void main() { fragColor = uTint; }
`;

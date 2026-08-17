// Minimal 3D math. Column-major mat4 laid out to match WebGL's uniformMatrix4fv
// (no transpose), i.e. m[col*4 + row].

export const DEG = Math.PI / 180;
export const TAU = Math.PI * 2;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (t) => t * t * (3 - 2 * t);
export const fract = (v) => v - Math.floor(v);
export const sign = Math.sign;

/** Shortest signed difference between two angles, in radians. */
export function angleDelta(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/** Frame-rate independent exponential approach. `rate` is the fraction closed per second. */
export function damp(a, b, rate, dt) {
  return lerp(a, b, 1 - Math.pow(1 - rate, dt * 60));
}

// ---------------------------------------------------------------- vec3

export const vec3 = {
  create: (x = 0, y = 0, z = 0) => new Float32Array([x, y, z]),
  set(o, x, y, z) { o[0] = x; o[1] = y; o[2] = z; return o; },
  copy(o, a) { o[0] = a[0]; o[1] = a[1]; o[2] = a[2]; return o; },
  add(o, a, b) { o[0] = a[0] + b[0]; o[1] = a[1] + b[1]; o[2] = a[2] + b[2]; return o; },
  sub(o, a, b) { o[0] = a[0] - b[0]; o[1] = a[1] - b[1]; o[2] = a[2] - b[2]; return o; },
  scale(o, a, s) { o[0] = a[0] * s; o[1] = a[1] * s; o[2] = a[2] * s; return o; },
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  lenSq: (a) => a[0] * a[0] + a[1] * a[1] + a[2] * a[2],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  cross(o, a, b) {
    const ax = a[0], ay = a[1], az = a[2], bx = b[0], by = b[1], bz = b[2];
    o[0] = ay * bz - az * by;
    o[1] = az * bx - ax * bz;
    o[2] = ax * by - ay * bx;
    return o;
  },
  normalize(o, a) {
    const l = Math.hypot(a[0], a[1], a[2]);
    if (l === 0) { o[0] = o[1] = o[2] = 0; return o; }
    o[0] = a[0] / l; o[1] = a[1] / l; o[2] = a[2] / l;
    return o;
  },
  lerp(o, a, b, t) {
    o[0] = a[0] + (b[0] - a[0]) * t;
    o[1] = a[1] + (b[1] - a[1]) * t;
    o[2] = a[2] + (b[2] - a[2]) * t;
    return o;
  },
  dist: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
  distSq(a, b) {
    const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
    return dx * dx + dy * dy + dz * dz;
  },
};

// ---------------------------------------------------------------- mat4

export const mat4 = {
  create() {
    const m = new Float32Array(16);
    m[0] = m[5] = m[10] = m[15] = 1;
    return m;
  },
  identity(o) {
    o.fill(0);
    o[0] = o[5] = o[10] = o[15] = 1;
    return o;
  },
  copy(o, a) { o.set(a); return o; },

  multiply(o, a, b) {
    const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
    const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
    const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
    const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
    for (let i = 0; i < 4; i++) {
      const b0 = b[i * 4], b1 = b[i * 4 + 1], b2 = b[i * 4 + 2], b3 = b[i * 4 + 3];
      o[i * 4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
      o[i * 4 + 1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
      o[i * 4 + 2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
      o[i * 4 + 3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
    }
    return o;
  },

  perspective(o, fovyRad, aspect, near, far) {
    const f = 1 / Math.tan(fovyRad / 2);
    o.fill(0);
    o[0] = f / aspect;
    o[5] = f;
    o[11] = -1;
    if (far != null && far !== Infinity) {
      const nf = 1 / (near - far);
      o[10] = (far + near) * nf;
      o[14] = 2 * far * near * nf;
    } else {
      o[10] = -1;
      o[14] = -2 * near;
    }
    return o;
  },

  ortho(o, left, right, bottom, top, near, far) {
    const lr = 1 / (left - right), bt = 1 / (bottom - top), nf = 1 / (near - far);
    o.fill(0);
    o[0] = -2 * lr;
    o[5] = -2 * bt;
    o[10] = 2 * nf;
    o[12] = (left + right) * lr;
    o[13] = (top + bottom) * bt;
    o[14] = (far + near) * nf;
    o[15] = 1;
    return o;
  },

  /**
   * Builds a view matrix from a position and Minecraft-style Euler angles.
   * yaw: 0 = looking toward +Z, increasing turns toward -X (matches vanilla).
   * pitch: positive looks down.
   */
  fpsView(o, pos, yaw, pitch) {
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    // Camera basis in world space. `up` must be exactly forward x right, or the
    // basis is not orthogonal and the vertical axis inverts as pitch grows:
    // with up = (sy*sp, cp, -cy*sp) the dot with forward is -2*sin(p)*cos(p),
    // which is zero only when looking level — so the world looked correct
    // straight ahead and turned upside down the moment you looked up or down.
    const fx = -sy * cp, fy = -sp, fz = cy * cp;      // forward
    const rx = cy, ry = 0, rz = sy;                    // right
    const ux = -sy * sp, uy = cp, uz = cy * sp;        // up = forward x right
    o[0] = rx; o[1] = ux; o[2] = -fx; o[3] = 0;
    o[4] = ry; o[5] = uy; o[6] = -fy; o[7] = 0;
    o[8] = rz; o[9] = uz; o[10] = -fz; o[11] = 0;
    o[12] = -(rx * pos[0] + ry * pos[1] + rz * pos[2]);
    o[13] = -(ux * pos[0] + uy * pos[1] + uz * pos[2]);
    o[14] = fx * pos[0] + fy * pos[1] + fz * pos[2];
    o[15] = 1;
    return o;
  },

  translate(o, a, x, y, z) {
    if (o !== a) o.set(a);
    o[12] = a[0] * x + a[4] * y + a[8] * z + a[12];
    o[13] = a[1] * x + a[5] * y + a[9] * z + a[13];
    o[14] = a[2] * x + a[6] * y + a[10] * z + a[14];
    o[15] = a[3] * x + a[7] * y + a[11] * z + a[15];
    return o;
  },

  scale(o, a, x, y, z) {
    o[0] = a[0] * x; o[1] = a[1] * x; o[2] = a[2] * x; o[3] = a[3] * x;
    o[4] = a[4] * y; o[5] = a[5] * y; o[6] = a[6] * y; o[7] = a[7] * y;
    o[8] = a[8] * z; o[9] = a[9] * z; o[10] = a[10] * z; o[11] = a[11] * z;
    o[12] = a[12]; o[13] = a[13]; o[14] = a[14]; o[15] = a[15];
    return o;
  },

  rotateX(o, a, rad) {
    const s = Math.sin(rad), c = Math.cos(rad);
    const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
    const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
    if (o !== a) { o[0] = a[0]; o[1] = a[1]; o[2] = a[2]; o[3] = a[3]; o[12] = a[12]; o[13] = a[13]; o[14] = a[14]; o[15] = a[15]; }
    o[4] = a10 * c + a20 * s; o[5] = a11 * c + a21 * s; o[6] = a12 * c + a22 * s; o[7] = a13 * c + a23 * s;
    o[8] = a20 * c - a10 * s; o[9] = a21 * c - a11 * s; o[10] = a22 * c - a12 * s; o[11] = a23 * c - a13 * s;
    return o;
  },

  rotateY(o, a, rad) {
    const s = Math.sin(rad), c = Math.cos(rad);
    const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
    const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
    if (o !== a) { o[4] = a[4]; o[5] = a[5]; o[6] = a[6]; o[7] = a[7]; o[12] = a[12]; o[13] = a[13]; o[14] = a[14]; o[15] = a[15]; }
    o[0] = a00 * c - a20 * s; o[1] = a01 * c - a21 * s; o[2] = a02 * c - a22 * s; o[3] = a03 * c - a23 * s;
    o[8] = a00 * s + a20 * c; o[9] = a01 * s + a21 * c; o[10] = a02 * s + a22 * c; o[11] = a03 * s + a23 * c;
    return o;
  },

  rotateZ(o, a, rad) {
    const s = Math.sin(rad), c = Math.cos(rad);
    const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
    const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
    if (o !== a) { o[8] = a[8]; o[9] = a[9]; o[10] = a[10]; o[11] = a[11]; o[12] = a[12]; o[13] = a[13]; o[14] = a[14]; o[15] = a[15]; }
    o[0] = a00 * c + a10 * s; o[1] = a01 * c + a11 * s; o[2] = a02 * c + a12 * s; o[3] = a03 * c + a13 * s;
    o[4] = a10 * c - a00 * s; o[5] = a11 * c - a01 * s; o[6] = a12 * c - a02 * s; o[7] = a13 * c - a03 * s;
    return o;
  },

  invert(o, a) {
    const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
    const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
    const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
    const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
    const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10;
    const b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
    const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
    const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31;
    const b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return null;
    det = 1 / det;
    o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
    o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
    o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
    o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
    o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
    o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
    o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
    o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
    o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
    return o;
  },
};

// ---------------------------------------------------------------- frustum

/**
 * Extracts the 6 clip planes from a view-projection matrix (Gribb/Hartmann).
 * Planes are [a,b,c,d] with the interior on the positive side.
 */
export function extractFrustum(out, m) {
  const p = out || new Float32Array(24);
  const rows = [
    [m[3] + m[0], m[7] + m[4], m[11] + m[8], m[15] + m[12]],   // left
    [m[3] - m[0], m[7] - m[4], m[11] - m[8], m[15] - m[12]],   // right
    [m[3] + m[1], m[7] + m[5], m[11] + m[9], m[15] + m[13]],   // bottom
    [m[3] - m[1], m[7] - m[5], m[11] - m[9], m[15] - m[13]],   // top
    [m[3] + m[2], m[7] + m[6], m[11] + m[10], m[15] + m[14]],  // near
    [m[3] - m[2], m[7] - m[6], m[11] - m[10], m[15] - m[14]],  // far
  ];
  for (let i = 0; i < 6; i++) {
    const r = rows[i];
    const inv = 1 / (Math.hypot(r[0], r[1], r[2]) || 1);
    p[i * 4] = r[0] * inv;
    p[i * 4 + 1] = r[1] * inv;
    p[i * 4 + 2] = r[2] * inv;
    p[i * 4 + 3] = r[3] * inv;
  }
  return p;
}

/** Conservative AABB-vs-frustum test. Returns false only when definitely outside. */
export function aabbInFrustum(planes, minX, minY, minZ, maxX, maxY, maxZ) {
  for (let i = 0; i < 6; i++) {
    const a = planes[i * 4], b = planes[i * 4 + 1], c = planes[i * 4 + 2], d = planes[i * 4 + 3];
    // Pick the AABB corner furthest along the plane normal.
    const px = a >= 0 ? maxX : minX;
    const py = b >= 0 ? maxY : minY;
    const pz = c >= 0 ? maxZ : minZ;
    if (a * px + b * py + c * pz + d < 0) return false;
  }
  return true;
}

// ---------------------------------------------------------------- AABB

export class AABB {
  constructor(minX = 0, minY = 0, minZ = 0, maxX = 0, maxY = 0, maxZ = 0) {
    this.minX = minX; this.minY = minY; this.minZ = minZ;
    this.maxX = maxX; this.maxY = maxY; this.maxZ = maxZ;
  }
  static fromCenter(x, y, z, w, h) {
    const hw = w / 2;
    return new AABB(x - hw, y, z - hw, x + hw, y + h, z + hw);
  }
  set(minX, minY, minZ, maxX, maxY, maxZ) {
    this.minX = minX; this.minY = minY; this.minZ = minZ;
    this.maxX = maxX; this.maxY = maxY; this.maxZ = maxZ;
    return this;
  }
  setFromCenter(x, y, z, w, h) {
    const hw = w / 2;
    return this.set(x - hw, y, z - hw, x + hw, y + h, z + hw);
  }
  offset(dx, dy, dz) {
    return new AABB(this.minX + dx, this.minY + dy, this.minZ + dz,
                    this.maxX + dx, this.maxY + dy, this.maxZ + dz);
  }
  expand(dx, dy, dz) {
    return new AABB(
      dx < 0 ? this.minX + dx : this.minX,
      dy < 0 ? this.minY + dy : this.minY,
      dz < 0 ? this.minZ + dz : this.minZ,
      dx > 0 ? this.maxX + dx : this.maxX,
      dy > 0 ? this.maxY + dy : this.maxY,
      dz > 0 ? this.maxZ + dz : this.maxZ,
    );
  }
  grow(v) {
    return new AABB(this.minX - v, this.minY - v, this.minZ - v,
                    this.maxX + v, this.maxY + v, this.maxZ + v);
  }
  intersects(o) {
    return this.minX < o.maxX && this.maxX > o.minX &&
           this.minY < o.maxY && this.maxY > o.minY &&
           this.minZ < o.maxZ && this.maxZ > o.minZ;
  }
  contains(x, y, z) {
    return x >= this.minX && x <= this.maxX &&
           y >= this.minY && y <= this.maxY &&
           z >= this.minZ && z <= this.maxZ;
  }
  get centerX() { return (this.minX + this.maxX) / 2; }
  get centerY() { return (this.minY + this.maxY) / 2; }
  get centerZ() { return (this.minZ + this.maxZ) / 2; }
}

// ---------------------------------------------------------------- colors

export const hexToRgb = (hex) => [
  ((hex >> 16) & 255) / 255,
  ((hex >> 8) & 255) / 255,
  (hex & 255) / 255,
];

export const rgbToHex = (r, g, b) =>
  ((Math.round(clamp(r, 0, 1) * 255) << 16) |
   (Math.round(clamp(g, 0, 1) * 255) << 8) |
   Math.round(clamp(b, 0, 1) * 255)) >>> 0;

export function mixHex(a, b, t) {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (
    (Math.round(ar + (br - ar) * t) << 16) |
    (Math.round(ag + (bg - ag) * t) << 8) |
    Math.round(ab + (bb - ab) * t)
  ) >>> 0;
}

export const cssHex = (hex) => '#' + (hex & 0xffffff).toString(16).padStart(6, '0');

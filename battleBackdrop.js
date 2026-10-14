// Procedural, per-map scrolling battlefield backdrops (view-only, drawn every frame from viewUpdating.js).
// Ground layers are locked to data.battle.scrollPx: the ground only moves when the clone advances (or
// retreats), so a still backdrop always means the intruders are the ones doing the walking.
// Background canvas, bottom to top: terrain tile, props tile, lights, low particles, speed streaks, light
// shafts, static lighting overlay. Foreground canvas (above the intruders): overhead tile (tree tops, same
// period as props), canopy tile (parallax overhangs), high particles; it turns see-through around each
// intruder so they stay readable while walking "under" the trees. Tiles use different heights so their
// repeats rarely line up.

const BACKDROP_THEME_BY_MAP = {
    map_1: "meadow",
    map_2: "bamboo",
    map_3: "onsen",
    map_4: "sakura",
    map_5: "lanternStreet",
    map_6: "maple",
    map_7: "paddies",
    map_8: "lotus",
    map_9: "snowPass",
    map_10: "torii"
};
const BACKDROP_THEME_ORDER = ["meadow", "bamboo", "onsen", "sakura", "lanternStreet", "maple", "paddies", "lotus", "snowPass", "torii"];
const BACKDROP_TAU = Math.PI * 2;

let battleBackdrop = {
    TERRAIN_H: 1280,
    PROPS_H: 1792,
    CANOPY_H: 1536,
    CANOPY_PARALLAX: 1.22,
    PARTICLE_MARGIN: 40,
    scene: null,
    glowCache: {},
    holeCanvas: null,
    lastRenderMs: 0,
    lastScrollPx: 0,
    speedPxPerSec: 0,

    themeKeyForMap: function(map) {
        if (BACKDROP_THEME_BY_MAP[map.key]) {
            return BACKDROP_THEME_BY_MAP[map.key];
        }
        return BACKDROP_THEME_ORDER[(map.seed >>> 0) % BACKDROP_THEME_ORDER.length];
    },

    build: function(map, canvas) {
        const W = gameData.battle.battlefieldWidthPx;
        const H = gameData.battle.battlefieldHeightPx;
        const themeKey = battleBackdrop.themeKeyForMap(map);
        const theme = battleBackdrop.themes[themeKey];
        const tileScale = Math.min(1.5, Math.max(1, window.devicePixelRatio || 1));
        const seed = (map.seed >>> 0) || 1;
        const scene = {
            mapKey: map.key,
            themeKey: themeKey,
            theme: theme,
            W: W,
            H: H,
            seed: seed,
            terrain: battleBackdrop.makeLayer(W, battleBackdrop.TERRAIN_H, tileScale),
            props: battleBackdrop.makeLayer(W, battleBackdrop.PROPS_H, tileScale),
            canopy: battleBackdrop.makeLayer(W, battleBackdrop.CANOPY_H, tileScale),
            overhead: battleBackdrop.makeLayer(W, battleBackdrop.PROPS_H, tileScale),
            lights: [],
            emitters: [],
            pathX: null,
            particles: [],
            streaks: [],
            frameDt: 0
        };
        theme.paint(scene, battleBackdrop.rng(Math.imul(seed, 7919) + 17));
        scene.overlay = battleBackdrop.paintOverlay(W, H, theme.light);
        scene.shafts = theme.light.shafts ? battleBackdrop.paintShafts(W, H, theme.light, battleBackdrop.rng(seed + 5)) : null;
        scene.particles = battleBackdrop.spawnParticles(scene, theme.particles, battleBackdrop.rng(seed + 99));
        const srng = battleBackdrop.rng(seed + 123);
        for (let i = 0; i < 26; i++) {
            scene.streaks.push({ x: srng() * W, y: srng() * (H + 240), len: 0.6 + srng() * 0.8, w: 0.6 + srng() * 1.2 });
        }
        const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
        scene.dpr = dpr;
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
        battleBackdrop.scene = scene;
    },

    render: function(canvas, scrollPx, nowMs) {
        const scene = battleBackdrop.scene;
        const W = scene.W;
        const H = scene.H;
        let dt = battleBackdrop.lastRenderMs ? (nowMs - battleBackdrop.lastRenderMs) / 1000 : 0;
        dt = Math.max(0, Math.min(0.1, dt));
        battleBackdrop.lastRenderMs = nowMs;
        if (dt > 0) {
            const v = (scrollPx - battleBackdrop.lastScrollPx) / dt;
            battleBackdrop.speedPxPerSec += (v - battleBackdrop.speedPxPerSec) * Math.min(1, dt * 5);
        }
        battleBackdrop.lastScrollPx = scrollPx;
        const t = nowMs / 1000;
        const ctx = canvas.getContext("2d");
        const dpr = scene.dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
        const ground = Math.round(scrollPx * dpr) / dpr;
        battleBackdrop.drawTiled(ctx, scene.terrain, ground, W, H);
        battleBackdrop.drawTiled(ctx, scene.props, ground, W, H);
        battleBackdrop.drawLights(ctx, scene, ground, t);
        battleBackdrop.drawParticles(ctx, scene, ground, dt, t, false);
        battleBackdrop.drawStreaks(ctx, scene, ground);
        if (scene.shafts) {
            ctx.globalCompositeOperation = "lighter";
            ctx.globalAlpha = 0.6 + 0.25 * Math.sin(t * 0.37) + 0.1 * Math.sin(t * 0.91);
            ctx.drawImage(scene.shafts, 0, 0, W, H);
            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = "source-over";
        }
        ctx.drawImage(scene.overlay, 0, 0, W, H);
        scene.frameDt = dt;
    },
    /**
     * Foreground canvas: tree tops and overhangs (lit by the same overlay), with soft see-through holes at
     * `holes` ([{x, y, r}] in battlefield px) so intruders under the trees stay visible. Call after render().
     */
    renderForeground: function(canvas, scrollPx, nowMs, holes) {
        const scene = battleBackdrop.scene;
        const W = scene.W;
        const H = scene.H;
        const dpr = scene.dpr;
        if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
            canvas.width = Math.round(W * dpr);
            canvas.height = Math.round(H * dpr);
        }
        const ctx = canvas.getContext("2d");
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, W, H);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
        const ground = Math.round(scrollPx * dpr) / dpr;
        const canopy = Math.round(scrollPx * battleBackdrop.CANOPY_PARALLAX * dpr) / dpr;
        battleBackdrop.drawTiled(ctx, scene.overhead, ground, W, H);
        battleBackdrop.drawTiled(ctx, scene.canopy, canopy, W, H);
        ctx.globalCompositeOperation = "source-atop";
        ctx.drawImage(scene.overlay, 0, 0, W, H);
        ctx.globalCompositeOperation = "destination-out";
        const hole = battleBackdrop.holeSprite();
        for (let i = 0; i < holes.length; i++) {
            const h = holes[i];
            ctx.drawImage(hole, h.x - h.r, h.y - h.r, h.r * 2, h.r * 2);
        }
        ctx.globalCompositeOperation = "source-over";
        battleBackdrop.drawParticles(ctx, scene, ground, scene.frameDt, nowMs / 1000, true);
    },
    holeSprite: function() {
        if (!battleBackdrop.holeCanvas) {
            const c = document.createElement("canvas");
            c.width = 64;
            c.height = 64;
            const g = c.getContext("2d");
            const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
            grad.addColorStop(0, "rgba(0,0,0,0.8)");
            grad.addColorStop(0.55, "rgba(0,0,0,0.72)");
            grad.addColorStop(1, "rgba(0,0,0,0)");
            g.fillStyle = grad;
            g.fillRect(0, 0, 64, 64);
            battleBackdrop.holeCanvas = c;
        }
        return battleBackdrop.holeCanvas;
    },

    // ---------------------------------------------------------------- math / color helpers

    rng: function(seed) {
        let a = seed >>> 0;
        return function() {
            a = (a + 0x6D2B79F5) >>> 0;
            let t = a;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    },
    hash2: function(ix, iy, seed) {
        let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041)) | 0;
        h = Math.imul(h ^ (h >>> 13), 1274126177);
        h ^= h >>> 16;
        return (h >>> 0) / 4294967296;
    },
    /** Value noise that repeats every `periodY` cells vertically (so tiles scroll seamlessly). */
    noise: function(x, y, periodY, seed) {
        const ix = Math.floor(x);
        const iy = Math.floor(y);
        const fx = x - ix;
        const fy = y - iy;
        const y0 = ((iy % periodY) + periodY) % periodY;
        const y1 = (y0 + 1) % periodY;
        const h = battleBackdrop.hash2;
        const a = h(ix, y0, seed);
        const b = h(ix + 1, y0, seed);
        const c = h(ix, y1, seed);
        const d = h(ix + 1, y1, seed);
        const sx = fx * fx * (3 - 2 * fx);
        const sy = fy * fy * (3 - 2 * fy);
        return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    },
    fbm: function(x, y, periodY, seed, octaves) {
        let sum = 0;
        let amp = 0.5;
        let norm = 0;
        let f = 1;
        for (let o = 0; o < octaves; o++) {
            sum += amp * battleBackdrop.noise(x * f, y * f, periodY * f, seed + o * 101);
            norm += amp;
            amp *= 0.5;
            f *= 2;
        }
        return sum / norm;
    },
    lerp: function(a, b, t) {
        return a + (b - a) * t;
    },
    range: function(rng, pair) {
        return pair[0] + (pair[1] - pair[0]) * rng();
    },
    pick: function(rng, list) {
        return list[Math.floor(rng() * list.length)];
    },
    hexToRgb: function(hex) {
        const n = parseInt(hex.slice(1), 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    },
    rgba: function(hex, a) {
        const c = battleBackdrop.hexToRgb(hex);
        return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
    },
    /** Lighten (amt > 0) or darken (amt < 0) a hex color. */
    shade: function(hex, amt) {
        const c = battleBackdrop.hexToRgb(hex);
        const target = amt > 0 ? 255 : 0;
        const k = Math.abs(amt);
        const out = [0, 1, 2].map(function(i) {
            return Math.round(c[i] + (target - c[i]) * k);
        });
        return `#${((1 << 24) + (out[0] << 16) + (out[1] << 8) + out[2]).toString(16).slice(1)}`;
    },
    rampRgb: function(stops, t) {
        const tt = Math.max(0, Math.min(0.9999, t)) * (stops.length - 1);
        const i = Math.floor(tt);
        const f = tt - i;
        const a = stops[i];
        const b = stops[i + 1];
        return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
    },

    // ---------------------------------------------------------------- layer plumbing

    makeLayer: function(w, h, scale) {
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(w * scale);
        canvas.height = Math.ceil(h * scale);
        const ctx = canvas.getContext("2d");
        ctx.setTransform(scale, 0, 0, scale, 0, 0);
        return { canvas: canvas, ctx: ctx, w: w, h: h, scale: scale };
    },
    /** Tile row r of `layer` lands at screen y = r + scroll (mod tile height). */
    drawTiled: function(ctx, layer, scroll, W, H) {
        const T = layer.h;
        const s = layer.canvas.height / T;
        const off = ((scroll % T) + T) % T;
        for (let ty = off - T; ty < H; ty += T) {
            const y0 = Math.max(0, ty);
            const y1 = Math.min(H, ty + T);
            if (y1 <= y0) {
                continue;
            }
            ctx.drawImage(layer.canvas, 0, (y0 - ty) * s, layer.canvas.width, (y1 - y0) * s, 0, y0, W, y1 - y0);
        }
    },
    /** Calls fn(y) plus its copies one tile above/below when the drawing reaches across a tile edge. */
    wrapY: function(T, y, reach, fn) {
        fn(y);
        if (y - reach < 0) {
            fn(y + T);
        }
        if (y + reach > T) {
            fn(y - T);
        }
    },
    glow: function(color) {
        if (battleBackdrop.glowCache[color]) {
            return battleBackdrop.glowCache[color];
        }
        const c = document.createElement("canvas");
        c.width = 64;
        c.height = 64;
        const g = c.getContext("2d");
        const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
        grad.addColorStop(0, battleBackdrop.rgba(color, 1));
        grad.addColorStop(0.25, battleBackdrop.rgba(color, 0.55));
        grad.addColorStop(0.6, battleBackdrop.rgba(color, 0.14));
        grad.addColorStop(1, battleBackdrop.rgba(color, 0));
        g.fillStyle = grad;
        g.fillRect(0, 0, 64, 64);
        battleBackdrop.glowCache[color] = c;
        return c;
    },
    addLight: function(scene, x, y, r, color, base, flicker) {
        if (y < 0 || y >= battleBackdrop.PROPS_H) {
            return;
        }
        scene.lights.push({ x: x, y: y, r: r, color: color, base: base, flicker: flicker, phase: (x * 0.37 + y * 0.11) % BACKDROP_TAU });
    },
    addEmitter: function(scene, x, y, rx, ry) {
        if (y < 0 || y >= battleBackdrop.PROPS_H) {
            return;
        }
        scene.emitters.push({ x: x, y: y, rx: rx, ry: ry });
    },
    drawLights: function(ctx, scene, scroll, t) {
        const T = battleBackdrop.PROPS_H;
        const off = ((scroll % T) + T) % T;
        ctx.globalCompositeOperation = "lighter";
        for (let i = 0; i < scene.lights.length; i++) {
            const l = scene.lights[i];
            const wobble = Math.sin(t * 5.3 + l.phase) * 0.55 + Math.sin(t * 11.7 + l.phase * 2.1) * 0.3 + Math.sin(t * 1.7 + l.phase) * 0.15;
            const a = l.base * (1 - l.flicker * 0.35 + l.flicker * 0.35 * wobble);
            const r = l.r * (1 + l.flicker * 0.04 * wobble);
            for (let k = -1; k <= 0; k++) {
                const sy = l.y + off + k * T;
                if (sy < -r || sy > scene.H + r) {
                    continue;
                }
                ctx.globalAlpha = Math.max(0, a);
                ctx.drawImage(battleBackdrop.glow(l.color), l.x - r, sy - r, r * 2, r * 2);
            }
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
    },
    drawStreaks: function(ctx, scene, scroll) {
        const speed = Math.abs(battleBackdrop.speedPxPerSec);
        if (speed < 70) {
            return;
        }
        const strength = Math.min(1, (speed - 70) / 260);
        const period = scene.H + 240;
        const dir = battleBackdrop.speedPxPerSec >= 0 ? 1 : -1;
        ctx.strokeStyle = scene.theme.streakColor || "#ffffff";
        ctx.lineCap = "round";
        for (let i = 0; i < scene.streaks.length; i++) {
            const s = scene.streaks[i];
            const sy = (((s.y + scroll * 1.6) % period) + period) % period - 120;
            const len = Math.min(140, speed * 0.28) * s.len;
            ctx.globalAlpha = 0.28 * strength;
            ctx.lineWidth = s.w;
            ctx.beginPath();
            ctx.moveTo(s.x, sy);
            ctx.lineTo(s.x, sy - len * dir);
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
    },

    // ---------------------------------------------------------------- particles

    spawnParticles: function(scene, specs, rng) {
        const groups = [];
        for (let si = 0; si < specs.length; si++) {
            const spec = specs[si];
            const items = [];
            if (spec.emit && scene.emitters.length === 0) {
                continue;
            }
            for (let i = 0; i < spec.count; i++) {
                const p = {
                    x: rng() * scene.W,
                    y: rng() * (scene.H + battleBackdrop.PARTICLE_MARGIN * 2),
                    vx: battleBackdrop.range(rng, spec.vx || [0, 0]),
                    vy: battleBackdrop.range(rng, spec.vy || [0, 0]),
                    size: battleBackdrop.range(rng, spec.size),
                    rot: rng() * BACKDROP_TAU,
                    vr: (rng() - 0.5) * (spec.spin || 0),
                    phase: rng() * BACKDROP_TAU,
                    color: battleBackdrop.pick(rng, spec.colors),
                    life: spec.life ? battleBackdrop.range(rng, spec.life) : 0,
                    age: 0
                };
                if (spec.life) {
                    p.age = rng() * p.life;
                }
                if (spec.emit) {
                    battleBackdrop.respawnAtEmitter(scene, p, rng);
                }
                items.push(p);
            }
            groups.push({ spec: spec, items: items, rng: rng });
        }
        return groups;
    },
    respawnAtEmitter: function(scene, p, rng) {
        const e = scene.emitters[Math.floor(rng() * scene.emitters.length)];
        const a = rng() * BACKDROP_TAU;
        const d = Math.sqrt(rng()) * 0.8;
        p.x = e.x + Math.cos(a) * e.rx * d;
        p.y = e.y + Math.sin(a) * e.ry * d;
    },
    drawParticles: function(ctx, scene, scroll, dt, t, high) {
        const margin = battleBackdrop.PARTICLE_MARGIN;
        for (let gi = 0; gi < scene.particles.length; gi++) {
            const group = scene.particles[gi];
            const spec = group.spec;
            if (!!spec.high !== high) {
                continue;
            }
            const par = spec.parallax !== undefined ? spec.parallax : 1;
            const wide = spec.wrapMargin || margin;
            const periodX = scene.W + wide * 2;
            const periodY = spec.emit ? battleBackdrop.PROPS_H : scene.H + wide * 2;
            ctx.globalCompositeOperation = spec.additive ? "lighter" : "source-over";
            for (let i = 0; i < group.items.length; i++) {
                const p = group.items[i];
                p.x += p.vx * dt;
                p.y += p.vy * dt;
                p.rot += p.vr * dt;
                if (p.life) {
                    p.age += dt;
                    if (p.age > p.life) {
                        p.age -= p.life;
                        if (spec.emit) {
                            battleBackdrop.respawnAtEmitter(scene, p, group.rng);
                        } else {
                            p.x = group.rng() * scene.W;
                            p.y = group.rng() * periodY;
                        }
                    }
                }
                let sx;
                let sy;
                if (spec.emit) {
                    sx = p.x;
                    sy = (((p.y + scroll * par) % periodY) + periodY) % periodY;
                    if (sy > scene.H + 60) {
                        sy -= periodY;
                    }
                } else {
                    sx = (((p.x + wide) % periodX) + periodX) % periodX - wide;
                    sy = (((p.y + scroll * par + wide) % periodY) + periodY) % periodY - wide;
                }
                if (sy < -wide || sy > scene.H + wide) {
                    continue;
                }
                battleBackdrop.particleDrawers[spec.kind](ctx, p, sx, sy, t, spec);
            }
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
    },
    particleDrawers: {
        mote: function(ctx, p, x, y, t) {
            const a = 0.35 + 0.35 * Math.sin(t * 1.3 + p.phase);
            ctx.globalAlpha = Math.max(0, a);
            const r = p.size * 3;
            ctx.drawImage(battleBackdrop.glow(p.color), x + Math.sin(t * 0.7 + p.phase) * 10 - r, y - r, r * 2, r * 2);
        },
        petal: function(ctx, p, x, y, t) {
            const flip = Math.cos(t * 2.6 + p.phase);
            ctx.save();
            ctx.translate(x + Math.sin(t * 1.1 + p.phase) * 14, y);
            ctx.rotate(p.rot);
            ctx.scale(Math.max(0.15, Math.abs(flip)), 1);
            ctx.globalAlpha = 0.9;
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.moveTo(0, -p.size);
            ctx.quadraticCurveTo(p.size * 0.9, -p.size * 0.2, 0, p.size);
            ctx.quadraticCurveTo(-p.size * 0.9, -p.size * 0.2, 0, -p.size);
            ctx.fill();
            ctx.globalAlpha = 0.5;
            ctx.fillStyle = "#ffffff";
            ctx.beginPath();
            ctx.ellipse(-p.size * 0.15, -p.size * 0.25, p.size * 0.18, p.size * 0.4, 0, 0, BACKDROP_TAU);
            ctx.fill();
            ctx.restore();
        },
        mapleLeaf: function(ctx, p, x, y, t) {
            const flip = Math.cos(t * 1.9 + p.phase);
            ctx.save();
            ctx.translate(x + Math.sin(t * 0.9 + p.phase) * 18, y);
            ctx.rotate(p.rot);
            ctx.scale(Math.max(0.2, Math.abs(flip)), 1);
            ctx.globalAlpha = 0.95;
            ctx.fillStyle = flip > 0 ? p.color : battleBackdrop.shade(p.color, -0.25);
            battleBackdrop.starPath(ctx, 0, 0, p.size, p.size * 0.45, 5);
            ctx.fill();
            ctx.restore();
        },
        bambooLeaf: function(ctx, p, x, y, t) {
            const flip = Math.cos(t * 1.6 + p.phase);
            ctx.save();
            ctx.translate(x + Math.sin(t * 0.8 + p.phase) * 20, y);
            ctx.rotate(p.rot);
            ctx.scale(1, Math.max(0.2, Math.abs(flip)));
            ctx.globalAlpha = 0.9;
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.moveTo(-p.size * 2.2, 0);
            ctx.quadraticCurveTo(0, -p.size * 0.6, p.size * 2.2, 0);
            ctx.quadraticCurveTo(0, p.size * 0.6, -p.size * 2.2, 0);
            ctx.fill();
            ctx.restore();
        },
        snow: function(ctx, p, x, y, t) {
            ctx.globalAlpha = 0.85;
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(x + Math.sin(t * 1.1 + p.phase) * 9, y, p.size, 0, BACKDROP_TAU);
            ctx.fill();
        },
        firefly: function(ctx, p, x, y, t) {
            const blink = Math.pow(Math.max(0, Math.sin(t * 1.4 + p.phase)), 3);
            const wx = x + Math.sin(t * 0.43 + p.phase) * 22 + Math.sin(t * 1.3 + p.phase * 2) * 6;
            const wy = y + Math.cos(t * 0.37 + p.phase) * 16;
            ctx.globalAlpha = 0.15 + 0.85 * blink;
            const r = p.size * 5;
            ctx.drawImage(battleBackdrop.glow(p.color), wx - r, wy - r, r * 2, r * 2);
            ctx.globalAlpha = 0.4 + 0.6 * blink;
            ctx.fillStyle = "#fffbe0";
            ctx.fillRect(wx - 0.8, wy - 0.8, 1.6, 1.6);
        },
        steam: function(ctx, p, x, y, t) {
            const k = p.age / p.life;
            const r = p.size * (0.5 + k * 1.1);
            ctx.globalAlpha = 0.3 * Math.sin(Math.PI * k);
            ctx.drawImage(battleBackdrop.glow(p.color), x + Math.sin(t * 0.6 + p.phase) * 8 - r, y - k * 40 - r, r * 2, r * 2);
        },
        spirit: function(ctx, p, x, y, t) {
            const fl = 0.75 + 0.25 * Math.sin(t * 9 + p.phase) * Math.sin(t * 3.1 + p.phase);
            const wx = x + Math.sin(t * 0.5 + p.phase) * 18;
            const wy = y + Math.sin(t * 0.8 + p.phase * 1.3) * 10;
            const r = p.size * 6 * fl;
            ctx.globalAlpha = 0.75;
            ctx.drawImage(battleBackdrop.glow(p.color), wx - r, wy - r, r * 2, r * 2);
            ctx.globalAlpha = 0.9 * fl;
            ctx.fillStyle = "#f2fbff";
            ctx.beginPath();
            ctx.moveTo(wx, wy - p.size * 2.4);
            ctx.quadraticCurveTo(wx + p.size, wy, wx, wy + p.size * 0.8);
            ctx.quadraticCurveTo(wx - p.size, wy, wx, wy - p.size * 2.4);
            ctx.fill();
        },
        dragonfly: function(ctx, p, x, y, t) {
            // Darting flight: hold, then zip along a new heading.
            const cyc = (t * 0.45 + p.phase) % 1;
            const heading = p.rot + Math.floor(t * 0.45 + p.phase) * 2.1;
            const dart = cyc < 0.7 ? 0 : (cyc - 0.7) / 0.3;
            const reach = 60 * dart * dart;
            const dx = x + Math.cos(heading) * reach + Math.sin(t * 7 + p.phase) * 0.8;
            const dy = y + Math.sin(heading) * reach;
            ctx.save();
            ctx.translate(dx, dy);
            ctx.rotate(heading + Math.PI / 2);
            ctx.globalAlpha = 0.35;
            ctx.fillStyle = "#e6f4ff";
            const flap = 0.6 + 0.4 * Math.sin(t * 60 + p.phase);
            ctx.beginPath();
            ctx.ellipse(-3.2, -1.5, 3.5, 1.2 * flap, -0.2, 0, BACKDROP_TAU);
            ctx.ellipse(3.2, -1.5, 3.5, 1.2 * flap, 0.2, 0, BACKDROP_TAU);
            ctx.ellipse(-2.8, 1, 3, 1 * flap, 0.2, 0, BACKDROP_TAU);
            ctx.ellipse(2.8, 1, 3, 1 * flap, -0.2, 0, BACKDROP_TAU);
            ctx.fill();
            ctx.globalAlpha = 0.95;
            ctx.fillStyle = p.color;
            ctx.fillRect(-0.7, -3, 1.4, 9);
            ctx.restore();
        },
        cloudShadow: function(ctx, p, x, y) {
            ctx.save();
            ctx.globalAlpha = 0.16;
            ctx.translate(x, y);
            ctx.scale(1, 0.62);
            ctx.drawImage(battleBackdrop.glow(p.color), -p.size, -p.size, p.size * 2, p.size * 2);
            ctx.restore();
        },
        glint: function(ctx, p, x, y, t) {
            const a = Math.pow(Math.max(0, Math.sin(t * 1.7 + p.phase)), 10);
            if (a < 0.02) {
                return;
            }
            ctx.globalAlpha = a;
            ctx.fillStyle = p.color;
            const s = p.size * (0.6 + a * 0.6);
            ctx.beginPath();
            ctx.moveTo(x, y - s * 2);
            ctx.lineTo(x + s * 0.3, y - s * 0.3);
            ctx.lineTo(x + s * 2, y);
            ctx.lineTo(x + s * 0.3, y + s * 0.3);
            ctx.lineTo(x, y + s * 2);
            ctx.lineTo(x - s * 0.3, y + s * 0.3);
            ctx.lineTo(x - s * 2, y);
            ctx.lineTo(x - s * 0.3, y - s * 0.3);
            ctx.closePath();
            ctx.fill();
        },
        ember: function(ctx, p, x, y, t) {
            const k = p.life ? p.age / p.life : 0.5;
            ctx.globalAlpha = Math.sin(Math.PI * k) * (0.6 + 0.4 * Math.sin(t * 13 + p.phase));
            const r = p.size * 3;
            ctx.drawImage(battleBackdrop.glow(p.color), x + Math.sin(t * 1.5 + p.phase) * 6 - r, y - r, r * 2, r * 2);
        }
    },

    // ---------------------------------------------------------------- overlay

    paintOverlay: function(W, H, light) {
        const c = document.createElement("canvas");
        c.width = W;
        c.height = H;
        const g = c.getContext("2d");
        if (light.tint) {
            g.fillStyle = light.tint;
            g.fillRect(0, 0, W, H);
        }
        if (light.dim) {
            g.fillStyle = `rgba(6,8,14,${light.dim})`;
            g.fillRect(0, 0, W, H);
        }
        const R = Math.hypot(W, H) * 0.62;
        const vg = g.createRadialGradient(W / 2, H * 0.58, R * 0.38, W / 2, H * 0.58, R);
        vg.addColorStop(0, "rgba(0,0,0,0)");
        vg.addColorStop(1, light.vignette);
        g.fillStyle = vg;
        g.fillRect(0, 0, W, H);
        // Keep the wave panel / top-of-field text readable.
        const top = g.createLinearGradient(0, 0, 0, 120);
        top.addColorStop(0, "rgba(4,6,12,0.45)");
        top.addColorStop(1, "rgba(4,6,12,0)");
        g.fillStyle = top;
        g.fillRect(0, 0, W, 120);
        // Ground the player HUD at the bottom.
        const bot = g.createLinearGradient(0, H - 150, 0, H);
        bot.addColorStop(0, "rgba(4,6,12,0)");
        bot.addColorStop(1, "rgba(4,6,12,0.42)");
        g.fillStyle = bot;
        g.fillRect(0, H - 150, W, 150);
        return c;
    },
    paintShafts: function(W, H, light, rng) {
        const c = document.createElement("canvas");
        c.width = W;
        c.height = H;
        const g = c.getContext("2d");
        const n = 4 + Math.floor(rng() * 3);
        for (let i = 0; i < n; i++) {
            const x0 = -120 + rng() * (W * 0.9);
            const w = 30 + rng() * 70;
            const slant = H * 0.55;
            const grad = g.createLinearGradient(x0, 0, x0 + slant, H);
            grad.addColorStop(0, battleBackdrop.rgba(light.shafts, 0.12 + rng() * 0.08));
            grad.addColorStop(0.7, battleBackdrop.rgba(light.shafts, 0.03));
            grad.addColorStop(1, battleBackdrop.rgba(light.shafts, 0));
            g.fillStyle = grad;
            g.beginPath();
            g.moveTo(x0, 0);
            g.lineTo(x0 + w, 0);
            g.lineTo(x0 + w + slant, H);
            g.lineTo(x0 + slant, H);
            g.closePath();
            g.fill();
        }
        return c;
    },

    // ---------------------------------------------------------------- painting primitives

    starPath: function(ctx, x, y, rOuter, rInner, points) {
        ctx.beginPath();
        for (let i = 0; i < points * 2; i++) {
            const r = i % 2 === 0 ? rOuter : rInner;
            const a = -Math.PI / 2 + (i * Math.PI) / points;
            if (i === 0) {
                ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
            } else {
                ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
            }
        }
        ctx.closePath();
    },
    /** Smooth lumpy closed shape. */
    blobPath: function(ctx, x, y, rx, ry, rng, lump, n) {
        const count = n || 9;
        const pts = [];
        for (let i = 0; i < count; i++) {
            const a = (i / count) * BACKDROP_TAU;
            const k = 1 + (rng() - 0.5) * lump;
            pts.push([x + Math.cos(a) * rx * k, y + Math.sin(a) * ry * k]);
        }
        ctx.beginPath();
        const last = pts[count - 1];
        ctx.moveTo((last[0] + pts[0][0]) / 2, (last[1] + pts[0][1]) / 2);
        for (let i = 0; i < count; i++) {
            const p = pts[i];
            const q = pts[(i + 1) % count];
            ctx.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
        }
        ctx.closePath();
    },
    softShadow: function(ctx, x, y, rx, ry, alpha) {
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(1, ry / rx);
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
        g.addColorStop(0, `rgba(0,0,0,${alpha})`);
        g.addColorStop(0.6, `rgba(0,0,0,${alpha * 0.55})`);
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, rx, 0, BACKDROP_TAU);
        ctx.fill();
        ctx.restore();
    },
    /** Quarter-res periodic fbm ground, upscaled smoothly. `stops` are hex colors from low to high noise. */
    paintNoiseGround: function(layer, seed, stops, opts) {
        const q = 4;
        const W = layer.w;
        const T = layer.h;
        const cell = opts.cell || 80;
        const periodCells = Math.round(T / cell);
        const cellQ = cell / q;
        const w = Math.ceil(W / q) + 1;
        const h = T / q;
        const tmp = document.createElement("canvas");
        tmp.width = w;
        tmp.height = h + 2;
        const tctx = tmp.getContext("2d");
        const img = tctx.createImageData(w, h + 2);
        const rgbStops = stops.map(battleBackdrop.hexToRgb);
        const accent = opts.accent ? battleBackdrop.hexToRgb(opts.accent.color) : null;
        const contrast = opts.contrast || 1.6;
        let idx = 0;
        for (let py = -1; py <= h; py++) {
            const y = py / cellQ;
            for (let px = 0; px < w; px++) {
                const x = px / cellQ;
                const n = battleBackdrop.fbm(x, y, periodCells, seed, 4);
                const m = battleBackdrop.fbm(x * 0.5, y * 0.5, periodCells / 2, seed + 7, 2);
                let v = (n - 0.5) * contrast + 0.5 + (m - 0.5) * 0.5;
                let c = battleBackdrop.rampRgb(rgbStops, v);
                if (accent) {
                    const an = battleBackdrop.fbm(x * 1.5, y * 1.5, periodCells * 1.5, seed + 31, 3);
                    const k = Math.max(0, Math.min(1, (an - opts.accent.threshold) / 0.08)) * opts.accent.amount;
                    c = [c[0] + (accent[0] - c[0]) * k, c[1] + (accent[1] - c[1]) * k, c[2] + (accent[2] - c[2]) * k];
                }
                img.data[idx++] = c[0];
                img.data[idx++] = c[1];
                img.data[idx++] = c[2];
                img.data[idx++] = 255;
            }
        }
        tctx.putImageData(img, 0, 0);
        const ctx = layer.ctx;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(tmp, 0, 0, w, h + 2, 0, -q, w * q, (h + 2) * q);
    },
    /** Fine light/dark speckle so the ground does not read as a smooth gradient. */
    speckle: function(ctx, W, T, rng, count, light, dark, size) {
        for (let i = 0; i < count; i++) {
            const x = rng() * W;
            const y = rng() * T;
            ctx.fillStyle = rng() < 0.5 ? light : dark;
            const s = size * (0.5 + rng());
            ctx.fillRect(x, y, s, s);
        }
    },
    makeMeander: function(T, rng, center, amp1, amp2) {
        const p1 = rng() * BACKDROP_TAU;
        const p2 = rng() * BACKDROP_TAU;
        const k2 = 2 + Math.floor(rng() * 2);
        return function(y) {
            return center + amp1 * Math.sin((BACKDROP_TAU * y) / T + p1) + amp2 * Math.sin((BACKDROP_TAU * k2 * y) / T + p2);
        };
    },
    /** Fills the band pathX(y) +- width(y)/2 + extra over the whole tile (and a little past both edges). */
    fillBand: function(ctx, T, pathX, widthFn, extra, fillStyle) {
        const step = 8;
        ctx.beginPath();
        for (let y = -step * 3; y <= T + step * 3; y += step) {
            const x = pathX(y) - widthFn(y) / 2 - extra;
            if (y === -step * 3) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
        for (let y = T + step * 3; y >= -step * 3; y -= step) {
            ctx.lineTo(pathX(y) + widthFn(y) / 2 + extra, y);
        }
        ctx.closePath();
        ctx.fillStyle = fillStyle;
        ctx.fill();
    },
    strokeAlong: function(ctx, T, xFn, lineWidth, strokeStyle) {
        const step = 8;
        ctx.beginPath();
        for (let y = -step * 3; y <= T + step * 3; y += step) {
            if (y === -step * 3) {
                ctx.moveTo(xFn(y), y);
            } else {
                ctx.lineTo(xFn(y), y);
            }
        }
        ctx.lineWidth = lineWidth;
        ctx.strokeStyle = strokeStyle;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.stroke();
    },
    softBand: function(ctx, T, pathX, widthFn, color, layers, spread) {
        for (let i = layers; i >= 1; i--) {
            battleBackdrop.fillBand(ctx, T, pathX, widthFn, (i / layers) * spread, battleBackdrop.rgba(color, 0.9 / layers));
        }
    },
    dirtPath: function(scene, rng, pathX, widthFn, pal) {
        const ctx = scene.terrain.ctx;
        const T = scene.terrain.h;
        const W = scene.terrain.w;
        battleBackdrop.softBand(ctx, T, pathX, widthFn, pal.edge, 5, 18);
        battleBackdrop.fillBand(ctx, T, pathX, widthFn, 0, pal.color);
        battleBackdrop.fillBand(ctx, T, pathX, function(y) { return widthFn(y) * 0.55; }, 0, battleBackdrop.rgba(pal.light, 0.35));
        // Wheel ruts / trodden lines.
        battleBackdrop.strokeAlong(ctx, T, function(y) { return pathX(y) - widthFn(y) * 0.22; }, 5, battleBackdrop.rgba(pal.edge, 0.25));
        battleBackdrop.strokeAlong(ctx, T, function(y) { return pathX(y) + widthFn(y) * 0.22; }, 5, battleBackdrop.rgba(pal.edge, 0.25));
        for (let i = 0; i < 520; i++) {
            const y = rng() * T;
            const half = widthFn(y) / 2;
            const x = pathX(y) + (rng() * 2 - 1) * half * 0.95;
            ctx.fillStyle = rng() < 0.5 ? battleBackdrop.rgba(pal.light, 0.35) : battleBackdrop.rgba(pal.edge, 0.35);
            ctx.fillRect(x, y, 1.2 + rng() * 1.6, 1 + rng() * 1.2);
        }
        for (let i = 0; i < 70; i++) {
            const y = rng() * T;
            const half = widthFn(y) / 2;
            const x = pathX(y) + (rng() * 2 - 1) * half * 0.9;
            const r = 1.5 + rng() * 2.8;
            battleBackdrop.wrapY(T, y, 6, function(yy) {
                battleBackdrop.pebble(ctx, x, yy, r, pal.stone || "#8d877c");
            });
        }
        scene.pathX = pathX;
        scene.pathWidth = widthFn;
        return W;
    },
    pebble: function(ctx, x, y, r, color) {
        ctx.fillStyle = "rgba(0,0,0,0.28)";
        ctx.beginPath();
        ctx.ellipse(x + r * 0.35, y + r * 0.3, r, r * 0.7, 0, 0, BACKDROP_TAU);
        ctx.fill();
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.ellipse(x, y, r, r * 0.72, 0, 0, BACKDROP_TAU);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.28)";
        ctx.beginPath();
        ctx.ellipse(x - r * 0.3, y - r * 0.25, r * 0.45, r * 0.28, 0, 0, BACKDROP_TAU);
        ctx.fill();
    },
    grassTuft: function(ctx, x, y, s, color, rng) {
        const n = 3 + Math.floor(rng() * 3);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.1;
        ctx.lineCap = "round";
        for (let i = 0; i < n; i++) {
            const a = -Math.PI / 2 + (i / (n - 1) - 0.5) * 1.3 + (rng() - 0.5) * 0.3;
            const len = s * (0.6 + rng() * 0.5);
            const bx = x + (i - n / 2) * 0.9;
            ctx.beginPath();
            ctx.moveTo(bx, y);
            ctx.quadraticCurveTo(bx + Math.cos(a) * len * 0.3, y + Math.sin(a) * len * 0.7, bx + Math.cos(a) * len, y + Math.sin(a) * len);
            ctx.stroke();
        }
    },
    flower: function(ctx, x, y, s, color) {
        ctx.fillStyle = color;
        for (let i = 0; i < 5; i++) {
            const a = (i / 5) * BACKDROP_TAU;
            ctx.beginPath();
            ctx.arc(x + Math.cos(a) * s, y + Math.sin(a) * s, s * 0.8, 0, BACKDROP_TAU);
            ctx.fill();
        }
        ctx.fillStyle = "#f6d34a";
        ctx.beginPath();
        ctx.arc(x, y, s * 0.6, 0, BACKDROP_TAU);
        ctx.fill();
    },
    fallenLeaf: function(ctx, x, y, s, rot, color) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rot);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(-s, 0);
        ctx.quadraticCurveTo(0, -s * 0.45, s, 0);
        ctx.quadraticCurveTo(0, s * 0.45, -s, 0);
        ctx.fill();
        ctx.restore();
    },
    /** Scatter `count` decals over a tile, skipping spots rejected by `avoid(x, y)`. */
    scatter: function(layer, rng, count, reach, avoid, draw) {
        const T = layer.h;
        for (let i = 0; i < count; i++) {
            const x = rng() * layer.w;
            const y = rng() * T;
            if (avoid && avoid(x, y)) {
                continue;
            }
            const r1 = rng();
            const r2 = rng();
            battleBackdrop.wrapY(T, y, reach, function(yy) {
                draw(layer.ctx, x, yy, r1, r2);
            });
        }
    },
    offPath: function(scene, pad) {
        return function(x, y) {
            return Math.abs(x - scene.pathX(y)) < scene.pathWidth(y) / 2 + pad;
        };
    },
    onPath: function(scene, pad) {
        return function(x, y) {
            return Math.abs(x - scene.pathX(y)) > scene.pathWidth(y) / 2 - pad;
        };
    },
    /** Evenly spread side positions with jitter; returns [{x, y, side}] along both margins of a tile. */
    sideSlots: function(T, rng, spacing, jitter, xInner, xOuter, W) {
        const out = [];
        for (let side = 0; side < 2; side++) {
            const n = Math.max(1, Math.round(T / spacing));
            const offset = rng() * spacing;
            for (let i = 0; i < n; i++) {
                const y = (offset + i * (T / n) + (rng() - 0.5) * jitter + T) % T;
                const d = xOuter + rng() * (xInner - xOuter);
                out.push({ x: side === 0 ? d : W - d, y: y, side: side, r: rng() });
            }
        }
        out.sort(function(a, b) { return a.y - b.y; });
        return out;
    },

    // ---------------------------------------------------------------- props

    /** Shadow and trunk go on `ctx` (ground); the tiers go on `over` (foreground canopy) when given. */
    pine: function(ctx, x, y, h, pal, rng, snowy, over) {
        battleBackdrop.softShadow(ctx, x + h * 0.2, y + 3, h * 0.42, h * 0.14, 0.42);
        ctx.fillStyle = pal.trunk;
        ctx.fillRect(x - h * 0.035, y - h * 0.17, h * 0.07, h * 0.19);
        const top = over || ctx;
        const tiers = 4 + Math.floor(rng() * 2);
        for (let t = 0; t < tiers; t++) {
            const f = t / tiers;
            const ty = y - h * 0.1 - f * h * 0.74;
            const w = h * 0.36 * (1 - f * 0.72);
            const th = h * 0.34 * (1 - f * 0.25);
            const grad = top.createLinearGradient(x - w, ty - th, x + w, ty);
            grad.addColorStop(0, pal.light);
            grad.addColorStop(0.45, pal.mid);
            grad.addColorStop(1, pal.dark);
            top.fillStyle = grad;
            top.beginPath();
            top.moveTo(x, ty - th);
            top.lineTo(x + w, ty);
            const sc = 5;
            for (let k = sc; k >= 0; k--) {
                const px = x - w + (2 * w * k) / sc;
                const py = ty + (k % 2 === 0 ? 0 : w * 0.12);
                top.lineTo(px, py);
            }
            top.closePath();
            top.fill();
            top.strokeStyle = "rgba(0,0,0,0.22)";
            top.lineWidth = 1;
            top.stroke();
            if (snowy) {
                top.fillStyle = "rgba(240,246,255,0.92)";
                top.beginPath();
                top.moveTo(x, ty - th);
                top.lineTo(x + w * 0.35, ty - th * 0.62);
                top.quadraticCurveTo(x - w * 0.1, ty - th * 0.45, x - w * 0.75, ty - th * 0.12);
                top.closePath();
                top.fill();
            }
        }
    },
    roundTree: function(ctx, x, y, h, pal, rng, over) {
        battleBackdrop.softShadow(ctx, x + h * 0.22, y + 3, h * 0.48, h * 0.16, 0.38);
        const lean = (rng() - 0.5) * h * 0.12;
        const cx = x + lean;
        const cy = y - h * 0.62;
        ctx.strokeStyle = pal.trunk;
        ctx.lineCap = "round";
        ctx.lineWidth = h * 0.075;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + lean * 0.2, y - h * 0.3, cx, cy + h * 0.1);
        ctx.stroke();
        ctx.lineWidth = h * 0.035;
        ctx.beginPath();
        ctx.moveTo(cx, cy + h * 0.12);
        ctx.lineTo(cx - h * 0.2, cy - h * 0.02);
        ctx.moveTo(cx, cy + h * 0.1);
        ctx.lineTo(cx + h * 0.22, cy);
        ctx.stroke();
        const top = over || ctx;
        const R = h * 0.4;
        const blobs = [];
        for (let i = 0; i < 16; i++) {
            const a = rng() * BACKDROP_TAU;
            const d = R * 0.62 * Math.sqrt(rng());
            blobs.push({ x: cx + Math.cos(a) * d * 1.1, y: cy + Math.sin(a) * d * 0.85, r: R * (0.32 + rng() * 0.22) });
        }
        top.fillStyle = pal.dark;
        for (let i = 0; i < blobs.length; i++) {
            top.beginPath();
            top.arc(blobs[i].x + 2, blobs[i].y + 3, blobs[i].r, 0, BACKDROP_TAU);
            top.fill();
        }
        top.fillStyle = pal.mid;
        for (let i = 0; i < blobs.length; i++) {
            top.beginPath();
            top.arc(blobs[i].x, blobs[i].y, blobs[i].r * 0.95, 0, BACKDROP_TAU);
            top.fill();
        }
        top.fillStyle = pal.light;
        for (let i = 0; i < blobs.length; i++) {
            const b = blobs[i];
            if (b.x - cx + (b.y - cy) > R * 0.2) {
                continue;
            }
            top.beginPath();
            top.arc(b.x - b.r * 0.25, b.y - b.r * 0.3, b.r * 0.55, 0, BACKDROP_TAU);
            top.fill();
        }
        if (pal.accent) {
            for (let i = 0; i < 70; i++) {
                const a = rng() * BACKDROP_TAU;
                const d = R * Math.sqrt(rng());
                top.fillStyle = battleBackdrop.pick(rng, pal.accent);
                top.beginPath();
                top.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.85, 1 + rng() * 1.6, 0, BACKDROP_TAU);
                top.fill();
            }
        }
    },
    qpt: function(x0, y0, cx, cy, x1, y1, t) {
        const u = 1 - t;
        return [u * u * x0 + 2 * u * t * cx + t * t * x1, u * u * y0 + 2 * u * t * cy + t * t * y1];
    },
    bambooClump: function(ctx, x, y, h, lean, pal, rng, over) {
        const n = 3 + Math.floor(rng() * 4);
        const culms = [];
        for (let i = 0; i < n; i++) {
            culms.push({
                bx: x + (rng() - 0.5) * 28,
                by: y + (rng() - 0.5) * 12,
                hh: h * (0.75 + rng() * 0.4),
                l: lean * (0.6 + rng() * 0.7),
                w: 3.5 + rng() * 2.5,
                tone: rng()
            });
        }
        culms.sort(function(a, b) { return a.by - b.by; });
        for (let i = 0; i < culms.length; i++) {
            const c = culms[i];
            ctx.fillStyle = "rgba(0,0,0,0.16)";
            ctx.beginPath();
            ctx.moveTo(c.bx - c.w / 2, c.by);
            ctx.lineTo(c.bx + c.hh * 0.55 - c.w / 2, c.by + c.hh * 0.22);
            ctx.lineTo(c.bx + c.hh * 0.55 + c.w, c.by + c.hh * 0.22);
            ctx.lineTo(c.bx + c.w / 2, c.by);
            ctx.closePath();
            ctx.fill();
        }
        const top = over || ctx;
        for (let i = 0; i < culms.length; i++) {
            const c = culms[i];
            const x1 = c.bx + c.l * c.hh;
            const y1 = c.by - c.hh;
            const cx = c.bx + c.l * c.hh * 0.15;
            const cy = c.by - c.hh * 0.55;
            const col = c.tone < 0.5 ? pal.culm : pal.culm2;
            top.lineCap = "round";
            top.strokeStyle = battleBackdrop.shade(col, -0.35);
            top.lineWidth = c.w + 1.5;
            top.beginPath();
            top.moveTo(c.bx, c.by);
            top.quadraticCurveTo(cx, cy, x1, y1);
            top.stroke();
            top.strokeStyle = col;
            top.lineWidth = c.w;
            top.stroke();
            top.strokeStyle = battleBackdrop.rgba("#ffffff", 0.22);
            top.lineWidth = c.w * 0.3;
            top.beginPath();
            top.moveTo(c.bx - c.w * 0.22, c.by);
            top.quadraticCurveTo(cx - c.w * 0.22, cy, x1 - c.w * 0.22, y1);
            top.stroke();
            const nodes = Math.floor(c.hh / 24);
            top.strokeStyle = battleBackdrop.shade(col, -0.45);
            top.lineWidth = 1.2;
            for (let k = 1; k <= nodes; k++) {
                const p = battleBackdrop.qpt(c.bx, c.by, cx, cy, x1, y1, k / (nodes + 1));
                top.beginPath();
                top.moveTo(p[0] - c.w * 0.6, p[1]);
                top.lineTo(p[0] + c.w * 0.6, p[1]);
                top.stroke();
            }
            for (let k = 0; k < 9; k++) {
                const tt = 0.55 + rng() * 0.45;
                const p = battleBackdrop.qpt(c.bx, c.by, cx, cy, x1, y1, tt);
                const a = (rng() < 0.5 ? -1 : 1) * (0.3 + rng() * 1.2) + (c.l > 0 ? -0.3 : 0.3) - Math.PI / 2;
                const len = 9 + rng() * 9;
                top.save();
                top.translate(p[0], p[1]);
                top.rotate(a + Math.PI / 2);
                top.fillStyle = battleBackdrop.pick(rng, pal.leaves);
                top.beginPath();
                top.moveTo(0, 0);
                top.quadraticCurveTo(len * 0.25, -len * 0.5, 0, -len);
                top.quadraticCurveTo(-len * 0.25, -len * 0.5, 0, 0);
                top.fill();
                top.restore();
            }
        }
    },
    rock: function(ctx, x, y, r, pal, rng) {
        battleBackdrop.softShadow(ctx, x + r * 0.45, y + r * 0.1, r * 1.25, r * 0.5, 0.4);
        battleBackdrop.blobPath(ctx, x, y - r * 0.32, r, r * 0.72, rng, 0.45, 7);
        const g = ctx.createLinearGradient(x - r, y - r, x + r * 0.8, y + r * 0.4);
        g.addColorStop(0, pal.light);
        g.addColorStop(0.5, pal.mid);
        g.addColorStop(1, pal.dark);
        ctx.fillStyle = g;
        ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,0.3)";
        ctx.lineWidth = 1;
        ctx.stroke();
        if (pal.cap) {
            ctx.fillStyle = pal.cap;
            battleBackdrop.blobPath(ctx, x - r * 0.12, y - r * 0.62, r * 0.75, r * 0.32, rng, 0.4, 7);
            ctx.fill();
        }
    },
    stoneLantern: function(scene, ctx, x, y, s, lit) {
        const stone = "#8e8b84";
        const dark = "#5d5a55";
        battleBackdrop.softShadow(ctx, x + 10 * s, y + 2, 20 * s, 7 * s, 0.4);
        const box = function(cx, top, w, h, col) {
            const g = ctx.createLinearGradient(cx - w / 2, 0, cx + w / 2, 0);
            g.addColorStop(0, battleBackdrop.shade(col, 0.15));
            g.addColorStop(1, battleBackdrop.shade(col, -0.25));
            ctx.fillStyle = g;
            ctx.fillRect(cx - w / 2, top, w, h);
        };
        box(x, y - 5 * s, 18 * s, 5 * s, dark);
        box(x, y - 19 * s, 7 * s, 14 * s, stone);
        box(x, y - 23 * s, 16 * s, 4 * s, dark);
        box(x, y - 33 * s, 12 * s, 10 * s, stone);
        ctx.fillStyle = lit ? "#ffd27a" : "#2b2926";
        ctx.fillRect(x - 3 * s, y - 31 * s, 6 * s, 5.5 * s);
        ctx.fillStyle = battleBackdrop.shade(dark, -0.1);
        ctx.beginPath();
        ctx.moveTo(x - 13 * s, y - 32 * s);
        ctx.quadraticCurveTo(x - 6 * s, y - 34 * s, x - 3 * s, y - 40 * s);
        ctx.lineTo(x + 3 * s, y - 40 * s);
        ctx.quadraticCurveTo(x + 6 * s, y - 34 * s, x + 13 * s, y - 32 * s);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = stone;
        ctx.beginPath();
        ctx.arc(x, y - 41 * s, 2.4 * s, 0, BACKDROP_TAU);
        ctx.fill();
        ctx.fillStyle = "rgba(90,130,60,0.55)";
        ctx.fillRect(x - 9 * s, y - 5 * s, 4 * s, 1.5 * s);
        ctx.fillRect(x + 2 * s, y - 23 * s, 5 * s, 1.2 * s);
        if (lit) {
            battleBackdrop.addLight(scene, x, y - 28 * s, 46 * s, "#ffb35c", 0.5, 0.6);
        }
    },
    paperLantern: function(scene, ctx, x, y, s, color) {
        ctx.strokeStyle = "#1a1210";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, y - 30 * s);
        ctx.lineTo(x, y - 18 * s);
        ctx.stroke();
        const g = ctx.createRadialGradient(x - 2 * s, y - 11 * s, 1, x, y - 10 * s, 9 * s);
        g.addColorStop(0, "#ffe2a8");
        g.addColorStop(0.45, color);
        g.addColorStop(1, battleBackdrop.shade(color, -0.45));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(x, y - 10 * s, 6.5 * s, 8.5 * s, 0, 0, BACKDROP_TAU);
        ctx.fill();
        ctx.strokeStyle = battleBackdrop.rgba("#4a1208", 0.45);
        ctx.lineWidth = 0.8;
        for (let k = -2; k <= 2; k++) {
            ctx.beginPath();
            ctx.ellipse(x, y - 10 * s + k * 3 * s, 6.3 * s * Math.sqrt(1 - (k * k) / 9), 0.6 * s, 0, 0, BACKDROP_TAU);
            ctx.stroke();
        }
        ctx.fillStyle = "#16100e";
        ctx.fillRect(x - 3.5 * s, y - 19.5 * s, 7 * s, 2 * s);
        ctx.fillRect(x - 3.5 * s, y - 2.5 * s, 7 * s, 2 * s);
        battleBackdrop.addLight(scene, x, y - 10 * s, 120 * s, "#ff9a4a", 0.6, 0.55);
        // Warm pool of light cast on the ground below.
        const pool = ctx.createRadialGradient(x, y + 18 * s, 0, x, y + 18 * s, 70 * s);
        pool.addColorStop(0, "rgba(255,160,80,0.2)");
        pool.addColorStop(1, "rgba(255,160,80,0)");
        ctx.fillStyle = pool;
        ctx.fillRect(x - 70 * s, y - 52 * s, 140 * s, 140 * s);
    },
    torii: function(scene, ctx, xL, xR, y, h, pal) {
        const pw = 13;
        // Shadow of the beams falling across the path.
        ctx.fillStyle = "rgba(0,0,0,0.22)";
        ctx.fillRect(xL + 10, y + 4, xR - xL, 10);
        battleBackdrop.softShadow(ctx, xL + 14, y + 3, 16, 6, 0.4);
        battleBackdrop.softShadow(ctx, xR + 14, y + 3, 16, 6, 0.4);
        const pillar = function(px) {
            const g = ctx.createLinearGradient(px - pw / 2, 0, px + pw / 2, 0);
            g.addColorStop(0, battleBackdrop.shade(pal.red, 0.18));
            g.addColorStop(0.6, pal.red);
            g.addColorStop(1, battleBackdrop.shade(pal.red, -0.35));
            ctx.fillStyle = g;
            ctx.fillRect(px - pw / 2, y - h, pw, h);
            ctx.fillStyle = "#151112";
            ctx.fillRect(px - pw / 2 - 1.5, y - 9, pw + 3, 9);
        };
        pillar(xL);
        pillar(xR);
        const beam = function(top, height, over, col) {
            const g = ctx.createLinearGradient(0, top, 0, top + height);
            g.addColorStop(0, battleBackdrop.shade(col, 0.15));
            g.addColorStop(1, battleBackdrop.shade(col, -0.3));
            ctx.fillStyle = g;
            ctx.fillRect(xL - over, top, xR - xL + over * 2, height);
        };
        beam(y - h * 0.74, 8, 16, pal.red);
        beam(y - h * 0.94, 9, 10, pal.red);
        ctx.fillStyle = "#17131a";
        ctx.beginPath();
        ctx.moveTo(xL - 30, y - h - 9);
        ctx.quadraticCurveTo((xL + xR) / 2, y - h + 2, xR + 30, y - h - 9);
        ctx.lineTo(xR + 26, y - h - 1);
        ctx.quadraticCurveTo((xL + xR) / 2, y - h + 7, xL - 26, y - h - 1);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "#1c1618";
        ctx.fillRect((xL + xR) / 2 - 9, y - h * 0.92, 18, h * 0.18);
        ctx.strokeStyle = "#c9a45c";
        ctx.lineWidth = 1;
        ctx.strokeRect((xL + xR) / 2 - 7, y - h * 0.9, 14, h * 0.14);
    },
    /** Bamboo privacy screen running down the field: top rail plus a darker face, posts and ties. */
    bambooFence: function(ctx, x, y0, y1, pal, faceDir) {
        const face = 9 * faceDir;
        ctx.fillStyle = "rgba(0,0,0,0.3)";
        ctx.fillRect(Math.min(x, x + face * 2.2), y0 + 6, Math.abs(face) * 2.2 + 6, y1 - y0);
        ctx.fillStyle = battleBackdrop.shade(pal, -0.3);
        ctx.fillRect(Math.min(x, x + face), y0, Math.abs(face) + 6, y1 - y0);
        for (let y = y0 + 2; y < y1; y += 4) {
            ctx.fillStyle = battleBackdrop.rgba("#000000", 0.18);
            ctx.fillRect(Math.min(x, x + face), y, Math.abs(face) + 6, 1);
        }
        const g = ctx.createLinearGradient(x - 3, 0, x + 3, 0);
        g.addColorStop(0, battleBackdrop.shade(pal, 0.25));
        g.addColorStop(1, battleBackdrop.shade(pal, -0.1));
        ctx.fillStyle = g;
        ctx.fillRect(x - 3, y0, 6, y1 - y0);
        ctx.fillStyle = "#2a1d12";
        for (let y = y0; y <= y1; y += 34) {
            ctx.fillRect(x - 4, y, 8, 2.2);
            ctx.fillStyle = "#3a2818";
            ctx.fillRect(x - 4.5, y - 3, 9, 6);
            ctx.fillStyle = "#2a1d12";
        }
    },
    onsenPool: function(scene, ctx, cx, cy, rx, ry, rng) {
        battleBackdrop.blobPath(ctx, cx, cy, rx + 6, ry + 6, rng, 0.25, 11);
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.fill();
        const shapeSeed = rng() * 1e9;
        battleBackdrop.blobPath(ctx, cx, cy, rx, ry, battleBackdrop.rng(shapeSeed), 0.25, 11);
        const g = ctx.createRadialGradient(cx - rx * 0.2, cy - ry * 0.2, 2, cx, cy, Math.max(rx, ry));
        g.addColorStop(0, "#9ee6dc");
        g.addColorStop(0.55, "#4fb4b3");
        g.addColorStop(1, "#22717c");
        ctx.fillStyle = g;
        ctx.fill();
        ctx.save();
        ctx.clip();
        ctx.strokeStyle = "rgba(255,255,255,0.22)";
        ctx.lineWidth = 1.2;
        for (let k = 0; k < 5; k++) {
            ctx.beginPath();
            ctx.ellipse(cx + (rng() - 0.5) * rx, cy + (rng() - 0.5) * ry, 6 + rng() * 12, 2 + rng() * 3, 0, 0, BACKDROP_TAU);
            ctx.stroke();
        }
        ctx.fillStyle = "rgba(0,30,40,0.25)";
        ctx.fillRect(cx - rx - 10, cy - ry - 10, rx * 2 + 20, 10);
        ctx.restore();
        const rockPal = { light: "#7c766f", mid: "#57524d", dark: "#34302d" };
        const nRocks = Math.round((rx + ry) / 7);
        for (let k = 0; k < nRocks; k++) {
            const a = (k / nRocks) * BACKDROP_TAU + rng() * 0.2;
            battleBackdrop.rock(ctx, cx + Math.cos(a) * (rx + 3), cy + Math.sin(a) * (ry + 3) + 5, 6 + rng() * 6, rockPal, rng);
        }
        battleBackdrop.addEmitter(scene, cx, cy, rx, ry);
    },
    roofBlock: function(ctx, side, y0, y1, edgeX, W, pal, rng) {
        const x0 = side === 0 ? 0 : edgeX;
        const x1 = side === 0 ? edgeX : W;
        const ridgeX = side === 0 ? 8 : W - 8;
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        if (side === 0) {
            ctx.fillRect(x1, y0 + 4, 14, y1 - y0);
        } else {
            ctx.fillRect(x0 - 14, y0 + 4, 14, y1 - y0);
        }
        const g = ctx.createLinearGradient(ridgeX, 0, side === 0 ? x1 : x0, 0);
        g.addColorStop(0, battleBackdrop.shade(pal.roof, -0.25));
        g.addColorStop(1, battleBackdrop.shade(pal.roof, 0.12));
        ctx.fillStyle = g;
        ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
        for (let y = y0 + 3; y < y1; y += 6) {
            ctx.fillStyle = "rgba(0,0,0,0.35)";
            ctx.fillRect(x0, y, x1 - x0, 1.6);
            ctx.fillStyle = "rgba(255,255,255,0.07)";
            ctx.fillRect(x0, y - 2, x1 - x0, 1);
        }
        ctx.fillStyle = battleBackdrop.shade(pal.roof, -0.45);
        ctx.fillRect(side === 0 ? x1 - 4 : x0, y0, 4, y1 - y0);
        for (let y = y0 + 3; y < y1; y += 6) {
            ctx.beginPath();
            ctx.arc(side === 0 ? x1 - 2 : x0 + 2, y, 2.4, 0, BACKDROP_TAU);
            ctx.fill();
        }
        ctx.fillStyle = battleBackdrop.shade(pal.roof, -0.55);
        ctx.fillRect(ridgeX - 5, y0, 10, y1 - y0);
        ctx.fillStyle = battleBackdrop.shade(pal.roof, -0.2);
        ctx.fillRect(ridgeX - 5, y0, 10, 6);
        ctx.fillRect(ridgeX - 5, y1 - 6, 10, 6);
    },

    // ---------------------------------------------------------------- shared tile builders

    mirrorX: function(W, x, side) {
        return side === 0 ? x : W - x;
    },
    edgeCanopy: function(scene, rng, opts) {
        const layer = scene.canopy;
        const ctx = layer.ctx;
        const T = layer.h;
        const W = layer.w;
        const slots = battleBackdrop.sideSlots(T, rng, opts.spacing, opts.spacing * 0.6, opts.reach, -20, W);
        for (let i = 0; i < slots.length; i++) {
            const s = slots[i];
            const R = opts.size[0] + s.r * (opts.size[1] - opts.size[0]);
            battleBackdrop.wrapY(T, s.y, R * 1.4, function(yy) {
                opts.draw(ctx, s.x, yy, R, s.side, rng);
            });
        }
    },
    leafCluster: function(ctx, x, y, R, rng, colors, alpha) {
        ctx.globalAlpha = alpha;
        for (let i = 0; i < 26; i++) {
            const a = rng() * BACKDROP_TAU;
            const d = R * Math.sqrt(rng());
            const r = R * (0.18 + rng() * 0.2);
            const px = x + Math.cos(a) * d;
            const py = y + Math.sin(a) * d * 0.8;
            ctx.fillStyle = colors[Math.min(colors.length - 1, Math.floor((1 - (py - y + R) / (2 * R)) * colors.length * 0.5 + rng() * colors.length * 0.6))];
            ctx.beginPath();
            ctx.arc(px, py, r, 0, BACKDROP_TAU);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    },
    pineBough: function(ctx, x, y, R, side, rng, colors) {
        const dir = side === 0 ? 1 : -1;
        ctx.strokeStyle = "rgba(20,14,10,0.85)";
        ctx.lineWidth = 3;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(x - dir * R, y + R * 0.2);
        ctx.quadraticCurveTo(x, y - R * 0.1, x + dir * R * 0.7, y + R * 0.15);
        ctx.stroke();
        // Needle tufts along the bough: dark underlayer first, lighter needles on top.
        ctx.lineWidth = 1.5;
        for (let pass = 0; pass < 2; pass++) {
            for (let i = 0; i < 8; i++) {
                const t = i / 7;
                const p = battleBackdrop.qpt(x - dir * R, y + R * 0.2, x, y - R * 0.1, x + dir * R * 0.7, y + R * 0.15, t);
                const rr = R * (0.42 - t * 0.18) * (pass === 0 ? 1 : 0.75);
                for (let k = 0; k < 16; k++) {
                    const a = rng() * BACKDROP_TAU;
                    const len = rr * (0.55 + rng() * 0.45);
                    ctx.strokeStyle = pass === 0 ? colors[0] : colors[1 + Math.floor(rng() * (colors.length - 1))];
                    ctx.globalAlpha = pass === 0 ? 0.9 : 0.85;
                    ctx.beginPath();
                    ctx.moveTo(p[0], p[1] - (pass === 1 ? 2 : 0));
                    ctx.lineTo(p[0] + Math.cos(a) * len, p[1] + Math.sin(a) * len * 0.75 - (pass === 1 ? 2 : 0));
                    ctx.stroke();
                }
            }
        }
        ctx.globalAlpha = 1;
    },
    /** Cobblestones (ishidatami) filling the band between left(y) and right(y); cell must divide the tile height. */
    cobbles: function(ctx, T, left, right, cell, base, mortar, seed) {
        battleBackdrop.fillBand(ctx, T, function(y) { return (left(y) + right(y)) / 2; }, function(y) { return right(y) - left(y); }, 0, mortar);
        const rows = Math.round(T / cell);
        const W = gameData.battle.battlefieldWidthPx;
        const cols = Math.ceil(W / cell) + 2;
        for (let r = 0; r < rows; r++) {
            for (let c = -1; c < cols; c++) {
                const h1 = battleBackdrop.hash2(c, r, seed);
                const h2 = battleBackdrop.hash2(c, r, seed + 1);
                const cx = (c + (r % 2) * 0.5) * cell + (h1 - 0.5) * cell * 0.42;
                const cy = r * cell + (h2 - 0.5) * cell * 0.42;
                const rad = cell * (0.4 + battleBackdrop.hash2(c, r, seed + 2) * 0.16);
                if (cx < left(cy) + cell * 0.3 || cx > right(cy) - cell * 0.3) {
                    continue;
                }
                battleBackdrop.wrapY(T, cy, cell, function(yy) {
                    const rng = battleBackdrop.rng(Math.floor(h1 * 1e9));
                    battleBackdrop.blobPath(ctx, cx, yy, rad * 1.08, rad * 0.92, rng, 0.35, 7);
                    const g = ctx.createLinearGradient(cx - cell * 0.5, yy - cell * 0.5, cx + cell * 0.5, yy + cell * 0.5);
                    g.addColorStop(0, battleBackdrop.shade(base, 0.12 + (h2 - 0.5) * 0.2));
                    g.addColorStop(1, battleBackdrop.shade(base, -0.28 + (h2 - 0.5) * 0.2));
                    ctx.fillStyle = g;
                    ctx.fill();
                });
            }
        }
    },

    // ---------------------------------------------------------------- themes

    themes: {
        meadow: {
            light: { tint: "rgba(255,214,150,0.06)", dim: 0.1, vignette: "rgba(6,14,8,0.55)", shafts: "#fff1c8" },
            streakColor: "#f5ffe8",
            particles: [
                { kind: "cloudShadow", count: 3, size: [180, 260], vx: [6, 10], colors: ["#000000"], wrapMargin: 280 },
                { kind: "mote", count: 40, size: [0.8, 1.8], vx: [-6, 6], vy: [-4, 4], colors: ["#fff1b8", "#f8ffd0"], additive: true, high: true, parallax: 1.1 }
            ],
            paint: function(scene, rng) {
                const B = battleBackdrop;
                const tr = scene.terrain;
                B.paintNoiseGround(tr, scene.seed, ["#26401f", "#355827", "#47702f", "#5b863b", "#6f9646"], { cell: 80, accent: { color: "#7a9e4a", threshold: 0.6, amount: 0.5 } });
                B.speckle(tr.ctx, tr.w, tr.h, rng, 3500, "rgba(190,230,140,0.18)", "rgba(10,30,10,0.18)", 1.6);
                const pathX = B.makeMeander(tr.h, rng, tr.w / 2, 105, 38);
                const width = function(y) { return 104 + 14 * Math.sin((BACKDROP_TAU * 3 * y) / tr.h + 1.3); };
                B.dirtPath(scene, rng, pathX, width, { color: "#8a7350", edge: "#4f4130", light: "#b39a6e", stone: "#958e80" });
                const off = B.offPath(scene, 6);
                const greens = ["#7fae4c", "#91bf58", "#5e8f3a", "#a6c968"];
                B.scatter(tr, rng, 900, 10, off, function(ctx, x, y, r1) {
                    B.grassTuft(ctx, x, y, 5 + r1 * 6, greens[Math.floor(r1 * greens.length)], rng);
                });
                const flowers = ["#f4ecc0", "#ffffff", "#e8a6cc", "#b9a6f2", "#f6d34a"];
                B.scatter(tr, rng, 260, 6, off, function(ctx, x, y, r1, r2) {
                    B.flower(ctx, x, y, 1 + r2 * 0.9, flowers[Math.floor(r1 * flowers.length)]);
                });
                const pr = scene.props;
                const pinePal = { trunk: "#4a3322", light: "#4f7f45", mid: "#2f5a32", dark: "#173322" };
                const rockPal = { light: "#a39f93", mid: "#77736a", dark: "#47443f" };
                const slots = B.sideSlots(pr.h, rng, 150, 80, 70, 4, pr.w);
                for (let i = 0; i < slots.length; i++) {
                    const s = slots[i];
                    B.wrapY(pr.h, s.y, 170, function(yy) {
                        if (s.r < 0.72) {
                            B.pine(pr.ctx, s.x, yy, 110 + s.r * 70, pinePal, B.rng(i * 31 + 7), false, scene.overhead.ctx);
                        } else {
                            B.rock(pr.ctx, s.x, yy, 12 + s.r * 10, rockPal, B.rng(i * 31 + 7));
                        }
                    });
                }
                for (let i = 0; i < 7; i++) {
                    const y = rng() * pr.h;
                    const x = rng() < 0.5 ? 90 + rng() * 60 : pr.w - 90 - rng() * 60;
                    B.wrapY(pr.h, y, 30, function(yy) {
                        B.rock(pr.ctx, x, yy, 6 + rng() * 6, rockPal, B.rng(i * 13 + 3));
                    });
                }
                B.edgeCanopy(scene, rng, {
                    spacing: 260, reach: 30, size: [46, 70],
                    draw: function(ctx, x, y, R, side, r) {
                        B.pineBough(ctx, x, y, R, side, r, ["#1e3f24", "#28512c", "#163220", "#335f34"]);
                    }
                });
            }
        },
        bamboo: {
            light: { tint: "rgba(120,200,140,0.05)", dim: 0.14, vignette: "rgba(4,16,8,0.62)", shafts: "#e9ffd6" },
            streakColor: "#e9ffd6",
            particles: [
                { kind: "bambooLeaf", count: 18, size: [2.4, 3.6], vx: [-10, 10], vy: [4, 12], spin: 1.5, colors: ["#a9c25c", "#c8cf6a", "#8daa48", "#d6c779"], parallax: 1.15, high: true },
                { kind: "mote", count: 26, size: [0.7, 1.4], vx: [-4, 4], vy: [-3, 3], colors: ["#f2ffd2"], additive: true, high: true, parallax: 1.05 }
            ],
            paint: function(scene, rng) {
                const B = battleBackdrop;
                const tr = scene.terrain;
                B.paintNoiseGround(tr, scene.seed, ["#18261a", "#22341f", "#2d4425", "#3b552c", "#4c6633"], { cell: 64, accent: { color: "#536f30", threshold: 0.58, amount: 0.6 } });
                const leafCols = ["#8a8a46", "#a09a54", "#6f7a3a", "#b6a865", "#5f6a34"];
                B.scatter(tr, rng, 1500, 8, null, function(ctx, x, y, r1, r2) {
                    ctx.globalAlpha = 0.75;
                    B.fallenLeaf(ctx, x, y, 3 + r2 * 3.5, r1 * BACKDROP_TAU, leafCols[Math.floor(r2 * leafCols.length)]);
                    ctx.globalAlpha = 1;
                });
                const pathX = B.makeMeander(tr.h, rng, tr.w / 2, 70, 26);
                scene.pathX = pathX;
                scene.pathWidth = function() { return 70; };
                B.softBand(tr.ctx, tr.h, pathX, scene.pathWidth, "#3a3424", 4, 18);
                // Stepping stones.
                for (let y = 0; y < tr.h; y += 46) {
                    const x = pathX(y) + ((y / 46) % 2 === 0 ? -12 : 12) + (rng() - 0.5) * 6;
                    B.wrapY(tr.h, y, 20, function(yy) {
                        const ctx = tr.ctx;
                        B.softShadow(ctx, x + 4, yy + 4, 24, 14, 0.4);
                        B.blobPath(ctx, x, yy, 21, 13, B.rng(y + 11), 0.25, 9);
                        const g = ctx.createLinearGradient(x - 20, yy - 12, x + 20, yy + 12);
                        g.addColorStop(0, "#a3a69c");
                        g.addColorStop(1, "#5f625b");
                        ctx.fillStyle = g;
                        ctx.fill();
                        ctx.strokeStyle = "rgba(110,150,70,0.6)";
                        ctx.lineWidth = 2;
                        ctx.stroke();
                        ctx.fillStyle = "rgba(255,255,255,0.12)";
                        ctx.beginPath();
                        ctx.ellipse(x - 5, yy - 4, 9, 4, 0, 0, BACKDROP_TAU);
                        ctx.fill();
                    });
                }
                const pr = scene.props;
                const pal = { culm: "#7fa046", culm2: "#9bb655", leaves: ["#5f8a34", "#79a142", "#93b84f", "#4b7530"] };
                const slots = B.sideSlots(pr.h, rng, 70, 40, 95, 0, pr.w);
                for (let i = 0; i < slots.length; i++) {
                    const s = slots[i];
                    const lean = s.side === 0 ? -0.18 : 0.18;
                    B.wrapY(pr.h, s.y, 40, function(yy) {
                        B.bambooClump(pr.ctx, s.x, yy, 170 + s.r * 90, lean, pal, B.rng(i * 97 + 1), scene.overhead.ctx);
                    });
                }
                B.edgeCanopy(scene, rng, {
                    spacing: 150, reach: 26, size: [40, 64],
                    draw: function(ctx, x, y, R, side, r) {
                        for (let k = 0; k < 16; k++) {
                            const a = (side === 0 ? 0 : Math.PI) + (r() - 0.5) * 2.2;
                            const len = R * (0.6 + r() * 0.6);
                            ctx.save();
                            ctx.translate(x, y + (r() - 0.5) * R * 0.6);
                            ctx.rotate(a);
                            ctx.globalAlpha = 0.85;
                            ctx.fillStyle = B.pick(r, ["#2f5a22", "#3f6e2a", "#527f33", "#264b1d"]);
                            ctx.beginPath();
                            ctx.moveTo(0, 0);
                            ctx.quadraticCurveTo(len * 0.5, -len * 0.14, len, 0);
                            ctx.quadraticCurveTo(len * 0.5, len * 0.14, 0, 0);
                            ctx.fill();
                            ctx.restore();
                        }
                        ctx.globalAlpha = 1;
                    }
                });
            }
        },
        onsen: {
            light: { tint: "rgba(255,170,120,0.07)", dim: 0.12, vignette: "rgba(12,6,6,0.6)", shafts: null },
            streakColor: "#ffe9dc",
            particles: [
                { kind: "steam", count: 60, emit: true, size: [30, 54], vx: [-6, 6], vy: [0, 0], life: [3.5, 6], colors: ["#f4fbff"], high: true },
                { kind: "ember", count: 10, size: [0.8, 1.4], vx: [-5, 5], vy: [-14, -6], life: [3, 6], colors: ["#ffbf7a"], additive: true, high: true }
            ],
            paint: function(scene, rng) {
                const B = battleBackdrop;
                const tr = scene.terrain;
                B.paintNoiseGround(tr, scene.seed, ["#1f1b1b", "#2b2626", "#38312f", "#463d38", "#574b42"], { cell: 40, contrast: 1.9 });
                B.speckle(tr.ctx, tr.w, tr.h, rng, 5000, "rgba(200,190,175,0.14)", "rgba(0,0,0,0.25)", 1.8);
                B.scatter(tr, rng, 260, 6, null, function(ctx, x, y, r1, r2) {
                    B.pebble(ctx, x, y, 1.5 + r1 * 2.5, r2 < 0.5 ? "#6d655d" : "#857b70");
                });
                const pathX = B.makeMeander(tr.h, rng, tr.w / 2, 28, 10);
                scene.pathX = pathX;
                scene.pathWidth = function() { return 132; };
                const ctx = tr.ctx;
                B.softBand(ctx, tr.h, pathX, scene.pathWidth, "#000000", 4, 12);
                // Boardwalk: planks across the walk.
                for (let y = -16; y < tr.h + 16; y += 15) {
                    const xl0 = pathX(y) - 66;
                    const xr0 = pathX(y) + 66;
                    const xl1 = pathX(y + 13) - 66;
                    const xr1 = pathX(y + 13) + 66;
                    const tone = B.hash2(Math.round(((y % tr.h) + tr.h) % tr.h), 3, scene.seed);
                    ctx.fillStyle = B.shade("#8a6a48", (tone - 0.5) * 0.3);
                    ctx.beginPath();
                    ctx.moveTo(xl0, y);
                    ctx.lineTo(xr0, y);
                    ctx.lineTo(xr1, y + 13);
                    ctx.lineTo(xl1, y + 13);
                    ctx.closePath();
                    ctx.fill();
                    ctx.fillStyle = "rgba(255,240,210,0.12)";
                    ctx.fillRect(xl0, y, 132, 1.5);
                    ctx.fillStyle = "rgba(40,22,10,0.35)";
                    for (let g = 0; g < 3; g++) {
                        ctx.fillRect(xl0 + 10 + tone * 40 + g * 37, y + 4 + g * 2, 22 + g * 5, 0.8);
                    }
                    ctx.fillStyle = "#2a1a10";
                    ctx.fillRect(xl0 + 7, y + 5, 2, 2);
                    ctx.fillRect(xr0 - 9, y + 5, 2, 2);
                }
                B.strokeAlong(ctx, tr.h, function(y) { return pathX(y) - 66; }, 4, "#4a3322");
                B.strokeAlong(ctx, tr.h, function(y) { return pathX(y) + 66; }, 4, "#4a3322");
                const pr = scene.props;
                const mossCols = ["#3f5a2a", "#4d6a30", "#34502a"];
                B.scatter(tr, rng, 90, 30, B.offPath(scene, 30), function(c, x, yy, r1, r2) {
                    c.globalAlpha = 0.55;
                    B.blobPath(c, x, yy, 10 + r1 * 22, 6 + r1 * 12, B.rng(Math.floor(r2 * 1e9)), 0.5, 8);
                    c.fillStyle = mossCols[Math.floor(r2 * mossCols.length)];
                    c.fill();
                    c.globalAlpha = 1;
                });
                // Each side alternates pools with fenced rock gardens; the fences are why the peepers came.
                for (let side = 0; side < 2; side++) {
                    let y = side * 260 + rng() * 80;
                    const dir = side === 0 ? 1 : -1;
                    while (y < pr.h - 80) {
                        const rx = 95 + rng() * 45;
                        const ry = 70 + rng() * 34;
                        const cx = side === 0 ? 20 + rng() * 26 : pr.w - 20 - rng() * 26;
                        const cy = y + ry;
                        const pseed = rng() * 1e9;
                        B.wrapY(pr.h, cy, ry + 30, function(yy) {
                            B.onsenPool(scene, pr.ctx, cx, yy, rx, ry, B.rng(pseed));
                        });
                        const fx = side === 0 ? 150 + rng() * 10 : pr.w - 150 - rng() * 10;
                        const fy0 = cy + ry + 24;
                        const flen = 120 + rng() * 90;
                        const gseed = rng() * 1e9;
                        B.wrapY(pr.h, fy0, flen + 60, function(yy) {
                            const gr = B.rng(gseed);
                            for (let k = 0; k < 4; k++) {
                                B.rock(pr.ctx, B.mirrorX(pr.w, 30 + gr() * 90, side), yy + 20 + gr() * (flen - 30), 8 + gr() * 12, { light: "#837b72", mid: "#5d5650", dark: "#36322e" }, gr);
                            }
                            B.bambooFence(pr.ctx, fx, yy, yy + flen, "#c2a46a", -dir);
                            B.stoneLantern(scene, pr.ctx, fx - dir * 34, yy + flen + 20, 0.95, true);
                        });
                        y += ry * 2 + flen + 70 + rng() * 60;
                    }
                }
                B.edgeCanopy(scene, rng, {
                    spacing: 380, reach: 24, size: [40, 58],
                    draw: function(ctx2, x, yy, R, sd, r) {
                        B.pineBough(ctx2, x, yy, R, sd, r, ["#1a2f22", "#22402a", "#132519"]);
                    }
                });
            }
        },
        sakura: {
            light: { tint: "rgba(255,200,225,0.07)", dim: 0.06, vignette: "rgba(30,10,24,0.45)", shafts: "#fff0f6" },
            streakColor: "#fff0f6",
            particles: [
                { kind: "petal", count: 60, size: [2.2, 3.6], vx: [6, 18], vy: [6, 16], spin: 2.5, colors: ["#ffc6dc", "#ffb0cc", "#ffe0ec", "#f7a0c0"], parallax: 1.12, high: true },
                { kind: "glint", count: 16, size: [1.2, 2.2], colors: ["#ffffff"], parallax: 1 }
            ],
            paint: function(scene, rng) {
                const B = battleBackdrop;
                const tr = scene.terrain;
                B.paintNoiseGround(tr, scene.seed, ["#33522f", "#42683a", "#538047", "#669453", "#78a35e"], { cell: 80, accent: { color: "#d9aebd", threshold: 0.66, amount: 0.3 } });
                B.speckle(tr.ctx, tr.w, tr.h, rng, 2500, "rgba(220,255,200,0.15)", "rgba(10,30,10,0.15)", 1.5);
                // Stream along the left side.
                const streamX = B.makeMeander(tr.h, rng, 78, 18, 8);
                const streamW = function(y) { return 64 + 10 * Math.sin((BACKDROP_TAU * 2 * y) / tr.h); };
                B.softBand(tr.ctx, tr.h, streamX, streamW, "#2a3b2a", 4, 14);
                B.fillBand(tr.ctx, tr.h, streamX, streamW, 3, "#5b5346");
                B.fillBand(tr.ctx, tr.h, streamX, streamW, 0, "#3b6f93");
                B.fillBand(tr.ctx, tr.h, streamX, function(y) { return streamW(y) * 0.55; }, 0, "rgba(120,180,215,0.45)");
                for (let i = 0; i < 160; i++) {
                    const y = rng() * tr.h;
                    const x = streamX(y) + (rng() - 0.5) * streamW(y) * 0.8;
                    tr.ctx.strokeStyle = "rgba(220,240,255,0.35)";
                    tr.ctx.lineWidth = 1;
                    tr.ctx.beginPath();
                    tr.ctx.moveTo(x, y);
                    tr.ctx.lineTo(x + 1, y + 6 + rng() * 8);
                    tr.ctx.stroke();
                }
                const bankRock = { light: "#9b968c", mid: "#6e6a62", dark: "#45423d" };
                for (let i = 0; i < 46; i++) {
                    const y = rng() * tr.h;
                    const side = rng() < 0.5 ? -1 : 1;
                    const x = streamX(y) + side * (streamW(y) / 2 + 2);
                    B.wrapY(tr.h, y, 14, function(yy) {
                        B.rock(tr.ctx, x, yy, 4 + rng() * 5, bankRock, B.rng(i + 400));
                    });
                }
                const pathX = B.makeMeander(tr.h, rng, tr.w / 2 + 50, 70, 26);
                const width = function() { return 92; };
                B.dirtPath(scene, rng, pathX, width, { color: "#bba483", edge: "#6b5a43", light: "#d8c4a2", stone: "#a49d90" });
                const streamOff = function(x, y) {
                    return Math.abs(x - streamX(y)) < streamW(y) / 2 + 8 || Math.abs(x - pathX(y)) < 52;
                };
                const greens = ["#8cc05c", "#a2cf6c", "#6fa04a"];
                B.scatter(tr, rng, 700, 10, streamOff, function(ctx, x, y, r1) {
                    B.grassTuft(ctx, x, y, 5 + r1 * 5, greens[Math.floor(r1 * greens.length)], rng);
                });
                const petals = ["#ffc6dc", "#ffdbe8", "#f7a8c4"];
                B.scatter(tr, rng, 900, 4, null, function(ctx, x, y, r1, r2) {
                    ctx.globalAlpha = 0.8;
                    B.fallenLeaf(ctx, x, y, 1.6 + r2 * 1.4, r1 * BACKDROP_TAU, petals[Math.floor(r2 * petals.length)]);
                    ctx.globalAlpha = 1;
                });
                const pr = scene.props;
                const treePal = { trunk: "#4b2f2a", dark: "#c9789a", mid: "#efa7c2", light: "#ffd6e5", accent: ["#ffffff", "#ffe8f1", "#e48aad"] };
                const slots = B.sideSlots(pr.h, rng, 210, 100, 66, 10, pr.w);
                for (let i = 0; i < slots.length; i++) {
                    const s = slots[i];
                    if (s.side === 0 && s.r < 0.5) {
                        continue;
                    }
                    B.wrapY(pr.h, s.y, 150, function(yy) {
                        B.roundTree(pr.ctx, s.x, yy, 120 + s.r * 50, treePal, B.rng(i * 53 + 5), scene.overhead.ctx);
                    });
                }
                for (let i = 0; i < 3; i++) {
                    const y = (i + rng() * 0.5) * (pr.h / 3);
                    B.wrapY(pr.h, y, 50, function(yy) {
                        B.stoneLantern(scene, pr.ctx, pr.w - 112, yy, 0.85, false);
                    });
                }
                B.edgeCanopy(scene, rng, {
                    spacing: 210, reach: 34, size: [44, 70],
                    draw: function(ctx, x, y, R, side, r) {
                        B.leafCluster(ctx, x, y, R, r, ["#ffe3ee", "#ffc4da", "#f3a2c0", "#d9799e"], 0.85);
                    }
                });
            }
        },
        lanternStreet: {
            light: { tint: "rgba(50,50,120,0.1)", dim: 0.08, vignette: "rgba(4,4,16,0.66)", shafts: null },
            streakColor: "#ffd9b0",
            particles: [
                { kind: "firefly", count: 18, size: [0.8, 1.3], colors: ["#ffcf7a"], additive: true, high: true, parallax: 1.05 },
                { kind: "ember", count: 14, size: [0.6, 1.1], vx: [-4, 4], vy: [-10, -4], life: [3, 6], colors: ["#ff9a4a"], additive: true, high: true }
            ],
            paint: function(scene, rng) {
                const B = battleBackdrop;
                const tr = scene.terrain;
                const W = tr.w;
                const T = tr.h;
                const ctx = tr.ctx;
                B.paintNoiseGround(tr, scene.seed, ["#1d1b22", "#24212a", "#2c2833", "#35303c"], { cell: 64 });
                scene.pathX = function() { return W / 2; };
                scene.pathWidth = function() { return W - 150; };
                B.cobbles(ctx, T, function() { return 70; }, function() { return W - 70; }, 32, "#4c4652", "#17141b", scene.seed + 3);
                B.speckle(ctx, W, T, rng, 3000, "rgba(255,230,200,0.08)", "rgba(0,0,0,0.25)", 1.4);
                // Puddles catching lantern light.
                for (let i = 0; i < 6; i++) {
                    const py = rng() * T;
                    const px = 150 + rng() * (W - 300);
                    const ps = rng() * 1e9;
                    B.wrapY(T, py, 30, function(yy) {
                        B.blobPath(ctx, px, yy, 22 + B.rng(ps)() * 18, 8 + B.rng(ps + 1)() * 5, B.rng(ps), 0.4, 8);
                        ctx.fillStyle = "rgba(20,24,44,0.55)";
                        ctx.fill();
                        ctx.strokeStyle = "rgba(255,170,90,0.18)";
                        ctx.lineWidth = 1;
                        ctx.stroke();
                    });
                }
                // Walkways (engawa) along both sides.
                for (let side = 0; side < 2; side++) {
                    const x0 = side === 0 ? 0 : W - 70;
                    ctx.fillStyle = "#3a2a20";
                    ctx.fillRect(x0, 0, 70, T);
                    for (let py = 0; py < T; py += 11) {
                        ctx.fillStyle = B.shade("#5a4030", (B.hash2(py, side, scene.seed) - 0.5) * 0.3);
                        ctx.fillRect(x0, py, 70, 9.5);
                    }
                    ctx.fillStyle = "rgba(0,0,0,0.45)";
                    ctx.fillRect(side === 0 ? 66 : W - 72, 0, 6, T);
                }
                const pr = scene.props;
                const pctx = pr.ctx;
                // Noren-hung shop fronts and lanterns along the eaves.
                for (let side = 0; side < 2; side++) {
                    let ly = rng() * 60;
                    while (ly < pr.h) {
                        const lx = side === 0 ? 84 : pr.w - 84;
                        const col = B.pick(rng, ["#d8402a", "#e0602e", "#c9302a", "#e8a03a"]);
                        const yy0 = ly;
                        B.wrapY(pr.h, yy0, 40, function(yy) {
                            B.paperLantern(scene, pctx, lx, yy, 1.15, col);
                        });
                        ly += 110 + rng() * 60;
                    }
                    let ny = rng() * 200;
                    while (ny < pr.h) {
                        const nx = side === 0 ? 4 : pr.w - 26;
                        const ncol = B.pick(rng, ["#28406e", "#6e2828", "#2f5a46", "#4a2f62"]);
                        const yy1 = ny;
                        B.wrapY(pr.h, yy1, 60, function(yy) {
                            for (let s = 0; s < 3; s++) {
                                pctx.fillStyle = ncol;
                                pctx.fillRect(nx, yy + s * 15, 22, 13);
                                pctx.fillStyle = "rgba(255,255,255,0.75)";
                                pctx.fillRect(nx + 9, yy + s * 15 + 4, 4, 5);
                            }
                        });
                        ny += 220 + rng() * 160;
                    }
                }
                for (let i = 0; i < 6; i++) {
                    const y2 = rng() * pr.h;
                    const x2 = rng() < 0.5 ? 104 : pr.w - 104;
                    B.wrapY(pr.h, y2, 20, function(yy) {
                        B.softShadow(pctx, x2 + 4, yy + 2, 12, 5, 0.4);
                        pctx.fillStyle = "#6a4a36";
                        pctx.fillRect(x2 - 7, yy - 10, 14, 10);
                        B.leafCluster(pctx, x2, yy - 14, 11, B.rng(i + 77), ["#2f6a3a", "#3f8048", "#24502e"], 1);
                    });
                }
                const cv = scene.canopy;
                for (let side = 0; side < 2; side++) {
                    let by = 0;
                    const blocks = [];
                    while (by < cv.h) {
                        const bh = 150 + rng() * 120;
                        blocks.push([by, Math.min(cv.h, by + bh)]);
                        by += bh + 8;
                    }
                    blocks[blocks.length - 1][1] = cv.h - 8;
                    for (let b = 0; b < blocks.length; b++) {
                        const edge = side === 0 ? 62 + rng() * 6 : cv.w - 62 - rng() * 6;
                        B.roofBlock(cv.ctx, side, blocks[b][0], blocks[b][1], edge, cv.w, { roof: B.pick(rng, ["#3a3f4c", "#33363f", "#40424a"]) }, rng);
                    }
                }
            }
        },
        maple: {
            light: { tint: "rgba(255,160,80,0.08)", dim: 0.1, vignette: "rgba(20,8,4,0.58)", shafts: "#ffe0b0" },
            streakColor: "#ffe8d0",
            particles: [
                { kind: "mapleLeaf", count: 30, size: [3.2, 5.2], vx: [4, 16], vy: [6, 14], spin: 2, colors: ["#d8402a", "#e8662e", "#f0a030", "#c22e2e", "#e88a3a"], parallax: 1.12, high: true }
            ],
            paint: function(scene, rng) {
                const B = battleBackdrop;
                const tr = scene.terrain;
                const ctx = tr.ctx;
                const T = tr.h;
                B.paintNoiseGround(tr, scene.seed, ["#2b2418", "#3a2f1d", "#4a3b22", "#5a4628", "#6a5530"], { cell: 80, accent: { color: "#3f5a2a", threshold: 0.6, amount: 0.6 } });
                const pathX = B.makeMeander(T, rng, tr.w / 2, 40, 16);
                const width = function() { return 300; };
                scene.pathX = pathX;
                scene.pathWidth = width;
                B.softBand(ctx, T, pathX, width, "#1a140c", 4, 14);
                B.fillBand(ctx, T, pathX, width, 0, "#948c7c");
                B.speckle(ctx, tr.w, T, rng, 6000, "rgba(255,255,245,0.25)", "rgba(60,50,40,0.25)", 1.3);
                // Raked gravel.
                for (let o = -140; o <= 140; o += 7) {
                    B.strokeAlong(ctx, T, function(y) { return pathX(y) + o; }, 1.4, "rgba(70,60,48,0.28)");
                    B.strokeAlong(ctx, T, function(y) { return pathX(y) + o + 1.6; }, 0.8, "rgba(255,255,240,0.18)");
                }
                const leafCols = ["#c43a26", "#e0602a", "#eaa032", "#a8281f", "#d87a30"];
                B.scatter(tr, rng, 900, 6, null, function(c, x, y, r1, r2) {
                    c.save();
                    c.translate(x, y);
                    c.rotate(r1 * BACKDROP_TAU);
                    c.globalAlpha = 0.85;
                    c.fillStyle = leafCols[Math.floor(r2 * leafCols.length)];
                    B.starPath(c, 0, 0, 3 + r2 * 2.5, 1.3 + r2, 5);
                    c.fill();
                    c.restore();
                });
                const pr = scene.props;
                for (let side = 0; side < 2; side++) {
                    for (let y = 60; y < pr.h; y += 256) {
                        const edge = side === 0 ? 168 : pr.w - 168;
                        B.stoneLantern(scene, pr.ctx, edge + (side === 0 ? -14 : 14), y, 1.05, true);
                    }
                }
                const palettes = [
                    { trunk: "#3a2418", dark: "#7a1e16", mid: "#c23a22", light: "#ee6a34", accent: ["#f6a43a", "#ffcf6a", "#a8281f"] },
                    { trunk: "#3a2418", dark: "#8a3a12", mid: "#e0702a", light: "#f6a43a", accent: ["#ffd36a", "#c23a22"] },
                    { trunk: "#3a2418", dark: "#8a5a14", mid: "#d8a030", light: "#f4cf5a", accent: ["#e0602a", "#fff0a0"] }
                ];
                const slots = B.sideSlots(pr.h, rng, 170, 90, 60, 6, pr.w);
                for (let i = 0; i < slots.length; i++) {
                    const s = slots[i];
                    B.wrapY(pr.h, s.y, 150, function(yy) {
                        B.roundTree(pr.ctx, s.x, yy, 115 + s.r * 55, palettes[Math.floor(s.r * 3)], B.rng(i * 71 + 9), scene.overhead.ctx);
                    });
                }
                B.edgeCanopy(scene, rng, {
                    spacing: 200, reach: 34, size: [44, 70],
                    draw: function(c, x, y, R, side, r) {
                        B.leafCluster(c, x, y, R, r, ["#ffb04a", "#ef6a30", "#c8341f", "#8a1f15"], 0.88);
                    }
                });
            }
        },
        paddies: {
            light: { tint: "rgba(255,240,200,0.05)", dim: 0.1, vignette: "rgba(8,14,18,0.5)", shafts: null },
            streakColor: "#f2fbff",
            particles: [
                { kind: "cloudShadow", count: 4, size: [180, 280], vx: [7, 12], colors: ["#000000"], wrapMargin: 300 },
                { kind: "glint", count: 34, size: [1, 2], colors: ["#ffffff", "#e8f6ff"], parallax: 1 },
                { kind: "dragonfly", count: 9, size: [1, 1], colors: ["#d8402a", "#e86a2a", "#3a7ad8"], parallax: 1, high: true }
            ],
            paint: function(scene, rng) {
                const B = battleBackdrop;
                const tr = scene.terrain;
                const ctx = tr.ctx;
                const W = tr.w;
                const T = tr.h;
                B.paintNoiseGround(tr, scene.seed, ["#3c4a26", "#4a5a2c", "#566a32", "#627838"], { cell: 64 });
                const pathX = B.makeMeander(T, rng, W / 2, 16, 6);
                const width = function() { return 118; };
                scene.pathX = pathX;
                scene.pathWidth = width;
                const rr = B.rng(scene.seed + 77);
                const rows = [];
                let acc = 0;
                while (acc < T) {
                    const h = 150 + rr() * 90;
                    rows.push(h);
                    acc += h;
                }
                const k = T / acc;
                let y = 0;
                for (let r = 0; r < rows.length; r++) {
                    const h = rows[r] * k;
                    for (let side = 0; side < 2; side++) {
                        const cuts = [0];
                        let cx = 0;
                        while (cx < W / 2 - 80) {
                            cx += 80 + rr() * 110;
                            cuts.push(Math.min(cx, W / 2 - 64));
                        }
                        for (let c = 0; c < cuts.length - 1; c++) {
                            const a = cuts[c];
                            const b = cuts[c + 1];
                            if (b - a < 30) {
                                continue;
                            }
                            const x0 = side === 0 ? a : W - b;
                            const x1 = side === 0 ? b : W - a;
                            B.paddyCell(ctx, x0 + 5, y + 5, x1 - x0 - 10, h - 10, rr);
                        }
                    }
                    y += h;
                }
                // Raised causeway with grassy shoulders.
                B.softBand(ctx, T, pathX, width, "#2a2a18", 4, 12);
                B.fillBand(ctx, T, pathX, width, 6, "#5c7a36");
                B.dirtPath(scene, rng, pathX, function() { return 96; }, { color: "#9a8158", edge: "#5a4a32", light: "#bea57a", stone: "#9a9284" });
                scene.pathWidth = width;
                const greens = ["#8ab454", "#a2c665", "#6e9a40"];
                B.scatter(tr, rng, 300, 10, function(x, yy) {
                    return Math.abs(Math.abs(x - pathX(yy)) - 54) > 8;
                }, function(c, x, yy, r1) {
                    B.grassTuft(c, x, yy, 5 + r1 * 4, greens[Math.floor(r1 * greens.length)], rng);
                });
                const pr = scene.props;
                for (let i = 0; i < 5; i++) {
                    const sy = (i + rng() * 0.6) * (pr.h / 5);
                    const sx = rng() < 0.5 ? 40 + rng() * 140 : pr.w - 40 - rng() * 140;
                    B.wrapY(pr.h, sy, 70, function(yy) {
                        if (i % 2 === 0) {
                            B.scarecrow(pr.ctx, sx, yy);
                        } else {
                            B.egret(pr.ctx, sx, yy);
                        }
                    });
                }
            }
        },
        lotus: {
            light: { tint: "rgba(150,90,170,0.1)", dim: 0.12, vignette: "rgba(14,6,22,0.66)", shafts: null },
            streakColor: "#f2e6ff",
            particles: [
                { kind: "firefly", count: 34, size: [0.8, 1.4], colors: ["#d8ff8a", "#fff3a0"], additive: true, high: true, parallax: 1.04 },
                { kind: "glint", count: 20, size: [1, 1.8], colors: ["#ffe6f6"], parallax: 1 }
            ],
            paint: function(scene, rng) {
                const B = battleBackdrop;
                const tr = scene.terrain;
                const ctx = tr.ctx;
                const W = tr.w;
                const T = tr.h;
                B.paintNoiseGround(tr, scene.seed, ["#132a33", "#183540", "#1e414b", "#285058", "#335e62"], { cell: 128, accent: { color: "#5a4a7a", threshold: 0.62, amount: 0.45 } });
                for (let i = 0; i < 60; i++) {
                    const y = rng() * T;
                    const x = rng() * W;
                    B.wrapY(T, y, 4, function(yy) {
                        ctx.strokeStyle = B.pick(rng, ["rgba(255,190,150,0.16)", "rgba(220,170,255,0.14)", "rgba(255,255,255,0.1)"]);
                        ctx.lineWidth = 1 + rng();
                        ctx.beginPath();
                        ctx.moveTo(x, yy);
                        ctx.lineTo(x + 20 + rng() * 50, yy);
                        ctx.stroke();
                    });
                }
                // Zigzag plank bridge (yatsuhashi).
                const seg = T / 8;
                const nodes = [];
                for (let i = 0; i <= 8; i++) {
                    nodes.push(W / 2 + (i % 2 === 0 ? -70 : 70) + (i % 8 === 0 ? 0 : (B.hash2(i % 8, 1, scene.seed) - 0.5) * 30));
                }
                const pathX = function(y) {
                    const yy = ((y % T) + T) % T;
                    const i = Math.floor(yy / seg);
                    const f = (yy - i * seg) / seg;
                    return nodes[i] + (nodes[i + 1] - nodes[i]) * f;
                };
                const width = function() { return 84; };
                scene.pathX = pathX;
                scene.pathWidth = width;
                const padCols = ["#3f7a3a", "#4f8a40", "#346a33", "#5a9448"];
                B.scatter(tr, rng, 150, 22, B.offPath(scene, 18), function(c, x, y, r1, r2) {
                    const r = 7 + r1 * 13;
                    c.fillStyle = "rgba(0,0,0,0.25)";
                    c.beginPath();
                    c.ellipse(x + 2, y + 2, r, r * 0.8, 0, 0, BACKDROP_TAU);
                    c.fill();
                    c.fillStyle = padCols[Math.floor(r2 * padCols.length)];
                    c.beginPath();
                    const notch = r2 * BACKDROP_TAU;
                    c.moveTo(x, y);
                    c.ellipse(x, y, r, r * 0.8, 0, notch + 0.25, notch + BACKDROP_TAU - 0.25);
                    c.closePath();
                    c.fill();
                    c.strokeStyle = "rgba(160,220,120,0.35)";
                    c.lineWidth = 0.8;
                    c.stroke();
                    if (r1 > 0.72) {
                        const fx = x + (r2 - 0.5) * r * 0.6;
                        const fy = y - r * 0.2;
                        for (let p = 0; p < 6; p++) {
                            const a = (p / 6) * BACKDROP_TAU + r2;
                            c.fillStyle = p % 2 === 0 ? "#f4a8c8" : "#ffd6e6";
                            c.beginPath();
                            c.ellipse(fx + Math.cos(a) * 3, fy + Math.sin(a) * 2.4, 3.2, 1.8, a, 0, BACKDROP_TAU);
                            c.fill();
                        }
                        c.fillStyle = "#ffe27a";
                        c.beginPath();
                        c.arc(fx, fy, 1.6, 0, BACKDROP_TAU);
                        c.fill();
                    }
                });
                B.softBand(ctx, T, pathX, width, "#000000", 3, 10);
                for (let y = -10; y < T + 10; y += 9) {
                    const x = pathX(y);
                    const tone = B.hash2(Math.round(((y % T) + T) % T), 5, scene.seed);
                    ctx.fillStyle = B.shade("#7a5a3e", (tone - 0.5) * 0.3);
                    ctx.fillRect(x - 42, y, 84, 7.5);
                    ctx.fillStyle = "rgba(255,230,200,0.1)";
                    ctx.fillRect(x - 42, y, 84, 1.2);
                }
                for (let i = 0; i < 8; i++) {
                    const y = i * seg;
                    B.wrapY(T, y, 10, function(yy) {
                        ctx.fillStyle = "#2a1c12";
                        ctx.fillRect(nodes[i] - 46, yy - 4, 7, 7);
                        ctx.fillRect(nodes[i] + 39, yy - 4, 7, 7);
                    });
                }
                const pr = scene.props;
                const reedCols = ["#5a7a3a", "#6e8a44", "#4a6a30"];
                const slots = B.sideSlots(pr.h, rng, 120, 60, 54, 4, pr.w);
                for (let i = 0; i < slots.length; i++) {
                    const s = slots[i];
                    B.wrapY(pr.h, s.y, 70, function(yy) {
                        const c = pr.ctx;
                        const r = B.rng(i * 19 + 2);
                        if (s.r < 0.25) {
                            B.rock(c, s.x, yy, 18, { light: "#7a7a72", mid: "#555650", dark: "#33342f" }, r);
                            B.stoneLantern(scene, c, s.x, yy - 6, 0.8, true);
                            return;
                        }
                        for (let k = 0; k < 9; k++) {
                            const bx = s.x + (r() - 0.5) * 30;
                            const h = 30 + r() * 40;
                            const lean = (s.side === 0 ? -1 : 1) * r() * 10;
                            c.strokeStyle = B.pick(r, reedCols);
                            c.lineWidth = 1.6;
                            c.beginPath();
                            c.moveTo(bx, yy);
                            c.quadraticCurveTo(bx, yy - h * 0.5, bx + lean, yy - h);
                            c.stroke();
                            if (r() < 0.4) {
                                c.fillStyle = "#5a3a22";
                                c.fillRect(bx + lean * 0.9 - 1.6, yy - h - 2, 3.2, 9);
                            }
                        }
                    });
                }
                B.edgeCanopy(scene, rng, {
                    spacing: 120, reach: 40, size: [40, 62],
                    draw: function(c, x, y, R, side, r) {
                        for (let k = 0; k < 7; k++) {
                            const hx = x + (r() - 0.5) * R * 1.2;
                            const hy = y + (r() - 0.5) * R * 0.5;
                            const len = R * (0.6 + r() * 0.7);
                            const g = c.createLinearGradient(hx, hy, hx, hy + len);
                            g.addColorStop(0, "rgba(120,80,170,0.9)");
                            g.addColorStop(0.6, "rgba(180,140,230,0.85)");
                            g.addColorStop(1, "rgba(230,210,255,0)");
                            c.fillStyle = g;
                            c.beginPath();
                            c.moveTo(hx - 6, hy);
                            c.quadraticCurveTo(hx - 7, hy + len * 0.5, hx, hy + len);
                            c.quadraticCurveTo(hx + 7, hy + len * 0.5, hx + 6, hy);
                            c.closePath();
                            c.fill();
                        }
                        B.leafCluster(c, x, y - R * 0.1, R * 0.7, r, ["#3a5a2a", "#2a4a20", "#4a6a32"], 0.9);
                    }
                });
            }
        },
        snowPass: {
            light: { tint: "rgba(120,150,210,0.1)", dim: 0.2, vignette: "rgba(10,16,32,0.6)", shafts: null },
            streakColor: "#ffffff",
            particles: [
                { kind: "snow", count: 70, size: [0.9, 1.8], vx: [-8, 4], vy: [10, 22], colors: ["#ffffff", "#eef4ff"], parallax: 1.05 },
                { kind: "snow", count: 28, size: [2.2, 3.4], vx: [-14, 4], vy: [22, 40], colors: ["#ffffff"], parallax: 1.35, high: true }
            ],
            paint: function(scene, rng) {
                const B = battleBackdrop;
                const tr = scene.terrain;
                const ctx = tr.ctx;
                const T = tr.h;
                B.paintNoiseGround(tr, scene.seed, ["#8fa2bd", "#a9bad0", "#c2cfe0", "#d6e0ec", "#e6edf6"], { cell: 128, contrast: 1.4 });
                B.speckle(ctx, tr.w, T, rng, 2500, "rgba(255,255,255,0.4)", "rgba(90,110,150,0.16)", 1.4);
                const pathX = B.makeMeander(T, rng, tr.w / 2, 90, 30);
                const width = function(y) { return 96 + 10 * Math.sin((BACKDROP_TAU * 2 * y) / T); };
                scene.pathX = pathX;
                scene.pathWidth = width;
                B.softBand(ctx, T, pathX, width, "#7d8fab", 5, 16);
                B.fillBand(ctx, T, pathX, function(y) { return width(y) * 0.8; }, 0, "rgba(150,165,190,0.6)");
                for (let y = 0; y < T; y += 15) {
                    const side = (y / 15) % 2 === 0 ? -1 : 1;
                    const x = pathX(y) + side * 8 + (B.hash2(y, 2, scene.seed) - 0.5) * 6;
                    B.wrapY(T, y, 6, function(yy) {
                        ctx.fillStyle = "rgba(80,95,130,0.4)";
                        ctx.beginPath();
                        ctx.ellipse(x, yy, 2.6, 4.2, side * 0.12, 0, BACKDROP_TAU);
                        ctx.fill();
                    });
                }
                const rockPal = { light: "#6d6f78", mid: "#4c4e57", dark: "#2c2d34", cap: "#eef3fa" };
                B.scatter(tr, rng, 40, 20, B.offPath(scene, 10), function(c, x, y, r1) {
                    B.rock(c, x, y, 5 + r1 * 8, rockPal, B.rng(Math.round(x * 7 + y)));
                });
                const pr = scene.props;
                const pinePal = { trunk: "#3a2a22", light: "#3d6050", mid: "#27453a", dark: "#142a24" };
                const slots = B.sideSlots(pr.h, rng, 140, 70, 70, 4, pr.w);
                for (let i = 0; i < slots.length; i++) {
                    const s = slots[i];
                    B.wrapY(pr.h, s.y, 170, function(yy) {
                        if (s.r < 0.8) {
                            B.pine(pr.ctx, s.x, yy, 105 + s.r * 70, pinePal, B.rng(i * 29 + 4), true, scene.overhead.ctx);
                        } else {
                            B.jizo(pr.ctx, s.x + (s.side === 0 ? 40 : -40), yy);
                        }
                    });
                }
                B.edgeCanopy(scene, rng, {
                    spacing: 240, reach: 28, size: [44, 66],
                    draw: function(c, x, y, R, side, r) {
                        B.pineBough(c, x, y, R, side, r, ["#1d3a30", "#284a3c", "#e8eef8", "#1a3228"]);
                    }
                });
            }
        },
        torii: {
            light: { tint: "rgba(40,20,90,0.2)", dim: 0.16, vignette: "rgba(6,2,14,0.75)", shafts: null },
            streakColor: "#ffd0c0",
            particles: [
                { kind: "spirit", count: 12, size: [1.6, 2.4], vx: [-3, 3], vy: [-3, 3], colors: ["#7ad0ff", "#a8e6ff", "#9a8cff"], additive: true, high: true, parallax: 1.08 },
                { kind: "ember", count: 16, size: [0.6, 1.2], vx: [-4, 4], vy: [-10, -4], life: [3, 6], colors: ["#ff7a4a"], additive: true, high: true }
            ],
            paint: function(scene, rng) {
                const B = battleBackdrop;
                const tr = scene.terrain;
                const ctx = tr.ctx;
                const W = tr.w;
                const T = tr.h;
                B.paintNoiseGround(tr, scene.seed, ["#121018", "#18151f", "#1f1b27", "#272231", "#2f2a3a"], { cell: 64, accent: { color: "#24331f", threshold: 0.6, amount: 0.6 } });
                const pathX = B.makeMeander(T, rng, W / 2, 14, 6);
                const width = function() { return 250; };
                scene.pathX = pathX;
                scene.pathWidth = width;
                B.softBand(ctx, T, pathX, width, "#08060c", 4, 14);
                B.cobbles(ctx, T, function(y) { return pathX(y) - 125; }, function(y) { return pathX(y) + 125; }, 32, "#4d4856", "#0c0a10", scene.seed + 9);
                B.speckle(ctx, W, T, rng, 3000, "rgba(200,190,255,0.07)", "rgba(0,0,0,0.3)", 1.4);
                const greens = ["#2f4a2a", "#3a5a32", "#26401f"];
                B.scatter(tr, rng, 500, 10, B.offPath(scene, 6), function(c, x, yy, r1) {
                    B.grassTuft(c, x, yy, 5 + r1 * 5, greens[Math.floor(r1 * greens.length)], rng);
                });
                const pr = scene.props;
                const pal = { red: "#d4432a" };
                const gates = 8;
                for (let g = 0; g < gates; g++) {
                    const gy = (g + 0.5) * (pr.h / gates);
                    B.wrapY(pr.h, gy, 140, function(yy) {
                        B.torii(scene, pr.ctx, 46, pr.w - 46, yy, 118, pal);
                    });
                    const sy = gy + pr.h / gates / 2;
                    B.wrapY(pr.h, sy % pr.h, 60, function(yy) {
                        B.foxStatue(pr.ctx, 92, yy, 1, false);
                        B.foxStatue(pr.ctx, pr.w - 92, yy, 1, true);
                        B.stoneLantern(scene, pr.ctx, 22, yy + 30, 0.85, true);
                        B.stoneLantern(scene, pr.ctx, pr.w - 22, yy + 30, 0.85, true);
                    });
                }
                B.edgeCanopy(scene, rng, {
                    spacing: 220, reach: 26, size: [44, 64],
                    draw: function(c, x, yy, R, side, r) {
                        B.pineBough(c, x, yy, R, side, r, ["#101a16", "#16241c", "#0c1410"]);
                    }
                });
            }
        }
    },

    // ---------------------------------------------------------------- theme-specific props

    paddyCell: function(ctx, x, y, w, h, rng) {
        ctx.fillStyle = "rgba(0,0,0,0.3)";
        ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
        const g = ctx.createLinearGradient(x, y, x, y + h);
        const grown = rng() < 0.35;
        g.addColorStop(0, grown ? "#7c9c84" : "#86b0c0");
        g.addColorStop(1, grown ? "#4d7462" : "#4f8299");
        ctx.fillStyle = g;
        ctx.fillRect(x, y, w, h);
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, w, h);
        ctx.clip();
        for (let i = 0; i < 3; i++) {
            const cx = x + rng() * w;
            const cy = y + rng() * h;
            ctx.globalAlpha = 0.35;
            ctx.drawImage(battleBackdrop.glow("#ffffff"), cx - 50, cy - 24, 100 + rng() * 60, 48);
        }
        ctx.globalAlpha = 1;
        ctx.fillStyle = "rgba(20,50,70,0.25)";
        ctx.fillRect(x, y, w, 5);
        ctx.fillRect(x, y, 4, h);
        ctx.fillStyle = grown ? "#9cc860" : "#86b858";
        for (let py = y + 8; py < y + h - 4; py += grown ? 6 : 9) {
            for (let px = x + 7; px < x + w - 4; px += 10) {
                ctx.fillRect(px + (rng() - 0.5) * 1.5, py, 1.6, 2.6);
            }
        }
        ctx.restore();
    },
    scarecrow: function(ctx, x, y) {
        battleBackdrop.softShadow(ctx, x + 12, y + 2, 16, 5, 0.35);
        ctx.strokeStyle = "#5a3e26";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y - 40);
        ctx.moveTo(x - 16, y - 30);
        ctx.lineTo(x + 16, y - 30);
        ctx.stroke();
        ctx.fillStyle = "#3a5a8a";
        ctx.fillRect(x - 9, y - 33, 18, 14);
        ctx.fillStyle = "#e8d8b0";
        ctx.beginPath();
        ctx.arc(x, y - 40, 5, 0, BACKDROP_TAU);
        ctx.fill();
        ctx.fillStyle = "#c8a85a";
        ctx.beginPath();
        ctx.ellipse(x, y - 44, 12, 4, 0, 0, BACKDROP_TAU);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(x - 6, y - 45);
        ctx.lineTo(x, y - 51);
        ctx.lineTo(x + 6, y - 45);
        ctx.fill();
    },
    egret: function(ctx, x, y) {
        battleBackdrop.softShadow(ctx, x + 6, y + 1, 8, 3, 0.3);
        ctx.strokeStyle = "#2a2a2a";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x - 1, y);
        ctx.lineTo(x - 1, y - 8);
        ctx.moveTo(x + 2, y);
        ctx.lineTo(x + 2, y - 8);
        ctx.stroke();
        ctx.fillStyle = "#f6f6f2";
        ctx.beginPath();
        ctx.ellipse(x, y - 12, 6, 4, -0.3, 0, BACKDROP_TAU);
        ctx.fill();
        ctx.strokeStyle = "#f6f6f2";
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(x - 3, y - 14);
        ctx.quadraticCurveTo(x - 6, y - 20, x - 3, y - 23);
        ctx.stroke();
        ctx.fillStyle = "#e8b83a";
        ctx.fillRect(x - 3, y - 24, 5, 1.2);
    },
    jizo: function(ctx, x, y) {
        battleBackdrop.softShadow(ctx, x + 8, y + 2, 12, 4, 0.4);
        ctx.fillStyle = "#7a7a80";
        ctx.beginPath();
        ctx.ellipse(x, y - 9, 7, 10, 0, 0, BACKDROP_TAU);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x, y - 21, 5.5, 0, BACKDROP_TAU);
        ctx.fill();
        ctx.fillStyle = "#c8302a";
        ctx.beginPath();
        ctx.moveTo(x - 6, y - 16);
        ctx.lineTo(x + 6, y - 16);
        ctx.lineTo(x, y - 8);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x, y - 23, 5.5, Math.PI, 0);
        ctx.fill();
        ctx.fillStyle = "#f2f6fc";
        ctx.beginPath();
        ctx.ellipse(x, y - 27, 6, 2.4, 0, 0, BACKDROP_TAU);
        ctx.fill();
    },
    foxStatue: function(ctx, x, y, s, flip) {
        battleBackdrop.softShadow(ctx, x + 10 * s, y + 2, 16 * s, 6 * s, 0.4);
        ctx.save();
        ctx.translate(x, y);
        if (flip) {
            ctx.scale(-1, 1);
        }
        ctx.fillStyle = "#4e4b52";
        ctx.fillRect(-11 * s, -8 * s, 22 * s, 8 * s);
        ctx.fillStyle = "#6a676e";
        ctx.fillRect(-11 * s, -8 * s, 22 * s, 2 * s);
        ctx.fillStyle = "#8a8790";
        ctx.beginPath();
        ctx.ellipse(0, -16 * s, 6 * s, 9 * s, 0.1, 0, BACKDROP_TAU);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(4 * s, -10 * s);
        ctx.quadraticCurveTo(14 * s, -14 * s, 10 * s, -26 * s);
        ctx.quadraticCurveTo(8 * s, -16 * s, 2 * s, -14 * s);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(-1 * s, -26 * s, 4.5 * s, 0, BACKDROP_TAU);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(-5 * s, -28 * s);
        ctx.lineTo(-4 * s, -35 * s);
        ctx.lineTo(-1.5 * s, -29 * s);
        ctx.moveTo(1 * s, -29 * s);
        ctx.lineTo(3 * s, -35 * s);
        ctx.lineTo(3.5 * s, -27 * s);
        ctx.fill();
        ctx.fillStyle = "#c8302a";
        ctx.beginPath();
        ctx.moveTo(-5 * s, -22 * s);
        ctx.lineTo(4 * s, -22 * s);
        ctx.lineTo(-0.5 * s, -16 * s);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }
};

// Procedural animated character sprites for the battlefield (view-only).
// Each (kind, variant) is drawn once into an offscreen sprite sheet; tokens blit their current frame into
// their own small canvas, so nothing is rasterized from vectors per frame.
// Sheet frame layout: 0-7 idle loop, 8-15 walk cycle, 16-17 attack wind-up (intruders only).
// All drawing happens in a 100x100 unit box, feet at y ~94, then gets a dark sticker outline.

const SPRITE_COSTUME_BY_MAP = {
    map_1: "kasa",
    map_2: "hachimaki",
    map_3: "towel",
    map_4: "fan",
    map_5: "bouquet",
    map_6: "glasses",
    map_7: "spyglass",
    map_8: "beret",
    map_9: "fedora",
    map_10: "pompadour"
};
const SPRITE_COSTUME_ORDER = ["kasa", "hachimaki", "towel", "fan", "bouquet", "glasses", "spyglass", "beret", "fedora", "pompadour"];
const SPRITE_TAU = Math.PI * 2;

let battleSprites = {
    FRAME: 144,
    IDLE: 0,
    WALK: 8,
    WINDUP: 16,
    VARIANTS: 3,
    sheets: {},

    // ---------------------------------------------------------------- public API

    getIntruderSheet: function(map, type, intruderId) {
        const variant = intruderId % battleSprites.VARIANTS;
        const key = `i|${map.key}|${type}|${variant}`;
        if (!battleSprites.sheets[key]) {
            const look = battleSprites.makeLook(map, type, variant);
            battleSprites.sheets[key] = battleSprites.buildSheet(18, battleSprites.FRAME, function(ctx, f) {
                battleSprites.drawIntruder(ctx, look, f);
            }, 1);
        }
        return battleSprites.sheets[key];
    },
    getForageSheet: function(type) {
        const key = `f|${type}`;
        if (!battleSprites.sheets[key]) {
            battleSprites.sheets[key] = battleSprites.buildSheet(8, battleSprites.FRAME, function(ctx, f) {
                battleSprites.drawForage(ctx, type, f);
            }, 1.2);
        }
        return battleSprites.sheets[key];
    },
    getPlayerSheet: function(tails) {
        const key = `p|${tails}`;
        if (!battleSprites.sheets[key]) {
            battleSprites.sheets[key] = battleSprites.buildSheet(16, 200, function(ctx, f) {
                battleSprites.drawFoxGirl(ctx, tails, f);
            }, 1.15);
        }
        return battleSprites.sheets[key];
    },
    /** Draws `frame` of `sheet` into a token's canvas, resizing its backing store to cssPx * dpr. */
    blit: function(el, sheet, frame, cssPx) {
        const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
        const px = Math.max(1, Math.round(cssPx * dpr));
        if (el.width !== px || el.height !== px) {
            el.width = px;
            el.height = px;
        }
        const ctx = el.getContext("2d");
        ctx.clearRect(0, 0, px, px);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(sheet.canvas, frame * sheet.frame, 0, sheet.frame, sheet.frame, 0, 0, px, px);
    },
    /** Walk frame from ground-relative distance, so feet never slide against the scrolling backdrop. */
    walkFrame: function(groundDistPx, stridePx) {
        const k = Math.floor((groundDistPx / stridePx) * 8);
        return battleSprites.WALK + (((k % 8) + 8) % 8);
    },
    idleFrame: function(nowMs, seed, fps) {
        return battleSprites.IDLE + (Math.floor((nowMs / 1000) * fps + seed * 0.37) % 8);
    },

    // ---------------------------------------------------------------- sheet building

    buildSheet: function(frames, F, draw, shadowScale) {
        const sheet = document.createElement("canvas");
        sheet.width = F * frames;
        sheet.height = F;
        const sctx = sheet.getContext("2d");
        const art = document.createElement("canvas");
        art.width = F;
        art.height = F;
        const actx = art.getContext("2d");
        const line = document.createElement("canvas");
        line.width = F;
        line.height = F;
        const lctx = line.getContext("2d");
        const o = Math.max(1.5, F / 70);
        for (let f = 0; f < frames; f++) {
            actx.setTransform(1, 0, 0, 1, 0, 0);
            actx.clearRect(0, 0, F, F);
            actx.setTransform(F / 100, 0, 0, F / 100, 0, 0);
            actx.lineJoin = "round";
            actx.lineCap = "round";
            draw(actx, f);
            lctx.globalCompositeOperation = "source-over";
            lctx.clearRect(0, 0, F, F);
            for (let d = 0; d < 12; d++) {
                const a = (d / 12) * SPRITE_TAU;
                lctx.drawImage(art, Math.cos(a) * o, Math.sin(a) * o);
            }
            lctx.globalCompositeOperation = "source-in";
            lctx.fillStyle = "#140c18";
            lctx.fillRect(0, 0, F, F);
            const x0 = f * F;
            const sg = sctx.createRadialGradient(x0 + F / 2, F * 0.94, 0, x0 + F / 2, F * 0.94, F * 0.22 * shadowScale);
            sg.addColorStop(0, "rgba(0,0,0,0.5)");
            sg.addColorStop(1, "rgba(0,0,0,0)");
            sctx.save();
            sctx.translate(0, F * 0.94);
            sctx.scale(1, 0.32);
            sctx.translate(0, -F * 0.94);
            sctx.fillStyle = sg;
            sctx.fillRect(x0, F * 0.94 - F * 0.25 * shadowScale, F, F * 0.5 * shadowScale);
            sctx.restore();
            sctx.drawImage(line, x0, 0);
            sctx.drawImage(art, x0, 0);
        }
        return { canvas: sheet, frame: F, frames: frames };
    },

    // ---------------------------------------------------------------- color / shape helpers

    shade: function(hex, amt) {
        return battleBackdrop.shade(hex, amt);
    },
    ell: function(ctx, x, y, rx, ry, rot) {
        ctx.beginPath();
        ctx.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), rot || 0, 0, SPRITE_TAU);
    },
    fillEll: function(ctx, color, x, y, rx, ry, rot) {
        battleSprites.ell(ctx, x, y, rx, ry, rot);
        ctx.fillStyle = color;
        ctx.fill();
    },
    poly: function(ctx, pts) {
        ctx.beginPath();
        ctx.moveTo(pts[0], pts[1]);
        for (let i = 2; i < pts.length; i += 2) {
            ctx.lineTo(pts[i], pts[i + 1]);
        }
        ctx.closePath();
    },
    hgrad: function(ctx, x0, x1, c0, c1) {
        const g = ctx.createLinearGradient(x0, 0, x1, 0);
        g.addColorStop(0, c0);
        g.addColorStop(1, c1);
        return g;
    },
    vgrad: function(ctx, y0, y1, c0, c1) {
        const g = ctx.createLinearGradient(0, y0, 0, y1);
        g.addColorStop(0, c0);
        g.addColorStop(1, c1);
        return g;
    },
    roundRect: function(ctx, x, y, w, h, r) {
        const rr = Math.min(r, w / 2, h / 2);
        ctx.beginPath();
        ctx.moveTo(x + rr, y);
        ctx.lineTo(x + w - rr, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
        ctx.lineTo(x + w, y + h - rr);
        ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
        ctx.lineTo(x + rr, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
        ctx.lineTo(x, y + rr);
        ctx.quadraticCurveTo(x, y, x + rr, y);
        ctx.closePath();
    },
    sparkle: function(ctx, x, y, s, color) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(x, y - s);
        ctx.quadraticCurveTo(x, y, x + s, y);
        ctx.quadraticCurveTo(x, y, x, y + s);
        ctx.quadraticCurveTo(x, y, x - s, y);
        ctx.quadraticCurveTo(x, y, x, y - s);
        ctx.fill();
    },

    // ---------------------------------------------------------------- intruders

    makeLook: function(map, type, variant) {
        const rng = battleBackdrop.rng(((map.seed >>> 0) * 31 + (type === "lecher" ? 7001 : 3001) + variant * 977) >>> 0);
        const pick = function(list) {
            return list[Math.floor(rng() * list.length)];
        };
        const lecher = type === "lecher";
        const costume = SPRITE_COSTUME_BY_MAP[map.key] || SPRITE_COSTUME_ORDER[(map.seed >>> 0) % SPRITE_COSTUME_ORDER.length];
        const skins = ["#f4d6b6", "#eac29c", "#d8a77e", "#c38c64", "#f7e0c8"];
        const hairs = ["#241914", "#3a281e", "#17141c", "#5a3a24", "#2c2430"];
        const cloth = lecher
            ? ["#2f62ad", "#3a7cc4", "#245290", "#2b7ea0", "#3d5fb8"]
            : ["#6f2fa6", "#8a3fbc", "#5c2a90", "#a2449c", "#7a3496"];
        let hairStyle = Math.floor(rng() * 3);
        if (lecher && variant === 2) {
            hairStyle = 3;
        }
        return {
            type: type,
            lecher: lecher,
            costume: costume,
            skin: skins[(variant * 2 + Math.floor(rng() * 2)) % skins.length],
            hair: hairStyle === 3 ? "#8a8690" : pick(hairs),
            hairStyle: hairStyle,
            cloth: cloth[(variant + Math.floor(rng() * 2) * 3) % cloth.length],
            obi: pick(["#e8c25a", "#d8402a", "#f2efe6", "#2a2230", "#3aa07a"]),
            pants: pick(["#2a2434", "#3a3040", "#2a3040", "#40302a"]),
            pattern: Math.floor(rng() * 3),
            accent: pick(["#e8486a", "#f0a030", "#5ac8a8", "#f2efe6"])
        };
    },
    drawIntruder: function(ctx, L, f) {
        const S = battleSprites;
        // Slightly stockier than the unit box so they fill their lane.
        ctx.translate(50, 0);
        ctx.scale(1.12, 1);
        ctx.translate(-50, 0);
        const mode = f < 8 ? "idle" : (f < 16 ? "walk" : "windup");
        const k = f % 8;
        const p = (k / 8) * SPRITE_TAU;
        let bob = 0;
        let lStep = 0;
        let rStep = 0;
        let swing = 0;
        let breathe = 0;
        if (mode === "walk") {
            bob = -Math.abs(Math.sin(p)) * 2.6;
            lStep = Math.max(0, Math.sin(p)) * 4.5;
            rStep = Math.max(0, -Math.sin(p)) * 4.5;
            swing = Math.sin(p);
        } else if (mode === "idle") {
            breathe = Math.sin(p);
        } else {
            bob = -1.5;
        }
        const hunch = L.lecher ? 3 : 0;
        const bodyTop = 53 + bob + hunch * 0.6 + breathe * 0.4;
        const headY = 34 + bob + hunch + breathe * 0.7;
        // Legs and sandals.
        S.drawLeg(ctx, 44, 80 + bob * 0.4, 92 - lStep, L);
        S.drawLeg(ctx, 56, 80 + bob * 0.4, 92 - rStep, L);
        // Arms behind the body when walking; the near arm comes later.
        const arms = S.intruderArms(L, mode, k, swing, bodyTop, headY);
        S.drawSleeve(ctx, arms.left, L);
        if (!arms.right.front) {
            S.drawSleeve(ctx, arms.right, L);
        }
        S.drawKimono(ctx, L, bodyTop);
        S.drawHead(ctx, L, headY, mode, k);
        S.drawHeldItem(ctx, L, mode, k, arms, bodyTop, headY);
        if (arms.right.front) {
            S.drawSleeve(ctx, arms.right, L);
        }
        S.drawHeadwear(ctx, L, headY, mode, k);
        if (mode === "windup" && !L.lecher) {
            S.sparkle(ctx, 66, headY - 8 - k * 2, 3.5 + k, "#fff3a0");
            S.sparkle(ctx, 72, headY - 1, 2.2, "#ffd0f0");
        }
    },
    drawLeg: function(ctx, x, top, footY, L) {
        const S = battleSprites;
        ctx.fillStyle = S.hgrad(ctx, x - 5, x + 5, S.shade(L.pants, 0.12), S.shade(L.pants, -0.2));
        S.roundRect(ctx, x - 4.6, top, 9.2, footY - top, 3);
        ctx.fill();
        S.fillEll(ctx, "#5a3a24", x, footY + 0.6, 5.4, 2.4);
        S.fillEll(ctx, "#f4f0ea", x, footY - 1, 3.8, 2.2);
    },
    intruderArms: function(L, mode, k, swing, bodyTop, headY) {
        // Each arm: shoulder pivot, angle (0 = hanging down, + = outward), sleeve length, and whether drawn in front.
        const left = { x: 37, y: bodyTop + 4, a: 0.32 - swing * 0.35, len: 18, side: -1, front: false };
        const right = { x: 63, y: bodyTop + 4, a: 0.32 + swing * 0.35, len: 18, side: 1, front: false };
        if (mode === "idle") {
            if (L.lecher) {
                // Hand-wringing in front of the chest.
                const rub = Math.sin((k / 8) * SPRITE_TAU * 2) * 0.12;
                left.a = -0.75 + rub;
                right.a = -0.75 - rub;
                left.len = 15;
                right.len = 15;
                left.front = true;
                right.front = true;
            } else {
                left.a = 0.28;
                right.a = 0.28 + Math.sin((k / 8) * SPRITE_TAU) * 0.08;
            }
        } else if (mode === "windup") {
            if (L.lecher) {
                right.a = 2.7 + k * 0.25;
                right.len = 17;
                left.a = 0.5;
            } else {
                right.a = 2.45 - k * 0.15;
                right.len = 15;
                right.front = true;
                left.a = 0.25;
            }
        }
        return { left: left, right: right };
    },
    sleeveHand: function(arm) {
        const dx = Math.sin(arm.a) * arm.side;
        const dy = Math.cos(arm.a);
        return [arm.x + dx * arm.len, arm.y + dy * arm.len];
    },
    drawSleeve: function(ctx, arm, L) {
        const S = battleSprites;
        const hand = S.sleeveHand(arm);
        ctx.save();
        ctx.translate(arm.x, arm.y);
        ctx.rotate(-arm.a * arm.side);
        ctx.fillStyle = S.hgrad(ctx, -6, 6, S.shade(L.cloth, 0.08), S.shade(L.cloth, -0.3));
        S.roundRect(ctx, -5.5, -2, 11, arm.len - 1, 4);
        ctx.fill();
        ctx.fillStyle = S.shade(L.cloth, -0.4);
        ctx.fillRect(-5.5, arm.len - 5, 11, 2);
        ctx.restore();
        S.fillEll(ctx, L.skin, hand[0], hand[1], 3.4, 3.4);
    },
    drawKimono: function(ctx, L, top) {
        const S = battleSprites;
        S.poly(ctx, [44, top, 56, top, 64, top + 4, 67, 84, 33, 84, 36, top + 4]);
        ctx.fillStyle = S.hgrad(ctx, 33, 67, S.shade(L.cloth, 0.18), S.shade(L.cloth, -0.28));
        ctx.fill();
        ctx.save();
        ctx.clip();
        if (L.pattern === 1) {
            ctx.strokeStyle = S.shade(L.cloth, 0.3);
            ctx.lineWidth = 1.2;
            for (let x = 30; x < 70; x += 5) {
                ctx.beginPath();
                ctx.moveTo(x, top);
                ctx.lineTo(x + 2, 86);
                ctx.stroke();
            }
        } else if (L.pattern === 2) {
            ctx.fillStyle = S.shade(L.cloth, 0.35);
            for (let y = top + 3; y < 86; y += 6) {
                for (let x = 34 + ((y / 6) % 2) * 3; x < 68; x += 6) {
                    S.ell(ctx, x, y, 1, 1);
                    ctx.fill();
                }
            }
        }
        ctx.fillStyle = "rgba(0,0,0,0.18)";
        ctx.fillRect(49.2, top + 10, 1.6, 80);
        ctx.restore();
        // Collar.
        S.poly(ctx, [44, top - 0.5, 50, top + 9, 56, top - 0.5]);
        ctx.fillStyle = L.skin;
        ctx.fill();
        ctx.strokeStyle = "#f4f0ea";
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.moveTo(43.5, top);
        ctx.lineTo(50, top + 10);
        ctx.lineTo(56.5, top);
        ctx.stroke();
        // Obi.
        ctx.fillStyle = S.vgrad(ctx, top + 15, top + 21, S.shade(L.obi, 0.1), S.shade(L.obi, -0.25));
        ctx.fillRect(34.6, top + 15, 30.8, 6);
        ctx.fillStyle = S.shade(L.obi, -0.35);
        ctx.fillRect(48, top + 15, 4, 6);
    },
    drawHead: function(ctx, L, y, mode, k) {
        const S = battleSprites;
        // Ears.
        S.fillEll(ctx, L.skin, 31.5, y + 2, 3.4, 4.6);
        S.fillEll(ctx, L.skin, 68.5, y + 2, 3.4, 4.6);
        S.fillEll(ctx, S.shade(L.skin, -0.18), 31.8, y + 2.4, 1.6, 2.6);
        S.fillEll(ctx, S.shade(L.skin, -0.18), 68.2, y + 2.4, 1.6, 2.6);
        // Face.
        S.ell(ctx, 50, y, 18.5, 17.5);
        const g = ctx.createRadialGradient(46, y - 5, 2, 50, y, 19);
        g.addColorStop(0, S.shade(L.skin, 0.12));
        g.addColorStop(0.75, L.skin);
        g.addColorStop(1, S.shade(L.skin, -0.16));
        ctx.fillStyle = g;
        ctx.fill();
        S.drawHair(ctx, L, y);
        S.drawFace(ctx, L, y, mode, k);
    },
    drawHair: function(ctx, L, y) {
        const S = battleSprites;
        const hair = L.hair;
        const g = S.vgrad(ctx, y - 20, y, S.shade(hair, 0.18), S.shade(hair, -0.15));
        ctx.fillStyle = g;
        if (L.costume === "pompadour") {
            ctx.beginPath();
            ctx.moveTo(31, y + 2);
            ctx.quadraticCurveTo(30, y - 14, 42, y - 18);
            ctx.quadraticCurveTo(52, y - 30, 66, y - 24);
            ctx.quadraticCurveTo(72, y - 20, 64, y - 15);
            ctx.quadraticCurveTo(70, y - 8, 69, y + 2);
            ctx.quadraticCurveTo(66, y - 8, 56, y - 10);
            ctx.quadraticCurveTo(44, y - 10, 34, y - 4);
            ctx.closePath();
            ctx.fill();
            ctx.strokeStyle = "rgba(255,255,255,0.35)";
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.moveTo(44, y - 19);
            ctx.quadraticCurveTo(54, y - 27, 64, y - 23);
            ctx.stroke();
            return;
        }
        if (L.hairStyle === 0) {
            // Chonmage: shaved pate, side hair, topknot.
            S.fillEll(ctx, S.shade(L.skin, -0.06), 50, y - 9, 15, 8.5);
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.moveTo(31, y + 4);
            ctx.quadraticCurveTo(30, y - 10, 38, y - 13);
            ctx.lineTo(37, y - 3);
            ctx.closePath();
            ctx.fill();
            ctx.beginPath();
            ctx.moveTo(69, y + 4);
            ctx.quadraticCurveTo(70, y - 10, 62, y - 13);
            ctx.lineTo(63, y - 3);
            ctx.closePath();
            ctx.fill();
            S.roundRect(ctx, 46, y - 23, 8, 7, 2.5);
            ctx.fill();
            ctx.fillStyle = "#f4f0ea";
            ctx.fillRect(46.5, y - 18.5, 7, 1.6);
        } else if (L.hairStyle === 1) {
            // Spiky.
            const pts = [30.5, y + 2];
            const spikes = 7;
            for (let i = 0; i <= spikes; i++) {
                const t = i / spikes;
                const x = 31 + t * 38;
                const top = y - 17 - Math.sin(t * Math.PI) * 6;
                pts.push(x - 2.7, top + 5, x, top - (i % 2 === 0 ? 4 : 2));
            }
            pts.push(69.5, y + 2, 64, y - 6, 58, y - 8.5, 54, y - 5, 49, y - 9, 44, y - 5.5, 39, y - 8, 35, y - 4);
            S.poly(ctx, pts);
            ctx.fill();
        } else if (L.hairStyle === 2) {
            // Slicked with a side-swept fringe.
            ctx.beginPath();
            ctx.moveTo(31, y + 2);
            ctx.quadraticCurveTo(29, y - 18, 50, y - 19);
            ctx.quadraticCurveTo(71, y - 18, 69, y + 2);
            ctx.quadraticCurveTo(66, y - 8, 60, y - 9);
            ctx.quadraticCurveTo(48, y - 10, 38, y - 2);
            ctx.quadraticCurveTo(36, y - 7, 33, y - 3);
            ctx.closePath();
            ctx.fill();
            ctx.strokeStyle = "rgba(255,255,255,0.3)";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(40, y - 14);
            ctx.quadraticCurveTo(50, y - 18, 60, y - 14);
            ctx.stroke();
        } else {
            // Balding with fluffy side tufts.
            ctx.fillStyle = "rgba(255,255,255,0.45)";
            S.ell(ctx, 45, y - 11, 5, 2.4, -0.3);
            ctx.fill();
            ctx.fillStyle = g;
            for (let s = -1; s <= 1; s += 2) {
                for (let i = 0; i < 3; i++) {
                    S.ell(ctx, 50 + s * (17 - i * 0.6), y - 4 + i * 3.2, 3.2, 2.8);
                    ctx.fill();
                }
            }
        }
    },
    drawFace: function(ctx, L, y, mode, k) {
        const S = battleSprites;
        const ink = "#2a1418";
        const blinkIdle = mode === "idle" && k === 5;
        ctx.strokeStyle = ink;
        ctx.fillStyle = ink;
        if (!L.lecher) {
            // Scoundrel: cocky brow, one eye winking, smirk.
            if (blinkIdle) {
                ctx.lineWidth = 1.6;
                ctx.beginPath();
                ctx.moveTo(40.5, y + 1);
                ctx.lineTo(46, y + 1);
                ctx.stroke();
            } else {
                S.fillEll(ctx, ink, 43.5, y + 0.8, 2.3, 3.1);
                S.fillEll(ctx, "#ffffff", 42.8, y - 0.4, 0.9, 1);
            }
            ctx.lineWidth = 1.8;
            ctx.beginPath();
            ctx.moveTo(53.5, y + 1.6);
            ctx.quadraticCurveTo(56.5, y - 2.4, 59.5, y + 1.6);
            ctx.stroke();
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.moveTo(40, y - 5.5 - (mode === "windup" ? 1.5 : 0));
            ctx.quadraticCurveTo(43.5, y - 8.5 - (mode === "windup" ? 1.5 : 0), 47, y - 6);
            ctx.moveTo(53.5, y - 4.5);
            ctx.lineTo(59.5, y - 3.8);
            ctx.stroke();
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.moveTo(44.5, y + 9.5);
            ctx.quadraticCurveTo(51, y + 11.5, 56.5, y + 7);
            ctx.stroke();
            S.poly(ctx, [53, y + 9.3, 55.5, y + 8, 54.6, y + 10.3]);
            ctx.fillStyle = "#ffffff";
            ctx.fill();
        } else {
            // Lecher: half-lidded leer, raised brows, big grin, blush and drool.
            const wide = mode === "windup" ? 1.25 : 1;
            for (let s = -1; s <= 1; s += 2) {
                const ex = 50 + s * 6.8;
                S.fillEll(ctx, "#ffffff", ex, y + 1, 3.6 * wide, 2.9 * wide);
                S.fillEll(ctx, ink, ex + s * 0.3, y + 1.9, 1.5, 1.6);
                ctx.lineWidth = 1.7;
                ctx.beginPath();
                ctx.moveTo(ex - 4, y + 0.2);
                ctx.quadraticCurveTo(ex, y - 2.4 * wide, ex + 4, y + 0.2);
                ctx.stroke();
                ctx.lineWidth = 1.3;
                ctx.beginPath();
                ctx.moveTo(ex - 3.5, y - 6.5);
                ctx.quadraticCurveTo(ex, y - 9.5, ex + 3.5, y - 6.8);
                ctx.stroke();
                ctx.strokeStyle = "rgba(240,90,120,0.75)";
                ctx.lineWidth = 1;
                for (let b = 0; b < 3; b++) {
                    ctx.beginPath();
                    ctx.moveTo(ex - 2.5 + b * 2, y + 6);
                    ctx.lineTo(ex - 3.5 + b * 2, y + 8);
                    ctx.stroke();
                }
                ctx.strokeStyle = ink;
            }
            ctx.beginPath();
            ctx.moveTo(42.5, y + 8.5);
            ctx.quadraticCurveTo(50, y + 10, 57.5, y + 8.5);
            ctx.quadraticCurveTo(56, y + 15.5, 50, y + 15.5);
            ctx.quadraticCurveTo(44, y + 15.5, 42.5, y + 8.5);
            ctx.closePath();
            ctx.fillStyle = "#6a1a24";
            ctx.fill();
            ctx.save();
            ctx.clip();
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(42, y + 8, 16, 2.4);
            S.fillEll(ctx, "#f07a8a", 51, y + 15.5, 4, 3);
            ctx.restore();
            if (mode !== "windup") {
                const drip = (k % 4) * 0.9;
                ctx.fillStyle = "#bfe6ff";
                S.ell(ctx, 57.2, y + 12 + drip, 1.1, 1.5 + drip * 0.4);
                ctx.fill();
            }
            S.fillEll(ctx, "#bfe6ff", 66.5, y - 7, 1.4, 2.2);
        }
        if (L.costume === "glasses") {
            ctx.strokeStyle = "#3a2a1a";
            ctx.lineWidth = 1.3;
            S.ell(ctx, 43.5, y + 1, 4.6, 4.2);
            ctx.stroke();
            S.ell(ctx, 56.5, y + 1, 4.6, 4.2);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(48, y + 0.5);
            ctx.lineTo(52, y + 0.5);
            ctx.stroke();
            ctx.strokeStyle = "rgba(255,255,255,0.7)";
            ctx.beginPath();
            ctx.moveTo(40.5, y - 1);
            ctx.lineTo(42, y - 2.4);
            ctx.stroke();
        }
        if (L.costume === "fedora") {
            ctx.fillStyle = L.hairStyle === 3 ? "#5a5660" : L.hair;
            ctx.beginPath();
            ctx.moveTo(50, y + 5.6);
            ctx.quadraticCurveTo(44, y + 4.5, 41, y + 8.5);
            ctx.quadraticCurveTo(45, y + 6.8, 50, y + 7.4);
            ctx.quadraticCurveTo(55, y + 6.8, 59, y + 8.5);
            ctx.quadraticCurveTo(56, y + 4.5, 50, y + 5.6);
            ctx.fill();
        }
        if (L.costume === "towel") {
            ctx.fillStyle = "rgba(255,120,140,0.35)";
            S.ell(ctx, 40, y + 6, 4, 2.4);
            ctx.fill();
            S.ell(ctx, 60, y + 6, 4, 2.4);
            ctx.fill();
        }
    },
    drawHeadwear: function(ctx, L, y, mode, k) {
        const S = battleSprites;
        const c = L.costume;
        if (c === "kasa") {
            S.fillEll(ctx, "rgba(0,0,0,0.2)", 50, y - 9, 22, 6);
            ctx.beginPath();
            ctx.moveTo(25, y - 10);
            ctx.quadraticCurveTo(50, y - 34, 75, y - 10);
            ctx.quadraticCurveTo(50, y - 5, 25, y - 10);
            ctx.closePath();
            ctx.fillStyle = S.vgrad(ctx, y - 28, y - 8, "#e8cf8a", "#a8884a");
            ctx.fill();
            ctx.strokeStyle = "rgba(90,60,20,0.5)";
            ctx.lineWidth = 0.8;
            for (let i = -3; i <= 3; i++) {
                ctx.beginPath();
                ctx.moveTo(50, y - 22);
                ctx.lineTo(50 + i * 7.5, y - 8.5);
                ctx.stroke();
            }
        } else if (c === "hachimaki") {
            ctx.fillStyle = "#f4f0ea";
            ctx.beginPath();
            ctx.moveTo(31.5, y - 6);
            ctx.quadraticCurveTo(50, y - 11, 68.5, y - 6);
            ctx.lineTo(68.5, y - 2);
            ctx.quadraticCurveTo(50, y - 7, 31.5, y - 2);
            ctx.closePath();
            ctx.fill();
            S.fillEll(ctx, "#d8302a", 50, y - 6.4, 2.4, 2);
            ctx.strokeStyle = "#f4f0ea";
            ctx.lineWidth = 2;
            const flutter = mode === "walk" ? Math.sin((k / 8) * SPRITE_TAU) * 2 : 0;
            ctx.beginPath();
            ctx.moveTo(68, y - 4);
            ctx.quadraticCurveTo(74, y - 6 + flutter, 78, y - 2 + flutter);
            ctx.moveTo(68, y - 4);
            ctx.quadraticCurveTo(73, y - 1 - flutter, 76, y + 3 - flutter);
            ctx.stroke();
        } else if (c === "towel") {
            S.roundRect(ctx, 37, y - 24, 26, 8, 3);
            ctx.fillStyle = "#f6f6f2";
            ctx.fill();
            ctx.fillStyle = "#5a8ad8";
            ctx.fillRect(37.5, y - 21.5, 25, 1.4);
            ctx.fillRect(37.5, y - 18.8, 25, 1.4);
        } else if (c === "beret") {
            ctx.beginPath();
            ctx.ellipse(47, y - 15, 17, 7, -0.25, 0, SPRITE_TAU);
            ctx.fillStyle = S.vgrad(ctx, y - 22, y - 9, "#c8384a", "#7a1a2a");
            ctx.fill();
            S.fillEll(ctx, "#7a1a2a", 45, y - 22, 1.6, 2.2);
        } else if (c === "fedora") {
            const lift = mode === "windup" ? 3 + k * 2 : 0;
            ctx.save();
            ctx.translate(0, -lift);
            if (lift) {
                ctx.translate(62, y - 14);
                ctx.rotate(0.35);
                ctx.translate(-62, -(y - 14));
            }
            S.fillEll(ctx, "#3a3036", 50, y - 12, 23, 5.5);
            ctx.beginPath();
            ctx.moveTo(37, y - 12);
            ctx.quadraticCurveTo(36, y - 28, 50, y - 26);
            ctx.quadraticCurveTo(64, y - 28, 63, y - 12);
            ctx.closePath();
            ctx.fillStyle = S.hgrad(ctx, 37, 63, "#5a4a52", "#2e262c");
            ctx.fill();
            ctx.fillStyle = "#1a1418";
            ctx.fillRect(37, y - 17, 26, 3.5);
            ctx.strokeStyle = "rgba(0,0,0,0.4)";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(50, y - 26);
            ctx.lineTo(50, y - 19);
            ctx.stroke();
            ctx.restore();
        }
    },
    drawHeldItem: function(ctx, L, mode, k, arms, bodyTop, headY) {
        const S = battleSprites;
        const c = L.costume;
        const lh = S.sleeveHand(arms.left);
        const rh = S.sleeveHand(arms.right);
        if (L.lecher && mode === "windup") {
            // Sandal about to be thrown.
            ctx.save();
            ctx.translate(rh[0], rh[1] - 3);
            ctx.rotate(-0.6 - k * 0.4);
            S.roundRect(ctx, -3.5, -9, 7, 16, 3.2);
            ctx.fillStyle = "#8a5a32";
            ctx.fill();
            ctx.strokeStyle = "#d8302a";
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(-3, -4);
            ctx.lineTo(0, -1);
            ctx.lineTo(3, -4);
            ctx.stroke();
            ctx.restore();
            return;
        }
        if (c === "fan") {
            ctx.save();
            ctx.translate(lh[0], lh[1]);
            const flap = Math.sin((k / 8) * SPRITE_TAU) * 0.25;
            ctx.rotate(-0.6 + flap);
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.arc(0, 0, 12, -Math.PI * 0.85, -Math.PI * 0.15);
            ctx.closePath();
            ctx.fillStyle = S.vgrad(ctx, -12, 0, "#f8e6c8", L.accent);
            ctx.fill();
            ctx.strokeStyle = "rgba(90,40,20,0.5)";
            ctx.lineWidth = 0.6;
            for (let i = 0; i < 7; i++) {
                const a = -Math.PI * 0.85 + (i / 6) * Math.PI * 0.7;
                ctx.beginPath();
                ctx.moveTo(0, 0);
                ctx.lineTo(Math.cos(a) * 12, Math.sin(a) * 12);
                ctx.stroke();
            }
            ctx.restore();
        } else if (c === "bouquet") {
            const bx = L.lecher ? (lh[0] + rh[0]) / 2 : lh[0] + 2;
            const by = L.lecher ? (lh[1] + rh[1]) / 2 - 2 : lh[1] - 3;
            S.poly(ctx, [bx - 4, by + 7, bx + 4, by + 7, bx + 6, by - 3, bx - 6, by - 3]);
            ctx.fillStyle = "#f4ead8";
            ctx.fill();
            const cols = ["#e8486a", "#f6c23a", "#f2f2f2", "#d84aa0", "#ff8a5a"];
            for (let i = 0; i < 6; i++) {
                const a = (i / 6) * SPRITE_TAU;
                S.fillEll(ctx, cols[i % cols.length], bx + Math.cos(a) * 4, by - 5 + Math.sin(a) * 2.6, 2.4, 2.4);
            }
            S.fillEll(ctx, "#5aa04a", bx - 6, by - 3, 2, 1.2, 0.5);
        } else if (c === "glasses") {
            ctx.save();
            ctx.translate(lh[0], lh[1]);
            ctx.rotate(0.9);
            ctx.fillStyle = "#f2e8d2";
            ctx.fillRect(-2.5, -9, 5, 14);
            ctx.fillStyle = "#8a5a2a";
            ctx.fillRect(-3.2, -10, 6.4, 2);
            ctx.fillRect(-3.2, 4, 6.4, 2);
            ctx.restore();
        } else if (c === "spyglass") {
            ctx.save();
            const up = mode === "windup" || (mode === "idle" && k >= 4);
            ctx.translate(lh[0], lh[1]);
            ctx.rotate(up ? -2.2 : -0.4);
            ctx.fillStyle = S.hgrad(ctx, -2, 2, "#e8c25a", "#8a6a2a");
            ctx.fillRect(-2, -14, 4, 14);
            ctx.fillStyle = "#3a2a1a";
            ctx.fillRect(-2.6, -15, 5.2, 2.4);
            ctx.restore();
        } else if (c === "beret") {
            ctx.save();
            ctx.translate(lh[0] + 1, lh[1] - 4);
            ctx.rotate(-0.25);
            ctx.fillStyle = "#c89a5a";
            ctx.fillRect(-8, -9, 15, 18);
            ctx.fillStyle = "#f8f4ea";
            ctx.fillRect(-6.5, -7.5, 12, 15);
            ctx.strokeStyle = "#5a4a5a";
            ctx.lineWidth = 0.8;
            ctx.beginPath();
            ctx.ellipse(-0.5, -1.5, 3.2, 4, 0, 0, SPRITE_TAU);
            ctx.moveTo(-3, 4);
            ctx.quadraticCurveTo(-0.5, 6, 2.5, 3.5);
            ctx.stroke();
            ctx.restore();
        } else if (c === "pompadour" && mode === "windup") {
            ctx.save();
            ctx.translate(rh[0], rh[1]);
            ctx.rotate(-0.4);
            S.poly(ctx, [0, -2, 9, -6, 9, 6, 0, 2]);
            ctx.fillStyle = "#f2e8d2";
            ctx.fill();
            ctx.restore();
            ctx.strokeStyle = "rgba(255,240,180,0.9)";
            ctx.lineWidth = 1.2;
            for (let i = -1; i <= 1; i++) {
                ctx.beginPath();
                ctx.moveTo(rh[0] + 12, rh[1] - 4 + i * 4);
                ctx.lineTo(rh[0] + 17, rh[1] - 6 + i * 6);
                ctx.stroke();
            }
        }
    },

    // ---------------------------------------------------------------- forage units

    drawForage: function(ctx, type, f) {
        const S = battleSprites;
        const p = (f / 8) * SPRITE_TAU;
        if (type === "tree") {
            const sway = Math.sin(p) * 1.6;
            ctx.fillStyle = S.hgrad(ctx, 45, 55, "#8a5a3a", "#4a2e1e");
            S.poly(ctx, [45, 94, 55, 94, 53.5, 58, 46.5, 58]);
            ctx.fill();
            const blobs = [[50, 40, 20], [36, 50, 13], [64, 50, 13], [42, 30, 12], [58, 30, 12], [50, 22, 11]];
            for (let i = 0; i < blobs.length; i++) {
                const b = blobs[i];
                S.fillEll(ctx, "#2f6a2e", b[0] + sway * (1 - b[1] / 70) + 1.5, b[1] + 2, b[2], b[2] * 0.92);
            }
            for (let i = 0; i < blobs.length; i++) {
                const b = blobs[i];
                S.fillEll(ctx, "#4a9440", b[0] + sway * (1 - b[1] / 70), b[1], b[2] * 0.92, b[2] * 0.85);
            }
            for (let i = 0; i < blobs.length; i++) {
                const b = blobs[i];
                S.fillEll(ctx, "#7cc25a", b[0] + sway * (1 - b[1] / 70) - b[2] * 0.3, b[1] - b[2] * 0.35, b[2] * 0.42, b[2] * 0.36);
            }
        } else if (type === "bush") {
            const sway = Math.sin(p) * 0.8;
            const blobs = [[50, 70, 18], [34, 78, 13], [66, 78, 13], [42, 62, 12], [58, 62, 12], [50, 84, 14]];
            for (let i = 0; i < blobs.length; i++) {
                const b = blobs[i];
                S.fillEll(ctx, "#2a5a2a", b[0] + sway + 1, b[1] + 2, b[2], b[2] * 0.85);
            }
            for (let i = 0; i < blobs.length; i++) {
                const b = blobs[i];
                S.fillEll(ctx, "#3f8a3c", b[0] + sway, b[1], b[2] * 0.9, b[2] * 0.78);
                S.fillEll(ctx, "#6ab854", b[0] + sway - b[2] * 0.3, b[1] - b[2] * 0.3, b[2] * 0.38, b[2] * 0.3);
            }
            const berries = [[40, 68], [56, 64], [62, 78], [46, 82], [52, 74], [34, 78], [66, 70]];
            for (let i = 0; i < berries.length; i++) {
                S.fillEll(ctx, "#c8283a", berries[i][0] + sway, berries[i][1], 2.6, 2.6);
                S.fillEll(ctx, "#ffb0b8", berries[i][0] + sway - 0.8, berries[i][1] - 0.8, 0.8, 0.8);
            }
        } else {
            ctx.beginPath();
            ctx.moveTo(22, 92);
            ctx.lineTo(28, 66);
            ctx.lineTo(42, 52);
            ctx.lineTo(60, 50);
            ctx.lineTo(74, 62);
            ctx.lineTo(80, 92);
            ctx.closePath();
            ctx.fillStyle = S.hgrad(ctx, 22, 80, "#9a948c", "#4c4844");
            ctx.fill();
            ctx.fillStyle = "rgba(255,255,255,0.12)";
            S.poly(ctx, [28, 66, 42, 52, 60, 50, 52, 62, 36, 70]);
            ctx.fill();
            const ores = [[40, 72, 0.3], [58, 64, -0.4], [64, 80, 0.2], [48, 84, -0.1], [34, 82, 0.5]];
            for (let i = 0; i < ores.length; i++) {
                const o = ores[i];
                ctx.save();
                ctx.translate(o[0], o[1]);
                ctx.rotate(o[2]);
                S.poly(ctx, [0, -5, 3, 0, 0, 5, -3, 0]);
                ctx.fillStyle = i % 2 === 0 ? "#e89a4a" : "#c8d4e0";
                ctx.fill();
                ctx.restore();
            }
            const g = ores[f % ores.length];
            S.sparkle(ctx, g[0] + 2, g[1] - 3, 4.5, "#ffffff");
        }
    },

    // ---------------------------------------------------------------- the okami's clone (back view)

    drawFoxGirl: function(ctx, tails, f) {
        const S = battleSprites;
        const walk = f >= 8;
        const k = f % 8;
        const p = (k / 8) * SPRITE_TAU;
        const bob = walk ? -Math.abs(Math.sin(p)) * 2 : Math.sin(p) * 0.5;
        const sway = walk ? Math.sin(p) : Math.sin(p) * 0.5;
        const lStep = walk ? Math.max(0, Math.sin(p)) * 3.5 : 0;
        const rStep = walk ? Math.max(0, -Math.sin(p)) * 3.5 : 0;
        const fur = { base: "#f2b45e", shade: "#b86a2a", light: "#ffd9a0", tip: "#fffaf2", line: "rgba(110,50,15,0.6)" };
        const hair = { base: "#eccf98", shade: "#b5864c", light: "#fff2d4" };
        // Feet peeking out under the hakama.
        S.fillEll(ctx, "#3a2418", 44, 94 - lStep, 4.6, 2.2);
        S.fillEll(ctx, "#3a2418", 56, 94 - rStep, 4.6, 2.2);
        S.fillEll(ctx, "#fbf8f2", 44, 92.2 - lStep, 3.6, 2.4);
        S.fillEll(ctx, "#fbf8f2", 56, 92.2 - rStep, 3.6, 2.4);
        // Hakama.
        const hemSway = sway * 1.2;
        S.poly(ctx, [37, 60 + bob, 63, 60 + bob, 68 + hemSway, 91 + bob * 0.3, 32 + hemSway, 91 + bob * 0.3]);
        ctx.fillStyle = S.hgrad(ctx, 32, 68, "#d83a48", "#8a1426");
        ctx.fill();
        ctx.strokeStyle = "rgba(60,0,10,0.45)";
        ctx.lineWidth = 0.9;
        for (let i = 1; i < 5; i++) {
            const x0 = 37 + (26 * i) / 5;
            const x1 = 32 + hemSway + (36 * i) / 5;
            ctx.beginPath();
            ctx.moveTo(x0, 63 + bob);
            ctx.lineTo(x1, 90 + bob * 0.3);
            ctx.stroke();
        }
        // Sleeves.
        for (let s = -1; s <= 1; s += 2) {
            const sw = -s * sway * 1.8;
            const sx = 50 + s * 13;
            ctx.beginPath();
            ctx.moveTo(sx, 45 + bob);
            ctx.quadraticCurveTo(sx + s * 11, 48 + bob, sx + s * 12 + sw, 70 + bob);
            ctx.lineTo(sx + s * 2 + sw, 71 + bob);
            ctx.quadraticCurveTo(sx - s * 1, 58 + bob, sx - s * 3, 50 + bob);
            ctx.closePath();
            ctx.fillStyle = S.hgrad(ctx, sx - 4, sx + s * 12, "#fbf9f6", "#d4cede");
            ctx.fill();
            ctx.strokeStyle = "#d83a48";
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.moveTo(sx + s * 12 + sw, 69.5 + bob);
            ctx.lineTo(sx + s * 2 + sw, 70.5 + bob);
            ctx.stroke();
        }
        // Kosode (white top).
        S.poly(ctx, [39, 44 + bob, 61, 44 + bob, 63, 61 + bob, 37, 61 + bob]);
        ctx.fillStyle = S.hgrad(ctx, 37, 63, "#fdfcfa", "#d6d0e0");
        ctx.fill();
        // Obi bow.
        const by = 59 + bob;
        S.fillEll(ctx, "#c8902a", 43, by, 7, 4.4, 0.25);
        S.fillEll(ctx, "#c8902a", 57, by, 7, 4.4, -0.25);
        S.fillEll(ctx, "#f0c050", 43, by - 0.6, 5.2, 3, 0.25);
        S.fillEll(ctx, "#f0c050", 57, by - 0.6, 5.2, 3, -0.25);
        S.roundRect(ctx, 46.5, by - 3.5, 7, 7, 2);
        ctx.fillStyle = "#e0a838";
        ctx.fill();
        S.poly(ctx, [47, by + 3, 45 + sway, by + 13, 49 + sway, by + 12, 50, by + 4]);
        ctx.fillStyle = "#d89a30";
        ctx.fill();
        S.poly(ctx, [53, by + 3, 55 + sway, by + 13, 51 + sway, by + 12, 50, by + 4]);
        ctx.fill();
        // Hair: round head from behind plus a soft cascade down the back.
        const hx = sway * 0.8;
        ctx.beginPath();
        ctx.moveTo(35, 30 + bob);
        ctx.quadraticCurveTo(33.5, 46 + bob, 38.5 + hx, 58 + bob);
        ctx.lineTo(43.5 + hx, 55 + bob);
        ctx.lineTo(50 + hx, 61 + bob);
        ctx.lineTo(56.5 + hx, 55 + bob);
        ctx.lineTo(61.5 + hx, 58 + bob);
        ctx.quadraticCurveTo(66.5, 46 + bob, 65, 30 + bob);
        ctx.closePath();
        const hg = ctx.createLinearGradient(34, 0, 66, 0);
        hg.addColorStop(0, hair.light);
        hg.addColorStop(0.45, hair.base);
        hg.addColorStop(1, hair.shade);
        ctx.fillStyle = hg;
        ctx.fill();
        battleSprites.ell(ctx, 50, 27 + bob, 17, 16.5);
        const hh = ctx.createRadialGradient(44, 20 + bob, 2, 50, 27 + bob, 18);
        hh.addColorStop(0, hair.light);
        hh.addColorStop(0.6, hair.base);
        hh.addColorStop(1, hair.shade);
        ctx.fillStyle = hh;
        ctx.fill();
        // Strands fanning down from the crown so the back of the head reads as hair.
        ctx.lineWidth = 0.9;
        for (let i = -4; i <= 4; i++) {
            ctx.strokeStyle = i % 2 === 0 ? "rgba(150,100,45,0.45)" : "rgba(255,245,220,0.5)";
            ctx.beginPath();
            ctx.moveTo(50 + i * 0.8, 12.5 + bob);
            ctx.quadraticCurveTo(50 + i * 3.6, 22 + bob, 50 + i * 4.1 + hx * 0.5, 40 + bob);
            ctx.stroke();
        }
        ctx.strokeStyle = "rgba(255,255,255,0.7)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.ellipse(50, 25 + bob, 12.5, 6.5, 0, Math.PI * 1.12, Math.PI * 1.72);
        ctx.stroke();
        ctx.strokeStyle = "rgba(150,100,45,0.3)";
        ctx.lineWidth = 0.8;
        for (let i = 0; i < 3; i++) {
            const x = 43 + i * 7;
            ctx.beginPath();
            ctx.moveTo(x, 40 + bob);
            ctx.quadraticCurveTo(x + (i - 1) * 1.2, 48 + bob, x + (i - 1) * 2 + hx, 56 + bob);
            ctx.stroke();
        }
        // Red ribbon gathering the hair.
        S.fillEll(ctx, "#d83a48", 46.5, 43 + bob, 3.6, 2.2, 0.3);
        S.fillEll(ctx, "#d83a48", 53.5, 43 + bob, 3.6, 2.2, -0.3);
        S.fillEll(ctx, "#a81e30", 50, 43 + bob, 1.8, 1.8);
        // Tails: she faces away from us, so they come toward the camera from her lower back (drawn over the
        // hakama), rooted under the obi bow and arcing out to either side. Angle b is measured from straight
        // down (+ = her right / screen right); extra odd tails go to the right side.
        const n = Math.max(1, tails);
        const len = 40 - Math.min(6, n * 0.5);
        const wid = Math.max(13, 20 - n * 0.6);
        const order = [];
        const perSide = [Math.ceil(n / 2), Math.floor(n / 2)];
        for (let side = 0; side < 2; side++) {
            const m = perSide[side];
            for (let j = 0; j < m; j++) {
                const b = m === 1 ? 1.25 : 0.7 + (1.35 * j) / (m - 1);
                order.push({ b: side === 0 ? b : -b, i: order.length, k: m === 1 ? 1 : 0.86 + 0.14 * (j / (m - 1)) });
            }
        }
        // Upward-curling tails first so the lower, nearer ones overlap them.
        order.sort(function(x, y) { return Math.abs(y.b) - Math.abs(x.b); });
        for (let j = 0; j < order.length; j++) {
            const t = order[j];
            const b = t.b + Math.sin(p + t.i * 0.9) * (walk ? 0.14 : 0.09) * (t.b >= 0 ? 1 : -1);
            S.drawTail(ctx, 50 + (t.b >= 0 ? 1.5 : -1.5), 67 + bob, Math.PI - b, len * t.k, wid, t.b >= 0 ? -1 : 1, fur, p + t.i);
        }
        // Fluffy root where the tails leave her back.
        S.fillEll(ctx, fur.shade, 50, 67.5 + bob, 6, 4);
        S.fillEll(ctx, fur.base, 50, 66.8 + bob, 4.6, 3);
        // Fox ears (backs), with an occasional idle flick.
        const flick = !walk && k === 5 ? 0.25 : 0;
        S.drawEar(ctx, 39.5, 15 + bob, -0.38 - flick, fur);
        S.drawEar(ctx, 60.5, 15 + bob, 0.38, fur);
    },
    drawEar: function(ctx, x, y, rot, fur) {
        const S = battleSprites;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rot);
        ctx.beginPath();
        ctx.moveTo(-6, 2);
        ctx.quadraticCurveTo(-5, -9, 0, -14);
        ctx.quadraticCurveTo(5, -9, 6, 2);
        ctx.closePath();
        ctx.fillStyle = S.hgrad(ctx, -6, 6, fur.light, fur.shade);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(-2.6, -8.5);
        ctx.quadraticCurveTo(0, -12, 0, -14);
        ctx.quadraticCurveTo(0, -12, 2.6, -8.5);
        ctx.quadraticCurveTo(0, -10, -2.6, -8.5);
        ctx.fillStyle = "#6a3424";
        ctx.fill();
        ctx.restore();
    },
    /**
     * One fluffy tail along a cubic spine from (bx, by). `a` is the overall heading measured from straight up
     * (+ = right); the spine first droops, then sweeps out and curls its tip upward (`curl` = -1 right, +1 left).
     */
    drawTail: function(ctx, bx, by, a, len, wid, curl, fur, ph) {
        const S = battleSprites;
        const dx = Math.sin(a);
        const dy = -Math.cos(a);
        const flick = Math.sin(ph * 1.3) * 0.06;
        // Control points: droop down first, then out along the heading, tip curling up.
        const p0 = [bx, by];
        const p1 = [bx + dx * len * 0.15, by + len * 0.32];
        const p2 = [bx + dx * len * 0.75, by + dy * len * 0.55 + len * 0.22];
        const p3 = [bx + dx * len * 0.95 - curl * len * (0.05 + flick), by + dy * len * 0.8 - len * (0.12 + flick)];
        const steps = 24;
        const spine = [];
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const u = 1 - t;
            const px = u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0];
            const py = u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1];
            const tx = 3 * u * u * (p1[0] - p0[0]) + 6 * u * t * (p2[0] - p1[0]) + 3 * t * t * (p3[0] - p2[0]);
            const ty = 3 * u * u * (p1[1] - p0[1]) + 6 * u * t * (p2[1] - p1[1]) + 3 * t * t * (p3[1] - p2[1]);
            const tl = Math.hypot(tx, ty) || 1;
            // Normal pointing to the tail's upper side, so shading is consistent on both sides.
            let qx = -ty / tl;
            let qy = tx / tl;
            if (qy > 0) {
                qx = -qx;
                qy = -qy;
            }
            const w = 1.4 + wid * 0.5 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.62)), 0.75);
            spine.push([px, py, qx, qy, w]);
        }
        const band = function(from, to, lo, hi) {
            ctx.beginPath();
            for (let i = from; i <= to; i++) {
                const s = spine[i];
                const x = s[0] + s[2] * s[4] * hi;
                const y = s[1] + s[3] * s[4] * hi;
                if (i === from) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }
            for (let i = to; i >= from; i--) {
                const s = spine[i];
                ctx.lineTo(s[0] + s[2] * s[4] * lo, s[1] + s[3] * s[4] * lo);
            }
            ctx.closePath();
        };
        // Body, shaded across its width: dark underside, warm middle, light top.
        band(0, steps, -1, 1);
        ctx.fillStyle = fur.shade;
        ctx.fill();
        ctx.strokeStyle = fur.line;
        ctx.lineWidth = 0.9;
        ctx.stroke();
        band(0, steps, -0.45, 1);
        ctx.fillStyle = fur.base;
        ctx.fill();
        band(2, steps - 2, 0.35, 0.85);
        ctx.fillStyle = fur.light;
        ctx.fill();
        // Fur tufts poking out of the silhouette.
        for (let i = 5; i < steps - 3; i += 4) {
            for (let sd = -1; sd <= 1; sd += 2) {
                const s = spine[i];
                const ex = s[0] + s[2] * s[4] * sd;
                const ey = s[1] + s[3] * s[4] * sd;
                const tx = spine[i + 1][0] - s[0];
                const ty = spine[i + 1][1] - s[1];
                const tl = Math.hypot(tx, ty) || 1;
                ctx.beginPath();
                ctx.moveTo(ex - (tx / tl) * 2.2, ey - (ty / tl) * 2.2);
                ctx.lineTo(ex + s[2] * sd * 2.4 + (tx / tl) * 1.8, ey + s[3] * sd * 2.4 + (ty / tl) * 1.8);
                ctx.lineTo(ex + (tx / tl) * 2.2, ey + (ty / tl) * 2.2);
                ctx.closePath();
                ctx.fillStyle = sd > 0 ? fur.base : fur.shade;
                ctx.fill();
            }
        }
        // Cream tip.
        const tip = Math.floor(steps * 0.72);
        band(tip, steps, -1, 1);
        ctx.fillStyle = fur.tip;
        ctx.fill();
        band(tip, steps, -1, -0.35);
        ctx.fillStyle = "rgba(200,170,140,0.45)";
        ctx.fill();
    }
};

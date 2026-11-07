#!/usr/bin/env python3
"""Generate the bundled Desktop Robot GIF set and icon files.

The artwork is intentionally code-only so the project is self-contained:
no external fonts, stock images, or network downloads are needed.

Usage:
    python scripts/generate_animations.py
"""

from __future__ import annotations

import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageOps

ROOT = Path(__file__).resolve().parent.parent
ANIMATIONS_DIR = ROOT / "assets" / "animations"
ICONS_DIR = ROOT / "assets" / "icons"

SIZE = 360
SS = 3  # supersampling for smooth anti-aliased edges
CANVAS_PX = SIZE * SS

# Palette
INK = "#203b36"
INK_SOFT = "#2d514a"
CREAM = "#fff6e6"
CREAM_DARK = "#eddec5"
CREAM_LIGHT = "#fffdf5"
TEAL_PANEL = "#153b35"
TEAL_PANEL_INNER = "#1d4a42"
MINT = "#63d4c1"
MINT_DARK = "#3aa495"
MINT_GLOW = "#b4ffed"
CORAL = "#ff9f77"
CORAL_DARK = "#df7254"
GOLD = "#ffd27a"
GOLD_DARK = "#e2a842"
RED = "#e77b62"
BLUE = "#9adbe6"
CHEEK = "#9a5b4d"
SHADOW = "#2b5f55"

STATES = {
    "idle": {"frames": 48, "duration": 80},
    "thinking": {"frames": 36, "duration": 90},
    "talking": {"frames": 20, "duration": 70},
    "happy": {"frames": 30, "duration": 70},
    "error": {"frames": 28, "duration": 100},
    "listening": {"frames": 32, "duration": 80},
}


def sc(value: float) -> int:
    return int(round(value * SS))


def box(values: tuple[float, float, float, float]) -> tuple[int, int, int, int]:
    return tuple(sc(value) for value in values)  # type: ignore[return-value]


class Sketch:
    def __init__(self, image: Image.Image) -> None:
        self.image = image
        self.draw = ImageDraw.Draw(image)

    def rounded(self, xy, radius, fill=None, outline=None, width=0):
        self.draw.rounded_rectangle(
            box(xy), radius=sc(radius), fill=fill, outline=outline, width=sc(width)
        )

    def ellipse(self, xy, fill=None, outline=None, width=0):
        self.draw.ellipse(box(xy), fill=fill, outline=outline, width=sc(width))

    def line(self, points, fill, width=1, joint="curve"):
        self.draw.line(
            [(sc(x), sc(y)) for x, y in points],
            fill=fill,
            width=sc(width),
            joint=joint,
        )

    def arc(self, xy, start, end, fill, width=1):
        self.draw.arc(box(xy), start=start, end=end, fill=fill, width=sc(width))

    def polygon(self, points, fill, outline=None, width=0):
        pts = [(sc(x), sc(y)) for x, y in points]
        self.draw.polygon(pts, fill=fill)
        if outline and width:
            self.draw.line(pts + [pts[0]], fill=outline, width=sc(width), joint="curve")

    def pieslice(self, xy, start, end, fill, outline=None, width=0):
        self.draw.pieslice(
            box(xy),
            start=start,
            end=end,
            fill=fill,
            outline=outline,
            width=sc(width),
        )


def draw_heart(sketch: Sketch, cx, cy, size, fill, outline=INK, width=2):
    top = cy - size * 0.34
    left = cx - size * 0.5
    right = cx + size * 0.5
    bottom = cy + size * 0.55
    sketch.ellipse(
        (left + size * 0.02, top, left + size * 0.5, top + size * 0.52),
        fill=fill,
        outline=outline,
        width=width,
    )
    sketch.ellipse(
        (right - size * 0.5, top, right - size * 0.02, top + size * 0.52),
        fill=fill,
        outline=outline,
        width=width,
    )
    sketch.polygon(
        [
            (left + size * 0.06, top + size * 0.32),
            (right - size * 0.06, top + size * 0.32),
            (cx, bottom),
        ],
        fill=fill,
        outline=outline,
        width=width,
    )


def draw_sparkle(sketch: Sketch, cx, cy, size, color, width=2):
    sketch.line([(cx - size, cy), (cx + size, cy)], fill=color, width=width)
    sketch.line([(cx, cy - size), (cx, cy + size)], fill=color, width=width)


def draw_heart_antenna(sketch: Sketch, pulse: float, color=CORAL):
    # stem
    sketch.line([(180, 68), (180, 43)], fill=INK, width=7)
    # glow rings
    for offset, alpha_color in [(5, "#9ff0df"), (10, "#5ebcad")]:
        radius = 18 + pulse * 2 + offset
        sketch.ellipse(
            (180 - radius, 27 - radius, 180 + radius, 27 + radius),
            outline=alpha_color,
            width=2,
        )
    # ball
    sketch.ellipse((165, 12, 195, 42), fill=color, outline=INK, width=4)
    sketch.ellipse((171, 17, 180, 26), fill=CREAM_LIGHT)
    sketch.ellipse((176, 22, 180, 26), fill="#fff7e8")


def draw_eyes(sketch: Sketch, style: str, gaze_x: float, gaze_y: float, color=MINT_GLOW):
    positions = [(137, 137), (223, 137)]
    for index, (cx, cy) in enumerate(positions):
        cx += gaze_x
        cy += gaze_y
        if style == "blink":
            sketch.arc((cx - 14, cy - 7, cx + 14, cy + 7), 15, 165, fill=color, width=5)
        elif style == "happy":
            sketch.arc((cx - 15, cy - 8, cx + 15, cy + 11), 200, 340, fill=color, width=6)
        elif style == "sad":
            sketch.ellipse((cx - 12, cy - 11, cx + 12, cy + 12), fill=color)
            sketch.arc((cx - 15, cy - 14, cx + 15, cy + 5), 195, 345, fill=TEAL_PANEL, width=6)
            sketch.ellipse((cx - 11, cy - 9, cx + 5, cy - 1), fill="#e8fff8")
        elif style == "wide":
            sketch.ellipse((cx - 17, cy - 19, cx + 17, cy + 19), fill=color)
            sketch.ellipse((cx - 14, cy - 16, cx + 14, cy + 16), fill=color)
            sketch.ellipse((cx - 12, cy - 14, cx + 2, cy - 4), fill="#f4fffb")
        elif style == "thinking":
            sketch.ellipse((cx - 12, cy - 15, cx + 12, cy + 13), fill=color)
            sketch.ellipse((cx - 11, cy - 13, cx + 1, cy - 5), fill="#f4fffb")
        else:  # open
            sketch.ellipse((cx - 16, cy - 18, cx + 16, cy + 18), fill="#2b5c52")
            sketch.ellipse((cx - 14, cy - 16, cx + 14, cy + 16), fill=color)
            sketch.ellipse((cx - 12, cy - 14, cx + 1, cy - 4), fill="#f7fffc")
            sketch.ellipse((cx + 4, cy + 5, cx + 9, cy + 10), fill=color)

    if style == "sad":
        # eyebrows
        sketch.line([(120, 112), (150, 106)], fill=color, width=4)
        sketch.line([(210, 106), (240, 112)], fill=color, width=4)


def draw_mouth(sketch: Sketch, style: str, phase: float = 0.0, color=MINT_GLOW):
    if style == "talk":
        heights = [8, 15, 10, 18, 7]
        for index, height in enumerate(heights):
            wobble = math.sin(phase * 2 * math.pi + index * 0.8) * 3
            h = max(4, height + wobble)
            x = 159 + index * 10.5
            sketch.line([(x, 176 - h / 2), (x, 176 + h / 2)], fill=color, width=5)
    elif style == "happy":
        sketch.arc((158, 160, 202, 192), 8, 172, fill=color, width=6)
        sketch.arc((164, 167, 196, 190), 20, 160, fill="#ffb98f", width=3)
    elif style == "sad":
        sketch.line(
            [(163, 180), (170, 176), (177, 180), (184, 176), (191, 180), (198, 176)],
            fill=color,
            width=4,
        )
    elif style == "thinking":
        sketch.ellipse((171, 169, 189, 183), fill=color)
    elif style == "wide":
        sketch.arc((162, 164, 198, 188), 15, 165, fill=color, width=5)
    else:
        sketch.arc((165, 165, 195, 185), 20, 160, fill=color, width=4)


def draw_ear(sketch: Sketch, side: str, glow: float = 0.0):
    if side == "left":
        cx, cy = 74, 146
        inner_offset = -1
    else:
        cx, cy = 286, 146
        inner_offset = 1
    sketch.ellipse((cx - 24, cy - 24, cx + 24, cy + 24), fill=INK)
    sketch.ellipse((cx - 18, cy - 18, cx + 18, cy + 18), fill=MINT_DARK)
    sketch.ellipse((cx - 11, cy - 11, cx + 11, cy + 11), fill=CREAM)
    sketch.ellipse((cx - 5, cy - 5, cx + 5, cy + 5), fill=INK_SOFT)
    if glow > 0:
        sketch.ellipse(
            (cx - 28 - glow * 4, cy - 28 - glow * 4, cx + 28 + glow * 4, cy + 28 + glow * 4),
            outline="#8debd9",
            width=2,
        )


def draw_body(sketch: Sketch, arm_swing: float = 0.0):
    # shadowless floating robot, legs first
    for side in (-1, 1):
        hip_x = 180 + side * 33
        foot_x = 180 + side * 37
        sketch.line([(hip_x, 312), (hip_x, 333)], fill=INK, width=22)
        sketch.line([(hip_x, 312), (hip_x, 333)], fill=CREAM, width=14)
        sketch.ellipse((foot_x - 27, 330, foot_x + 27, 353), fill=INK)
        sketch.ellipse((foot_x - 21, 329, foot_x + 21, 347), fill=CREAM)
        sketch.arc((foot_x - 19, 332, foot_x + 18, 347), 10, 170, fill=CREAM_DARK, width=3)

    # arms
    for side in (-1, 1):
        shoulder = (180 + side * 57, 246)
        hand = (180 + side * 86, 281 + arm_swing * 6)
        sketch.line([shoulder, hand], fill=INK, width=25)
        sketch.line([shoulder, hand], fill=CREAM, width=17)
        sketch.ellipse((hand[0] - 15, hand[1] - 15, hand[0] + 15, hand[1] + 15), fill=INK)
        sketch.ellipse((hand[0] - 11, hand[1] - 11, hand[0] + 11, hand[1] + 11), fill=MINT)
        sketch.ellipse((hand[0] - 5, hand[1] - 6, hand[0] + 1, hand[1]), fill=CREAM_LIGHT)

    # torso
    sketch.rounded((124, 218, 236, 322), 37, fill=CREAM, outline=INK, width=7)
    sketch.rounded((130, 223, 230, 245), 18, fill=CREAM_LIGHT)
    # neck joint
    sketch.rounded((158, 207, 202, 235), 12, fill=INK)
    sketch.rounded((164, 210, 196, 232), 9, fill=CREAM_DARK)

    # belly screen
    sketch.rounded((146, 246, 214, 294), 18, fill=TEAL_PANEL, outline=INK_SOFT, width=3)
    draw_heart(sketch, 180, 268, 22, CORAL, outline=CORAL_DARK, width=1)
    sketch.ellipse((153, 302, 160, 309), fill=MINT_DARK)
    sketch.ellipse((166, 302, 173, 309), fill=GOLD)
    sketch.ellipse((179, 302, 186, 309), fill=CORAL)


def draw_head(sketch: Sketch, pulse: float = 0.0, eye_style: str = "open",
              gaze=(0, 0), mouth_style: str = "smile", mouth_phase: float = 0.0):
    draw_ear(sketch, "left", pulse if eye_style == "wide" else 0)
    draw_ear(sketch, "right", pulse if eye_style == "wide" else 0)
    draw_heart_antenna(
        sketch,
        pulse,
        color=RED if eye_style == "sad" else GOLD if eye_style == "happy" else CORAL,
    )

    # head shell
    sketch.rounded((70, 62, 290, 224), 54, fill=CREAM, outline=INK, width=7)
    sketch.rounded((82, 72, 278, 102), 22, fill=CREAM_LIGHT)
    # subtle shell seam and bolts
    sketch.arc((80, 70, 280, 160), 198, 342, fill=CREAM_DARK, width=2)
    sketch.ellipse((84, 206, 94, 216), fill=CREAM_DARK)
    sketch.ellipse((266, 206, 276, 216), fill=CREAM_DARK)

    # face panel
    sketch.rounded((95, 87, 265, 199), 38, fill=TEAL_PANEL, outline=INK_SOFT, width=4)
    sketch.rounded((103, 94, 257, 192), 32, fill=TEAL_PANEL_INNER)
    # glass highlight
    sketch.arc((107, 96, 253, 165), 200, 260, fill="#2b5b52", width=3)
    sketch.ellipse((236, 103, 243, 110), fill=MINT if eye_style != "sad" else RED)

    draw_eyes(sketch, eye_style, gaze[0], gaze[1])
    draw_mouth(sketch, mouth_style, mouth_phase)

    # cheeks
    cheek_alpha = CHEEK
    sketch.ellipse((107, 163, 125, 174), fill=cheek_alpha)
    sketch.ellipse((235, 163, 253, 174), fill=cheek_alpha)

    # little chin screws under screen
    sketch.ellipse((137, 207, 143, 213), fill=CREAM_DARK)
    sketch.ellipse((217, 207, 223, 213), fill=CREAM_DARK)


def heart_points(cx, cy, scale):
    points = []
    for index in range(24):
        t = index / 24 * 2 * math.pi
        x = 16 * math.sin(t) ** 3
        y = 13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)
        points.append((cx + x * scale, cy - y * scale))
    return points


def draw_thought_bubble(sketch: Sketch, phase: float):
    # small cloud with animated dots
    sketch.rounded((267, 58, 335, 99), 17, fill=CREAM_LIGHT, outline=INK, width=3)
    sketch.ellipse((253, 95, 266, 108), fill=CREAM_LIGHT, outline=INK, width=3)
    sketch.ellipse((245, 107, 254, 116), fill=CREAM_LIGHT, outline=INK, width=2)
    for index in range(3):
        active = (phase * 3 + index * 0.9) % 1
        radius = 2.2 + 1.8 * (0.5 + 0.5 * math.sin(active * 2 * math.pi))
        cx = 281 + index * 18
        sketch.ellipse((cx - radius, 79 - radius, cx + radius, 79 + radius), fill=MINT_DARK)


def draw_speech_marks(sketch: Sketch, phase: float):
    for index in range(2):
        offset = math.sin(phase * 2 * math.pi + index) * 2
        x = 300 + index * 12
        sketch.arc((x - 8, 142 - offset, x + 9, 162 - offset), 300, 55, fill=MINT, width=3)


def draw_sweat_drop(sketch: Sketch, phase: float):
    drop_size = 8 + math.sin(phase * 2 * math.pi) * 2
    cx, cy = 286, 93 + drop_size * 0.5
    sketch.polygon(
        [(cx, cy - drop_size), (cx - drop_size * 0.75, cy + drop_size * 0.35),
         (cx, cy + drop_size), (cx + drop_size * 0.75, cy + drop_size * 0.35)],
        fill=BLUE,
        outline=INK,
        width=2,
    )
    sketch.ellipse(
        (cx - 2.5, cy - 1, cx + 1.5, cy + 3),
        fill=CREAM_LIGHT,
    )


def draw_happy_extras(sketch: Sketch, phase: float):
    for index, (base_x, base_y, size, direction) in enumerate(
        [(78, 122, 20, 1), (294, 91, 15, -1), (309, 137, 10, 1)]
    ):
        cycle = (phase + index * 0.27) % 1
        rise = cycle * 56
        sway = math.sin(cycle * 2 * math.pi) * 7
        alpha_size = size * (0.75 + 0.25 * math.sin(cycle * math.pi))
        draw_heart(
            sketch,
            base_x + sway * direction,
            base_y - rise,
            alpha_size,
            CORAL if index != 1 else GOLD,
            outline=INK,
            width=2,
        )
    for index, (cx, cy) in enumerate([(58, 166), (318, 183), (98, 74)]):
        twinkle = 0.65 + 0.35 * math.sin(phase * 2 * math.pi + index * 1.7)
        draw_sparkle(sketch, cx, cy, 6 * twinkle, GOLD_DARK, width=2)


def draw_listening_waves(sketch: Sketch, phase: float):
    for side in (-1, 1):
        cx = 180 + side * 112
        for index in range(3):
            strength = 0.5 + 0.5 * math.sin(phase * 2 * math.pi - index * 0.8)
            radius = 32 + index * 10 + strength * 4
            color = "#9ff0df" if index == 0 else "#63c7b7"
            sketch.arc(
                (cx - radius, 146 - radius, cx + radius, 146 + radius),
                -48 if side > 0 else 132,
                48 if side > 0 else 228,
                fill=color,
                width=2 if index else 3,
            )


def draw_ground(sketch: Sketch, phase: float, mood: str = "idle"):
    # dotted hover ring
    for index in range(10):
        angle = index / 10 * 2 * math.pi
        cx = 180 + 88 * math.cos(angle)
        cy = 345 + 8 * math.sin(angle)
        bright = 0.35 + 0.35 * (0.5 + 0.5 * math.sin(phase * 2 * math.pi + index))
        color = "#72c9b8" if bright > 0.55 else "#4b8f83"
        if mood == "error":
            color = "#a87d70" if bright > 0.55 else "#83665e"
        sketch.ellipse((cx - 2.2, cy - 2.2, cx + 2.2, cy + 2.2), fill=color)

    twinkles = [(94, 337, 4.5), (264, 340, 3.6), (122, 357, 2.4), (238, 358, 2.8)]
    for index, (cx, cy, size) in enumerate(twinkles):
        strength = 0.55 + 0.45 * math.sin(phase * 2 * math.pi + index * 1.3)
        draw_sparkle(sketch, cx, cy, size * strength, MINT_DARK, width=1.5)


def character_layer(state: str, phase: float):
    char = Image.new("RGBA", (CANVAS_PX, CANVAS_PX), (0, 0, 0, 0))
    sketch = Sketch(char)

    pulse = 0.5 + 0.5 * math.sin(phase * 2 * math.pi)
    eye_style = "open"
    gaze = (0.0, 0.0)
    mouth_style = "smile"
    arm_swing = math.sin(phase * 2 * math.pi) * 0.5

    if state == "thinking":
        eye_style = "thinking"
        gaze = (4.0, -5.0)
        mouth_style = "thinking"
        arm_swing = 0.2
    elif state == "talking":
        mouth_style = "talk"
        eye_style = "open"
        gaze = (math.sin(phase * 2 * math.pi) * 2.0, 0)
        arm_swing = math.sin(phase * 2 * math.pi * 2) * 0.9
    elif state == "happy":
        eye_style = "happy"
        mouth_style = "happy"
        arm_swing = 0.7
    elif state == "error":
        eye_style = "sad"
        mouth_style = "sad"
        arm_swing = -0.2
    elif state == "listening":
        eye_style = "wide"
        mouth_style = "wide"
        arm_swing = 0.25

    draw_body(sketch, arm_swing)
    draw_head(
        sketch,
        pulse=pulse,
        eye_style=eye_style,
        gaze=gaze,
        mouth_style=mouth_style,
        mouth_phase=phase,
    )

    if state == "thinking":
        draw_thought_bubble(sketch, phase)
    elif state == "talking":
        draw_speech_marks(sketch, phase)
    elif state == "happy":
        draw_happy_extras(sketch, phase)
    elif state == "error":
        draw_sweat_drop(sketch, phase)
    elif state == "listening":
        draw_listening_waves(sketch, phase)

    # idle blink as a post-pass: draw over the eyes only
    if state == "idle" and 0.38 <= phase <= 0.46:
        cover = Image.new("RGBA", (CANVAS_PX, CANVAS_PX), (0, 0, 0, 0))
        cover_sketch = Sketch(cover)
        for cx, cy in [(137, 137), (223, 137)]:
            cover_sketch.ellipse(
                (cx - 20, cy - 22, cx + 20, cy + 22),
                fill=TEAL_PANEL_INNER,
            )
        char.alpha_composite(cover)
        sketch = Sketch(char)
        for cx, cy in [(137, 137), (223, 137)]:
            sketch.arc((cx - 14, cy - 7, cx + 14, cy + 8), 15, 165, fill=MINT_GLOW, width=5)

    return char


def motion_for(state: str, phase: float):
    sine = math.sin(phase * 2 * math.pi)
    if state == "idle":
        return 5.0 * sine, 1.1 * math.sin(phase * 2 * math.pi + 0.45)
    if state == "thinking":
        return 2.0 * sine, 1.7 * math.sin(phase * 2 * math.pi + 0.2)
    if state == "talking":
        return 2.5 * math.sin(phase * 4 * math.pi), 0.7 * sine
    if state == "happy":
        return -abs(math.sin(phase * 2 * math.pi * 2)) * 11 - 1.5, 1.8 * sine
    if state == "error":
        return 2.0 + abs(sine) * 1.2, -1.3 + 0.5 * sine
    if state == "listening":
        return 2.0 * sine, 2.2 * math.sin(phase * 2 * math.pi + 0.8)
    return 0.0, 0.0


def render_frame(state: str, frame_index: int, total_frames: int) -> Image.Image:
    phase = frame_index / total_frames
    frame = Image.new("RGBA", (CANVAS_PX, CANVAS_PX), (0, 0, 0, 0))
    sketch = Sketch(frame)
    draw_ground(sketch, phase, mood="error" if state == "error" else "idle")

    char = character_layer(state, phase)
    offset_y, angle = motion_for(state, phase)
    if angle:
        char = char.rotate(
            angle,
            resample=Image.Resampling.BICUBIC,
            center=(180 * SS, 212 * SS),
        )
    frame.alpha_composite(char, (0, sc(offset_y)))

    return frame.resize((SIZE, SIZE), Image.Resampling.LANCZOS)


def to_transparent_palette(image: Image.Image, colors: int = 127) -> Image.Image:
    rgba = image.convert("RGBA")
    alpha = rgba.getchannel("A").point(lambda value: 255 if value >= 120 else 0)
    transparent_mask = ImageOps.invert(alpha)

    # Composite the RGB over a chroma key so any residual edge pixels are
    # harmless. The mask below makes only the transparent pixels use index 255.
    rgb = Image.new("RGB", rgba.size, (255, 0, 255))
    rgb.paste(rgba.convert("RGB"), (0, 0), alpha)
    paletted = rgb.quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)

    palette = paletted.getpalette() or []
    palette = (palette + [0, 0, 0] * 256)[: 256 * 3]
    palette[255 * 3 : 255 * 3 + 3] = [255, 0, 255]
    paletted.putpalette(palette)

    indices = np.array(paletted, dtype=np.uint8)
    indices[np.array(transparent_mask) > 0] = 255
    result = Image.fromarray(indices, mode="P")
    result.putpalette(palette)
    result.info["transparency"] = 255
    return result


def save_gif(state: str, settings: dict) -> None:
    total = settings["frames"]
    duration = settings["duration"]
    frames = []
    for index in range(total):
        rgba = render_frame(state, index, total)
        frames.append(to_transparent_palette(rgba))

    path = ANIMATIONS_DIR / f"{state}.gif"
    frames[0].save(
        path,
        save_all=True,
        append_images=frames[1:],
        duration=duration,
        loop=0,
        disposal=2,
        transparency=255,
        optimize=False,
        comment="Desktop Robot animation",
    )
    print(f"  {path.name:12s} {total:>2d} frames  {path.stat().st_size / 1024:.1f} KiB")


def make_static_assets() -> None:
    frame = render_frame("idle", 4, STATES["idle"]["frames"]).convert("RGBA")

    robot = frame.resize((512, 512), Image.Resampling.LANCZOS)
    robot.save(ICONS_DIR / "robot.png", "PNG")

    # Bust crop for chat/settings avatars. Keep a little transparent padding.
    avatar_crop = frame.crop((48, 32, 312, 234))
    side = max(avatar_crop.size)
    avatar_square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    avatar_square.alpha_composite(
        avatar_crop,
        ((side - avatar_crop.width) // 2, (side - avatar_crop.height) // 2),
    )
    avatar = avatar_square.resize((512, 512), Image.Resampling.LANCZOS)
    avatar.save(ICONS_DIR / "avatar.png", "PNG")

    # Icon badge: warm circular backdrop, dark outline, robot bust on top.
    icon_size = 512
    badge = Image.new("RGBA", (icon_size, icon_size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(badge)
    draw.ellipse((20, 20, icon_size - 20, icon_size - 20), fill=CREAM, outline=INK, width=26)
    draw.ellipse((44, 44, icon_size - 44, icon_size - 44), fill="#e9f4ed")
    bust = avatar.copy()
    # Trim transparent padding around the avatar so the head fills the badge.
    bbox = bust.getbbox()
    if bbox:
        bust = bust.crop(bbox)
    bust.thumbnail((400, 400), Image.Resampling.LANCZOS)
    badge.alpha_composite(
        bust,
        ((icon_size - bust.width) // 2, (icon_size - bust.height) // 2 + 6),
    )
    badge.save(ICONS_DIR / "icon.png", "PNG")
    badge.save(
        ICONS_DIR / "app.ico",
        format="ICO",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )

    # Tray icon: bolder, simpler geometry for 16 px visibility.
    tray = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    draw = ImageDraw.Draw(tray)
    draw.ellipse((10, 10, 246, 246), fill=TEAL_PANEL, outline=CREAM, width=16)
    draw.ellipse((60, 62, 196, 186), fill=CREAM, outline=INK, width=10)
    draw.rounded_rectangle((82, 92, 174, 158), radius=22, fill=TEAL_PANEL_INNER)
    draw.ellipse((105, 113, 126, 142), fill=MINT_GLOW)
    draw.ellipse((133, 113, 154, 142), fill=MINT_GLOW)
    draw.arc((114, 147, 145, 162), 15, 165, fill=MINT_GLOW, width=4)
    draw.line((128, 62, 128, 34), fill=CREAM, width=8)
    draw.ellipse((111, 18, 145, 52), fill=CORAL, outline=CREAM, width=5)
    tray.save(ICONS_DIR / "tray.png", "PNG")


def main() -> None:
    ANIMATIONS_DIR.mkdir(parents=True, exist_ok=True)
    ICONS_DIR.mkdir(parents=True, exist_ok=True)
    print("Generating Desktop Robot animations…")
    for state, settings in STATES.items():
        save_gif(state, settings)
    print("Generating static icons…")
    make_static_assets()
    print("Done.")


if __name__ == "__main__":
    main()

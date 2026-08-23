"""
gui/icons.py
--------------
Icone piatte disegnate a mano con PIL (supersampling: si disegna a
risoluzione 4x e si ridimensiona con anti-aliasing) invece di usare emoji
di sistema. Le emoji rendono in modo incoerente tra sistemi operativi e a
piccole dimensioni appaiono "sgranate"; queste icone sono invece nitide,
coerenti con la palette dell'app e uguali su ogni computer.

Uso tipico:
    from gui import icons
    img = icons.get_icon("gear", color=theme.COLORS["text_primary"], size=20)
    ctk.CTkButton(parent, text="", image=img, ...)
"""

import math

import customtkinter as ctk
from PIL import Image, ImageDraw

SS = 4  # fattore di supersampling: si disegna a 4x e si rimpicciolisce


def _canvas(size):
    s = size * SS
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    return img, ImageDraw.Draw(img), s


def _finish(img, size):
    return img.resize((size, size), Image.LANCZOS)


def _radial_rect(cx, cy, angle, r1, r2, half_width):
    """4 vertici di un rettangolo orientato radialmente da r1 a r2 lungo
    `angle` (radianti): usato per i denti dell'ingranaggio."""
    dx, dy = math.cos(angle), math.sin(angle)
    px, py = -dy, dx
    return [
        (cx + dx * r1 + px * half_width, cy + dy * r1 + py * half_width),
        (cx + dx * r1 - px * half_width, cy + dy * r1 - py * half_width),
        (cx + dx * r2 - px * half_width, cy + dy * r2 - py * half_width),
        (cx + dx * r2 + px * half_width, cy + dy * r2 + py * half_width),
    ]


def _draw_gear(color, size):
    img, d, s = _canvas(size)
    cx = cy = s / 2
    body_r, tooth_r2, hole_r = s * 0.26, s * 0.40, s * 0.13
    teeth, tooth_half_w = 8, s * 0.075

    for i in range(teeth):
        angle = (2 * math.pi / teeth) * i
        d.polygon(_radial_rect(cx, cy, angle, body_r * 0.75, tooth_r2, tooth_half_w), fill=color)

    d.ellipse([cx - body_r, cy - body_r, cx + body_r, cy + body_r], fill=color)
    d.ellipse([cx - hole_r, cy - hole_r, cx + hole_r, cy + hole_r], fill=(0, 0, 0, 0))
    return _finish(img, size)


def _draw_chat(color, size):
    img, d, s = _canvas(size)
    margin, tail_h = s * 0.14, s * 0.14
    d.rounded_rectangle([margin, margin, s - margin, s - margin - tail_h], radius=s * 0.16, fill=color)
    d.polygon(
        [(s * 0.28, s - margin - tail_h), (s * 0.42, s - margin - tail_h), (s * 0.28, s - margin + s * 0.02)],
        fill=color,
    )
    return _finish(img, size)


def _draw_graduation_cap(color, size):
    img, d, s = _canvas(size)
    cx, cy = s / 2, s * 0.40
    half_w, half_h = s * 0.42, s * 0.16
    d.polygon([(cx, cy - half_h), (cx + half_w, cy), (cx, cy + half_h), (cx - half_w, cy)], fill=color)

    base_w = s * 0.30
    d.rounded_rectangle(
        [cx - base_w / 2, cy + s * 0.05, cx + base_w / 2, cy + s * 0.30], radius=s * 0.04, fill=color
    )
    d.line([(cx + half_w * 0.55, cy + s * 0.02), (cx + half_w * 0.55, cy + s * 0.34)], fill=color, width=int(s * 0.03))
    d.ellipse(
        [cx + half_w * 0.55 - s * 0.035, cy + s * 0.30, cx + half_w * 0.55 + s * 0.035, cy + s * 0.37], fill=color
    )
    return _finish(img, size)


def _draw_auto(color, size):
    """Freccia circolare (ciclo): rappresenta la modalità Automatica."""
    img, d, s = _canvas(size)
    cx = cy = s / 2
    r, width = s * 0.30, s * 0.09
    start_deg, end_deg = -30, 235
    d.arc([cx - r, cy - r, cx + r, cy + r], start=start_deg, end=end_deg, fill=color, width=int(width))

    end_angle = math.radians(end_deg)
    tip_x, tip_y = cx + r * math.cos(end_angle), cy + r * math.sin(end_angle)
    tangent_angle = end_angle + math.pi / 2
    arrow_len, arrow_spread = s * 0.20, s * 0.13

    back_x = tip_x - arrow_len * math.cos(tangent_angle)
    back_y = tip_y - arrow_len * math.sin(tangent_angle)
    perp = tangent_angle + math.pi / 2
    a1 = (back_x + arrow_spread * math.cos(perp), back_y + arrow_spread * math.sin(perp))
    a2 = (back_x - arrow_spread * math.cos(perp), back_y - arrow_spread * math.sin(perp))

    d.polygon([(tip_x, tip_y), a1, a2], fill=color)
    return _finish(img, size)


def _draw_folder(color, size):
    img, d, s = _canvas(size)
    left, right = s * 0.12, s * 0.88
    top, bottom = s * 0.28, s * 0.80
    d.rounded_rectangle([left, top - s * 0.06, left + s * 0.30, top + s * 0.05], radius=s * 0.03, fill=color)
    d.rounded_rectangle([left, top, right, bottom], radius=s * 0.05, fill=color)
    return _finish(img, size)


def _draw_globe(color, size):
    img, d, s = _canvas(size)
    cx = cy = s / 2
    r = s * 0.36
    width = max(1, int(s * 0.035))
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=color, width=width)
    d.ellipse([cx - r * 0.42, cy - r, cx + r * 0.42, cy + r], outline=color, width=width)
    d.line([cx - r, cy, cx + r, cy], fill=color, width=width)
    d.line([cx - r * 0.92, cy - r * 0.5, cx + r * 0.92, cy - r * 0.5], fill=color, width=width)
    d.line([cx - r * 0.92, cy + r * 0.5, cx + r * 0.92, cy + r * 0.5], fill=color, width=width)
    return _finish(img, size)


def _draw_mic(color, size):
    img, d, s = _canvas(size)
    cx = s / 2
    cap_w, cap_top, cap_bottom = s * 0.20, s * 0.14, s * 0.52
    d.rounded_rectangle([cx - cap_w, cap_top, cx + cap_w, cap_bottom], radius=cap_w, fill=color)
    width = max(1, int(s * 0.055))
    d.arc([cx - s * 0.30, s * 0.30, cx + s * 0.30, s * 0.68], start=20, end=160, fill=color, width=width)
    d.line([cx, s * 0.62, cx, s * 0.82], fill=color, width=width)
    d.line([cx - s * 0.16, s * 0.82, cx + s * 0.16, s * 0.82], fill=color, width=width)
    return _finish(img, size)


def _draw_send(color, size):
    img, d, s = _canvas(size)
    d.polygon([(s * 0.14, s * 0.20), (s * 0.88, s * 0.5), (s * 0.14, s * 0.80), (s * 0.32, s * 0.5)], fill=color)
    return _finish(img, size)


def _draw_plus(color, size):
    img, d, s = _canvas(size)
    cx = cy = s / 2
    length, width = s * 0.30, max(1, int(s * 0.10))
    d.line([cx - length, cy, cx + length, cy], fill=color, width=width)
    d.line([cx, cy - length, cx, cy + length], fill=color, width=width)
    return _finish(img, size)


def _draw_chevron(color, size, direction="left"):
    img, d, s = _canvas(size)
    width = max(1, int(s * 0.10))
    if direction == "left":
        pts = [(s * 0.62, s * 0.22), (s * 0.34, s * 0.5), (s * 0.62, s * 0.78)]
    else:
        pts = [(s * 0.38, s * 0.22), (s * 0.66, s * 0.5), (s * 0.38, s * 0.78)]
    d.line(pts, fill=color, width=width, joint="curve")
    return _finish(img, size)


_DRAWERS = {
    "gear": _draw_gear,
    "chat": _draw_chat,
    "graduation_cap": _draw_graduation_cap,
    "auto": _draw_auto,
    "folder": _draw_folder,
    "globe": _draw_globe,
    "mic": _draw_mic,
    "send": _draw_send,
    "plus": _draw_plus,
    "chevron_left": lambda color, size: _draw_chevron(color, size, "left"),
    "chevron_right": lambda color, size: _draw_chevron(color, size, "right"),
}

_cache = {}


def _hex_to_rgba(hex_color: str):
    hex_color = hex_color.lstrip("#")
    r, g, b = (int(hex_color[i:i + 2], 16) for i in (0, 2, 4))
    return (r, g, b, 255)


def get_icon(name: str, color: str, size: int = 20) -> ctk.CTkImage:
    """Ritorna un CTkImage pronto per essere passato a `image=` di un
    widget CustomTkinter. Le icone vengono disegnate una sola volta per
    combinazione (nome, colore, dimensione) e poi tenute in cache.
    """
    key = (name, color, size)
    if key not in _cache:
        drawer = _DRAWERS.get(name)
        if drawer is None:
            raise ValueError(f"Icona sconosciuta: {name}")
        rgba = _hex_to_rgba(color)
        pil_img = drawer(rgba, size)
        _cache[key] = ctk.CTkImage(light_image=pil_img, dark_image=pil_img, size=(size, size))
    return _cache[key]

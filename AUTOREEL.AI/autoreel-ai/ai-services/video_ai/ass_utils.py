"""
ass_utils.py — AutoReel.ai
Generates animated ASS subtitle files with viral karaoke-style captions.
Supports three styles:
  - "viral"  → MrBeast/TikTok yellow-box black-text with extreme pop animation
  - "clean"  → White text with outline and highlight color changes
  - "tiktok" → Neon stroke white text (borderless), current TikTok trend
"""

import math
import random

# ─── ASS HEADER ───────────────────────────────────────────────────────────────
# Bigger fonts across all styles for full-screen presence on mobile
# BorderStyle 3 = opaque box fill for "viral" yellow-box karaoke
# BorderStyle 1 = outline only for "clean" and "tiktok"

ASS_HEADER = """[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding

Style: HOOK_VIRAL,Montserrat,130,&H00FFFFFF,&H000000FF,&H00000000,&HA0000000,1,0,1,8,0,5,60,60,0,1
Style: BODY_VIRAL,Montserrat,110,&H00FFFFFF,&H000000FF,&H00000000,&HA0000000,1,0,1,8,0,5,80,80,0,1
Style: CTA_VIRAL,Montserrat,90,&H0000FFFF,&H000000FF,&H00000000,&H80000000,1,0,1,6,2,5,80,80,0,1

Style: HOOK_CLEAN,Montserrat,130,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,1,0,1,8,0,5,60,60,0,1
Style: BODY_CLEAN,Montserrat,110,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,1,0,1,8,0,5,80,80,0,1
Style: CTA_CLEAN,Montserrat,88,&H0000FFFF,&H000000FF,&H00000000,&H80000000,1,0,1,6,0,5,80,80,0,1

Style: HOOK_TIKTOK,Montserrat,130,&H00FFFFFF,&H000000FF,&H000000FF,&H00000000,1,0,1,8,0,5,60,60,0,1
Style: BODY_TIKTOK,Montserrat,110,&H00FFFFFF,&H000000FF,&H000000FF,&H00000000,1,0,1,8,0,5,80,80,0,1
Style: CTA_TIKTOK,Montserrat,88,&H0000FFFF,&H000000FF,&H000000FF,&H00000000,1,0,1,6,0,5,80,80,0,1

Style: HOOK_HALKU,Arial Black,110,&H00FFFFFF,&H000000FF,&H00000000,&H90000000,1,0,3,10,0,8,60,60,100,1
Style: BODY_HALKU,Arial Black,90,&H00FFFFFF,&H000000FF,&H00000000,&H90000000,1,0,3,10,0,8,80,80,100,1
Style: CTA_HALKU,Arial Black,80,&H0000FFFF,&H000000FF,&H00000000,&H90000000,1,0,1,6,2,8,80,80,100,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

# ─── VIRAL HIGHLIGHT COLORS (BGR in ASS) ──────────────────────────────────────
HIGHLIGHT_COLORS = [
    "&H0000FFFF&",  # Yellow
    "&H00FFFF00&",  # Cyan
    "&H0000FF00&",  # Lime
    "&H009933FF&",  # Hot pink
    "&H00FF6600&",  # Orange
]

# ─── TIKTOK NEON ACCENT COLORS ────────────────────────────────────────────────
TIKTOK_ACCENT_COLORS = [
    "&H0000FFFF&",  # Yellow
    "&H00FF00FF&",  # Magenta
    "&H0000FF00&",  # Lime
    "&H00FF4400&",  # Blue-ish cyan
]

# ─── EMOJI MAP ────────────────────────────────────────────────────────────────
EMOJI_MAP = {
    "money": "💰", "cash": "💵", "dollar": "💲", "rich": "🤑", "wealth": "💎",
    "time": "⏳", "clock": "⏰", "wait": "✋",
    "love": "❤️", "heart": "💖", "passion": "🔥", "fire": "🔥",
    "happy": "😊", "joy": "🤩", "sad": "😢", "pain": "💔",
    "strong": "💪", "power": "🔋", "gym": "🏋️",
    "mind": "🧠", "think": "🤔", "idea": "💡",
    "stop": "🛑", "no": "❌", "danger": "⚠️",
    "go": "🚀", "run": "🏃", "fast": "⚡",
    "world": "🌍", "life": "🌱", "death": "💀",
    "king": "👑", "boss": "👔", "win": "🏆", "victory": "🥇",
    "fight": "🥊", "war": "⚔️", "peace": "✌️",
    "book": "📖", "learn": "🎓",
    "secret": "🤫", "truth": "🔍", "lie": "😈",
    "success": "🎯", "fail": "💥", "never": "🚫",
}

# ─── HELPERS ──────────────────────────────────────────────────────────────────

def srt_time_to_sec(t: str) -> float:
    h, m, s = t.replace(",", ".").split(":")
    return int(h) * 3600 + int(m) * 60 + float(s)

def sec_to_ass(t: float) -> str:
    h = int(t // 3600)
    m = int((t % 3600) // 60)
    s = t % 60
    return f"{h}:{m:02d}:{s:05.2f}"

def chunk_words(words, size=2):
    return [" ".join(words[i:i+size]) for i in range(0, len(words), size)]

def get_emoji(word):
    return EMOJI_MAP.get(word.lower().strip(".,!?\"'"), "")

# ─── STYLE BUILDERS ───────────────────────────────────────────────────────────

def build_viral_word_event(words, active_idx, pos_y, style_name, start_sec, end_sec, rotation=0):
    """
    MrBeast/TikTok yellow-box karaoke style.
    Active word: yellow opaque box + black text + extreme scale pop + fade-in.
    Other words: white outline text.
    Includes word-level fade-in/out.
    """
    parts = []
    for i, word in enumerate(words):
        emoji = get_emoji(word)
        display = word.upper() + (emoji if emoji else "")
        if i == active_idx:
            # Hard bounce: 145% burst → slight undershoot 95% → settle 100%
            pop = r"\t(0,80,\fscx145\fscy145)\t(80,180,\fscx95\fscy95)\t(180,260,\fscx100\fscy100)"
            parts.append(
                r"{\c&H00000000&\3c&H0000FFFF&\bord14" + pop + r"}" + display +
                r"{\c&H00FFFFFF&\3c&H000000&\bord5\fscx100\fscy100}"
            )
        else:
            parts.append(r"{\c&H00FFFFFF&\3c&H00000000&\bord5}" + display)

    text_line = "  ".join(parts)
    rot_tag = f"\\frz{rotation}"
    # fad(60,40) = subtle fade-in and fade-out on every word for smoothness
    ass_text = r"{\an5\pos(540," + str(pos_y) + r")" + rot_tag + r"\fad(60,40)}" + text_line
    return f"Dialogue: 0,{sec_to_ass(start_sec)},{sec_to_ass(end_sec)},{style_name},,0,0,0,,{ass_text}"


def build_clean_word_event(words, active_idx, pos_y, style_name, start_sec, end_sec, highlight_color):
    """
    Clean white text with color-highlight on active word + pop + fade.
    """
    parts = []
    for i, word in enumerate(words):
        emoji = get_emoji(word)
        display = word.upper() + (emoji if emoji else "")
        if i == active_idx:
            pop = r"\t(0,80,\fscx145\fscy145)\t(80,180,\fscx95\fscy95)\t(180,260,\fscx100\fscy100)"
            parts.append(
                r"{\fscx115\fscy115\c" + highlight_color + pop + r"}" +
                display +
                r"{\fscx100\fscy100\c&HFFFFFF&}"
            )
        else:
            parts.append(display)

    text_line = "  ".join(parts)
    ass_text = r"{\an5\pos(540," + str(pos_y) + r")\fad(60,40)}" + text_line
    return f"Dialogue: 0,{sec_to_ass(start_sec)},{sec_to_ass(end_sec)},{style_name},,0,0,0,,{ass_text}"


def build_tiktok_word_event(words, active_idx, pos_y, style_name, start_sec, end_sec, accent_color, rotation=0):
    """
    TikTok neon-stroke style: white text, thick blue outline (no box).
    Active word: accent color + bigger scale + fade transitions.
    """
    parts = []
    for i, word in enumerate(words):
        emoji = get_emoji(word)
        display = word.upper() + (emoji if emoji else "")
        if i == active_idx:
            # Hard bounce + color switch to accent
            pop = r"\t(0,80,\fscx145\fscy145)\t(80,180,\fscx95\fscy95)\t(180,260,\fscx100\fscy100)"
            parts.append(
                r"{\c" + accent_color + r"\3c&H000000FF&\bord8" + pop + r"}" +
                display +
                r"{\c&H00FFFFFF&\3c&H000000FF&\bord8\fscx100\fscy100}"
            )
        else:
            parts.append(r"{\c&H00FFFFFF&\3c&H000000FF&\bord8}" + display)

    text_line = "  ".join(parts)
    rot_tag = f"\\frz{rotation}"
    ass_text = r"{\an5\pos(540," + str(pos_y) + r")" + rot_tag + r"\fad(60,40)}" + text_line
    return f"Dialogue: 0,{sec_to_ass(start_sec)},{sec_to_ass(end_sec)},{style_name},,0,0,0,,{ass_text}"


def build_halku_word_event(words, active_idx, pos_y, style_name, start_sec, end_sec):
    """
    Halku style: White text inside a black translucent box. 
    Top-center alignment (an8). No pop animation for clean readability.
    """
    parts = []
    for i, word in enumerate(words):
        emoji = get_emoji(word)
        display = word.upper() + (emoji if emoji else "")
        if i == active_idx:
            # Subtle scale up for active word, but keep it clean
            parts.append(r"{\fscx105\fscy105\c&HFFFFFF&}" + display + r"{\fscx100\fscy100}")
        else:
            parts.append(display)

    text_line = " ".join(parts)
    # an8 = top-center, pos(540, 150) = near top
    ass_text = r"{\an8\pos(540," + str(pos_y) + r")\fad(60,40)}" + text_line
    return f"Dialogue: 0,{sec_to_ass(start_sec)},{sec_to_ass(end_sec)},{style_name},,0,0,0,,{ass_text}"


# ─── MAIN GENERATOR ───────────────────────────────────────────────────────────

def generate_animated_ass(srt_path: str, ass_path: str, caption_style: str = "viral"):
    """
    Generate a viral animated ASS subtitle file from an SRT file.

    Args:
        srt_path: Path to the input .srt file
        ass_path: Path to write the output .ass file
        caption_style: "viral" (yellow box, MrBeast), "clean" (white + highlight), or "tiktok" (neon stroke)
    """
    with open(srt_path, "r", encoding="utf-8") as f:
        blocks = f.read().strip().split("\n\n")

    events = []
    total_blocks = len(blocks)
    style_lower = caption_style.lower()
    use_viral  = style_lower == "viral"
    use_tiktok = style_lower == "tiktok"

    highlight_color = random.choice(HIGHLIGHT_COLORS)
    tiktok_accent   = random.choice(TIKTOK_ACCENT_COLORS)

    # Suffix for style names
    if use_viral:
        suffix = "VIRAL"
    elif use_tiktok:
        suffix = "TIKTOK"
    elif style_lower == "halku":
        suffix = "HALKU"
    else:
        suffix = "CLEAN"

    for idx, block in enumerate(blocks):
        lines = block.splitlines()
        if len(lines) < 3:
            continue

        try:
            start_raw, end_raw = lines[1].split(" --> ")
        except ValueError:
            continue

        text = " ".join(lines[2:]).strip().replace("{", "").replace("}", "")
        if not text:
            continue

        start_sec = srt_time_to_sec(start_raw.strip())
        end_sec   = srt_time_to_sec(end_raw.strip())
        duration  = max(end_sec - start_sec, 0.3)
        dur_ms    = int(duration * 1000)

        is_hook = idx == 0
        is_cta  = idx == total_blocks - 1

        # ── HOOK: Big animated entrance ────────────────────────────────
        if is_hook:
            style  = f"HOOK_{suffix}"
            pos_y  = 1440  # 75% down from 1920 height
            rot    = random.randint(-1, 1)

            emoji_words = []
            for w in text.split():
                emoji = get_emoji(w)
                emoji_words.append(w.upper() + (emoji if emoji else ""))
            hook_text = "  ".join(emoji_words)

            if use_viral:
                # Shake effect: quick rotation oscillation + scale entrance + fade-in
                shake = r"\t(0,80,\frz2)\t(80,160,\frz-2)\t(160,240,\frz0)"
                entrance = r"\fscx130\fscy130\t(0,300,\fscx100\fscy100)"
                ass_text = (
                    r"{\an5\pos(540," + str(pos_y) + r")\fad(100,80)\frz" + str(rot) +
                    entrance + shake +
                    r"\c&H00000000&\3c&H0000FFFF&\bord14}" +
                    hook_text
                )
            elif use_tiktok:
                entrance = r"\fscx130\fscy130\t(0,300,\fscx100\fscy100)"
                ass_text = (
                    r"{\an5\pos(540," + str(pos_y) + r")\fad(100,80)\frz" + str(rot) +
                    entrance +
                    r"\c" + tiktok_accent + r"\3c&H000000FF&\bord8}" +
                    hook_text
                )
            else:
                entrance = r"\fscx130\fscy130\t(0,300,\fscx100\fscy100)"
                ass_text = (
                    r"{\an5\pos(540," + str(pos_y) + r")\fad(100,80)\frz" + str(rot) +
                    entrance +
                    r"\c&H0000FFFF&}" +
                    hook_text
                )
            events.append(f"Dialogue: 0,{sec_to_ass(start_sec)},{sec_to_ass(end_sec)},{style},,0,0,0,,{ass_text}")
            continue

        # ── CTA: Pulsing scale animation + fade ────────────────────────
        if is_cta:
            style = f"CTA_{suffix}"
            pos_y = 1440  # 75% down from 1920 height
            # Continuous slow pulse: grow then shrink
            pulse = (
                r"\t(0," + str(dur_ms // 2) + r",\fscx112\fscy112)" +
                r"\t(" + str(dur_ms // 2) + r"," + str(dur_ms) + r",\fscx100\fscy100)"
            )
            if use_viral:
                ass_text = (
                    r"{\an5\pos(540," + str(pos_y) + r")\fad(200,200)" + pulse +
                    r"\c&H0000FFFF&}" + text.upper()
                )
            elif use_tiktok:
                ass_text = (
                    r"{\an5\pos(540," + str(pos_y) + r")\fad(200,200)" + pulse +
                    r"\c" + tiktok_accent + r"\3c&H000000FF&\bord8}" + text.upper()
                )
            elif style_lower == "halku":
                ass_text = (
                    r"{\an8\pos(540," + str(pos_y) + r")\fad(200,200)" + pulse +
                    r"\c&H0000FFFF&}" + text.upper()
                )
            else:
                ass_text = (
                    r"{\an5\pos(540," + str(pos_y) + r")\fad(200,200)" + pulse +
                    r"\c&H0000FFFF&}" + text.upper()
                )
            events.append(f"Dialogue: 0,{sec_to_ass(start_sec)},{sec_to_ass(end_sec)},{style},,0,0,0,,{ass_text}")
            continue

        # ── BODY: Word-by-word karaoke ─────────────────────────────────
        style = f"BODY_{suffix}"
        words = text.split()
        chunks = chunk_words(words, size=1)  # 1-word-at-a-time for Vid.AI style
        chunk_dur = duration / max(len(chunks), 1)

        # Organic Y variation: positioned at 75% down the screen
        base_y = random.randint(1420, 1460)

        for ci, chunk_str in enumerate(chunks):
            chunk_words_list = chunk_str.split()
            num_words = len(chunk_words_list)
            word_dur = chunk_dur / max(num_words, 1)
            c_start = start_sec + ci * chunk_dur

            for wi, active_word in enumerate(chunk_words_list):
                w_start = c_start + wi * word_dur
                w_end   = min(w_start + word_dur, end_sec)
                rot     = random.randint(-2, 2)

                if use_viral:
                    ev = build_viral_word_event(
                        chunk_words_list, wi, base_y, style, w_start, w_end, rot
                    )
                elif use_tiktok:
                    ev = build_tiktok_word_event(
                        chunk_words_list, wi, base_y, style, w_start, w_end, tiktok_accent, rot
                    )
                elif style_lower == "halku":
                    # For Halku, we use an8 (Top-Center), so pos_y should be high up
                    ev = build_halku_word_event(
                        chunk_words_list, wi, 150, style, w_start, w_end
                    )
                else:
                    ev = build_clean_word_event(
                        chunk_words_list, wi, base_y, style, w_start, w_end, highlight_color
                    )
                events.append(ev)

    with open(ass_path, "w", encoding="utf-8") as f:
        f.write(ASS_HEADER + "\n".join(events))

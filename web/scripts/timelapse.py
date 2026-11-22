"""Timestamped screencast frames to an animated WebP time-lapse, with the speed stamped on every sped-up frame.

    timelapse.py <frames-dir> <out.webp> <width> <fps> <start:end:speed>...

Frames are named `f<n>_<seconds>.jpg` (seconds on the recording's clock). Each segment plays [start, end) at `speed`;
a frame that does not change between ticks is held rather than repeated. Run by `capture-proposals.cjs` and
`capture-drawings.cjs` with the server's Python (Pillow). Settings from the environment:

- BADGE="x,y" places the speed label (fractions of the frame; y is its bottom edge), or "none" for no label (the
  page around it then says the clip is sped up); BADGE_PX sets its text size.
- CROP="x0,y0,x1,y1" keeps that part of each frame (fractions of it) before scaling to `width`.
- STILL=<path> also writes the last frame as a still WebP (the picture for people who ask for less motion).
- Q is the WebP quality (65).
- MP4=<path> also writes the same pace as an H.264 MP4 through ffmpeg (yuv420p, faststart: for a video editor or a
  player): MP4_FPS frames a second (30), MP4_WIDTH wide (default: the frames' own width, cropped), the speed label at
  the same place, scaled to the width, and the end held as long as the WebP's.
"""
import bisect
import os
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFont

# A bold sans for the label: Linux (the cloud session), Windows, macOS; Pillow's own font if none is there.
FONTS = ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "C:/Windows/Fonts/segoeuib.ttf",
         "/System/Library/Fonts/Supplemental/Arial Bold.ttf"]
HOLD_MS = 2500   # the end, held before the clip loops (or the video ends)


def load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path in FONTS:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default(size)


def load(src: str, name: str, crop: tuple[float, ...] | None) -> Image.Image:
    im = Image.open(os.path.join(src, name)).convert("RGB")
    if crop:
        im = im.crop((round(crop[0] * im.width), round(crop[1] * im.height),
                      round(crop[2] * im.width), round(crop[3] * im.height)))
    return im


def stamp(frame: Image.Image, speed: float, font, at: tuple[float, float]) -> None:
    """The speed label, its bottom-left corner at `at` (fractions of the frame)."""
    draw = ImageDraw.Draw(frame)
    text = f"{speed:g}× speed"
    x0, y0, x1, y1 = draw.textbbox((0, 0), text, font=font)
    pad = max(6, round(font.size * 0.3)) if hasattr(font, "size") else 6
    x, y = round(at[0] * frame.width), round(at[1] * frame.height) - (y1 - y0) - 2 * pad
    draw.rounded_rectangle((x, y, x + x1 - x0 + 2 * pad, y + y1 - y0 + 2 * pad), 8, fill=(15, 30, 50))
    draw.text((x + pad - x0, y + pad - y0), text, font=font, fill=(255, 255, 255))


def main(src: str, out: str, width: int, fps: float, segments: list[tuple[float, float, float]]) -> None:
    files = sorted(f for f in os.listdir(src) if f.endswith(".jpg"))
    stamps = [float(f.rsplit("_", 1)[1][:-4]) for f in files]
    font = load_font(int(os.environ.get("BADGE_PX") or max(13, round(22 * width / 1440))))
    badge = os.environ.get("BADGE", "0.02,0.97")
    bx, by = map(float, badge.split(",")) if badge != "none" else (0.0, 0.0)
    crop = tuple(map(float, os.environ["CROP"].split(","))) if os.environ.get("CROP") else None
    frames: list[Image.Image] = []
    durations: list[float] = []
    cached: tuple[int, Image.Image] | None = None
    last = None
    for start, end, speed in segments:
        t = start
        while t < end:
            i = max(0, bisect.bisect_right(stamps, t) - 1)
            if cached is None or cached[0] != i:
                im = load(src, files[i], crop)
                cached = (i, im.resize((width, round(im.height * width / im.width)), Image.LANCZOS))
            if (i, speed) == last:
                durations[-1] += 1000 / fps
            else:
                frame = cached[1].copy()
                if speed != 1 and badge != "none":
                    stamp(frame, speed, font, (bx, by))
                frames.append(frame)
                durations.append(1000 / fps)
                last = (i, speed)
            t += speed / fps
    durations[-1] += HOLD_MS
    frames[0].save(out, save_all=True, append_images=frames[1:], duration=[round(d) for d in durations], loop=0,
                   quality=int(os.environ.get("Q", "65")), method=4)
    print(f"{out}: {len(frames)} frames, {sum(durations) / 1000:.1f} s, {os.path.getsize(out) // 1024} KB")
    if os.environ.get("STILL"):
        still = os.environ["STILL"]
        cached[1].save(still, "WEBP", quality=80, method=6)   # the last frame without its speed label
        print(f"{still}: {os.path.getsize(still) // 1024} KB")
    if os.environ.get("MP4"):
        mp4(src, files, stamps, segments, crop, badge, (bx, by), width, os.environ["MP4"])


def mp4(src: str, files: list[str], stamps: list[float], segments: list[tuple[float, float, float]],
        crop: tuple[float, ...] | None, badge: str, at: tuple[float, float], webp_width: int, out: str) -> None:
    """The same pace as an H.264 MP4: every tick of MP4_FPS written (a player needs a steady rate), frames streamed
    to ffmpeg as they are made."""
    fps = float(os.environ.get("MP4_FPS") or 30)
    first = load(src, files[0], crop)
    width = int(os.environ.get("MP4_WIDTH") or first.width) // 2 * 2   # H.264 in 4:2:0 wants even sides
    height = round(first.height * width / first.width) // 2 * 2
    badge_px = int(os.environ.get("BADGE_PX") or max(13, round(22 * webp_width / 1440)))
    font = load_font(max(13, round(badge_px * width / webp_width)))
    cmd = ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{width}x{height}",
           "-r", f"{fps:g}", "-i", "-", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
           "-movflags", "+faststart", out]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    last, buf, n = None, b"", 0
    for start, end, speed in segments:
        t = start
        while t < end:
            i = max(0, bisect.bisect_right(stamps, t) - 1)
            if (i, speed) != last:
                frame = load(src, files[i], crop).resize((width, height), Image.LANCZOS)
                if speed != 1 and badge != "none":
                    stamp(frame, speed, font, at)
                buf, last = frame.tobytes(), (i, speed)
            proc.stdin.write(buf)
            n += 1
            t += speed / fps
    if last is not None and last[1] != 1:   # the held end without its speed label, as the still
        buf = load(src, files[last[0]], crop).resize((width, height), Image.LANCZOS).tobytes()
    for _ in range(round(HOLD_MS / 1000 * fps)):
        proc.stdin.write(buf)
        n += 1
    proc.stdin.close()
    if proc.wait():
        sys.exit(f"ffmpeg failed writing {out}")
    print(f"{out}: {width}x{height}, {n / fps:.1f} s at {fps:g} fps, {os.path.getsize(out) // 1024} KB")


if __name__ == "__main__":
    a = sys.argv[1:]
    main(a[0], a[1], int(a[2]), float(a[3]), [tuple(map(float, s.split(":"))) for s in a[4:]])

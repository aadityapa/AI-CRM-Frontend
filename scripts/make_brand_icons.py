"""Build every Karnex Orbit icon from the master logo (frontend/assets/brand/karnex-orbit-logo.png).

    python scripts/make_brand_icons.py [path/to/logo.png]

Favicons (tab / Google): transparent, logo cropped tight and centred.
Home-screen icons (apple-touch, 192, 512): the same logo on a dark rounded tile —
iOS and Android fill transparency with black/white, which loses the silver strokes.
"""
import base64, io, sys
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1] / "frontend"
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "assets" / "brand" / "karnex-orbit-logo.png"
TILE = (11, 16, 38, 255)          # deep navy behind the logo on home-screen tiles

def square(logo: Image.Image, pad: float) -> Image.Image:
    # crop on solid pixels, ignoring the faint outer glow
    bbox = logo.split()[3].point(lambda a: 255 if a > 60 else 0).getbbox()
    art = logo.crop(bbox)
    side = int(max(art.size) * (1 + 2 * pad))
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(art, ((side - art.width) // 2, (side - art.height) // 2), art)
    return canvas

def favicon(size, base):  return base.resize((size, size), Image.LANCZOS)

def tile(size, base):
    t = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(t).rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * 0.22), fill=TILE)
    inner = base.resize((int(size * 0.84),) * 2, Image.LANCZOS)
    off = (size - inner.width) // 2
    t.alpha_composite(inner, (off, off))
    return t

def build(out: Path):
    logo = Image.open(SRC).convert("RGBA")
    fav = square(logo, 0.02)
    home = square(logo, 0.0)
    brand = out / "assets" / "brand"
    brand.mkdir(parents=True, exist_ok=True)
    favicon(48, fav).save(out / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)],
                          append_images=[favicon(16, fav), favicon(32, fav)])
    favicon(48, fav).save(brand / "favicon-48x48.png")
    favicon(96, fav).save(brand / "favicon-96x96.png")
    tile(180, home).save(brand / "apple-touch-icon.png")
    tile(192, home).save(brand / "icon-192.png")
    tile(512, home).save(brand / "icon-512.png")
    buf = io.BytesIO(); favicon(128, fav).save(buf, "PNG", optimize=True)
    b64 = base64.b64encode(buf.getvalue()).decode()
    (out / "favicon.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
        'viewBox="0 0 128 128" role="img" aria-label="Karnex Orbit">'
        f'<image width="128" height="128" href="data:image/png;base64,{b64}"/></svg>\n')

if __name__ == "__main__":
    build(ROOT)
    print("icons written to", ROOT)

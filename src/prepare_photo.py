# Prépare la photo de nuit du pont pour le héro du site.
# - retire le bandeau de texte incrusté en haut de l'image d'origine
# - produit deux largeurs (mobile / grand écran) en JPEG progressif optimisé
#
# Usage : python src/prepare_photo.py <image_source>
import os
import sys

from PIL import Image

SRC = sys.argv[1] if len(sys.argv) > 1 else None
if not SRC or not os.path.isfile(SRC):
    raise SystemExit("usage : python src/prepare_photo.py <image_source>")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "assets")
os.makedirs(OUT_DIR, exist_ok=True)

# Le titre incrusté occupe la bande supérieure de l'image d'origine.
# On coupe 135 px sur 896, soit 15 % de la hauteur : le texte disparaît,
# le ciel bleu nuit et la ligne des quais sont conservés.
CROP_TOP = 135

img = Image.open(SRC).convert("RGB")
w, h = img.size
print(f"source : {w}x{h}")

img = img.crop((0, CROP_TOP, w, h))
w, h = img.size
print(f"recadrée : {w}x{h} (bandeau de texte retiré)")

for width in (1200, 760):
    if width > w:
        resized = img
    else:
        resized = img.resize((width, round(h * width / w)), Image.LANCZOS)
    path = os.path.join(OUT_DIR, f"pont-nuit-{width}.jpg")
    resized.save(path, "JPEG", quality=82, optimize=True, progressive=True)
    size_ko = os.path.getsize(path) / 1024
    print(f"{os.path.basename(path)} : {resized.size[0]}x{resized.size[1]}, {size_ko:.0f} Ko")

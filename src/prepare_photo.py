# Prépare une photo du pont pour le héro du site.
# Retire la bande de texte incrustée (titre en haut, légende en bas selon la source),
# puis produit deux largeurs en JPEG progressif optimisé.
#
# Usage :
#   python src/prepare_photo.py <source> --nom pont-nuit --haut 135
#   python src/prepare_photo.py <source> --nom pont-jour --bas 55
import argparse
import os

from PIL import Image

parser = argparse.ArgumentParser(description="Prépare une photo du héro.")
parser.add_argument("source", help="image d'origine (jpg, png, webp…)")
parser.add_argument("--nom", required=True, help="préfixe des fichiers produits, ex. pont-nuit")
parser.add_argument("--haut", type=int, default=0, help="pixels à retirer en haut")
parser.add_argument("--bas", type=int, default=0, help="pixels à retirer en bas")
parser.add_argument("--largeurs", type=int, nargs="+", default=[1200, 760])
args = parser.parse_args()

if not os.path.isfile(args.source):
    raise SystemExit(f"introuvable : {args.source}")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "assets")
os.makedirs(OUT_DIR, exist_ok=True)

img = Image.open(args.source).convert("RGB")
w, h = img.size
print(f"source : {w}x{h}")

if args.haut or args.bas:
    img = img.crop((0, args.haut, w, h - args.bas))
    w, h = img.size
    print(f"recadree : {w}x{h} (texte incruste retire)")

for width in args.largeurs:
    resized = img if width >= w else img.resize((width, round(h * width / w)), Image.LANCZOS)
    path = os.path.join(OUT_DIR, f"{args.nom}-{width}.jpg")
    resized.save(path, "JPEG", quality=82, optimize=True, progressive=True)
    print(f"{os.path.basename(path)} : {resized.size[0]}x{resized.size[1]}, {os.path.getsize(path) / 1024:.0f} Ko")

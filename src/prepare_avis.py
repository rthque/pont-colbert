# Prépare l'avis officiel de la Capitainerie affiché derrière le bouton « Règles ».
# Copie le PDF d'origine dans docs/ et en rend chaque page en image, seul format qui
# s'affiche de façon fiable dans une fenêtre sur tous les téléphones.
#
# Usage : python src/prepare_avis.py "chemin/vers/avis.pdf"
import os
import shutil
import sys

import fitz  # PyMuPDF

SRC = sys.argv[1] if len(sys.argv) > 1 else None
if not SRC or not os.path.isfile(SRC):
    raise SystemExit('usage : python src/prepare_avis.py "<avis.pdf>"')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(ROOT, "docs")
os.makedirs(DOCS, exist_ok=True)

NOM_PDF = "avis-ouverture-pont-colbert.pdf"
LARGEUR = 1000  # px : lisible en plein écran sur mobile sans alourdir la page

shutil.copyfile(SRC, os.path.join(DOCS, NOM_PDF))
print(f"{NOM_PDF} : {os.path.getsize(os.path.join(DOCS, NOM_PDF)) / 1024:.0f} Ko")

for ancien in os.listdir(DOCS):
    if ancien.startswith("avis-page-") and ancien.endswith(".jpg"):
        os.remove(os.path.join(DOCS, ancien))

doc = fitz.open(SRC)
for i, page in enumerate(doc, start=1):
    zoom = LARGEUR / page.rect.width
    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom))
    chemin = os.path.join(DOCS, f"avis-page-{i}.jpg")
    pix.pil_save(chemin, "JPEG", quality=80, optimize=True, progressive=True)
    print(f"avis-page-{i}.jpg : {pix.width}x{pix.height}, {os.path.getsize(chemin) / 1024:.0f} Ko")

print(f"{doc.page_count} page(s)")

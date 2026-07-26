# Efface le titre incrusté en haut de la photo nocturne du pont.
#
# La photo d'origine porte « LE PONT COLBERT DE DIEPPE / LE CŒUR BATTANT DE LA NUIT ».
# Rogner suffirait à le supprimer, mais emporterait le front de mer, justement joli de
# nuit — et surtout donnerait à la photo nocturne un format différent de la photo diurne,
# alors que les deux sont cadrées à l'identique en 1195x896. Or object-fit: cover recadre
# selon le rapport de l'image : deux rapports différents, c'est un pont qui saute d'une
# position à l'autre au changement de thème, d'un écart qui varie avec la taille de
# l'écran. Le texte est donc reconstruit, pas rogné.
#
# Il repose entièrement sur le ciel : les toits ne commencent qu'à y ~ 110.
#
# Deux précautions, tirées d'une première version ratée :
#
#  - le masque compare chaque pixel à la médiane d'une fenêtre horizontale, pas à celle de
#    la ligne entière. Le ciel garde une lueur de couchant sur la droite ; mesurée sur la
#    ligne entière, cette lueur passait pour du texte et se faisait effacer, laissant un
#    rectangle plus clair ;
#  - le remplissage résout une équation de Laplace sur la zone masquée, les pixels
#    conservés servant de conditions aux limites. Une interpolation horizontale ligne à
#    ligne, elle, traitait chaque ligne indépendamment et laissait des traînées.
#
# Usage : python src/efface_titre.py <photo-source.jpg> [-s sortie.jpg]
import argparse
import os

import numpy as np
from numpy.lib.stride_tricks import sliding_window_view
from PIL import Image

# Zone fouillée. Relevé sur la photo d'origine : le sous-titre occupe les lignes 87 à 108,
# les toits commencent à la ligne 109. La zone doit couvrir la ligne 108 comprise — s'y
# arrêter une ligne trop tôt laisse du texte juste sous le masque, et la diffusion remonte
# alors sa clarté dans le ciel en halos. La borne droite laisse de côté l'immeuble haut du
# bord droit, qui monte jusqu'à y ~ 57.
X0, X1, Y0, Y1 = 150, 1050, 10, 109
RAYON = 30       # demi-largeur de la fenêtre de médiane locale
ECART = 22       # écart à cette médiane au-delà duquel un pixel est du texte
MARGE = 4        # dilatation du masque, pour attraper l'anticrénelage des lettres
ITERATIONS = 3000
GRAIN = 1.2      # bruit rendu au ciel reconstruit, pour ne pas trancher avec le reste


def masque_texte(band):
    """Pixels s'écartant nettement du ciel local, dilatés."""
    h, l, _ = band.shape
    pad = np.pad(band, ((0, 0), (RAYON, RAYON), (0, 0)), mode="edge")
    ecarts = np.zeros((h, l), dtype=np.float64)
    for c in range(3):
        fenetres = sliding_window_view(pad[:, :, c], 2 * RAYON + 1, axis=1)
        mediane = np.median(fenetres, axis=-1)
        ecarts = np.maximum(ecarts, np.abs(band[:, :, c] - mediane))

    m = ecarts > ECART

    # dilatation par décalages francs : np.roll ferait réapparaître en haut de la zone ce
    # qui déborde en bas, donc du masque au milieu du ciel
    dilate = np.zeros_like(m)
    for dy in range(-MARGE, MARGE + 1):
        src_y = slice(max(0, -dy), h - max(0, dy))
        dst_y = slice(max(0, dy), h - max(0, -dy))
        for dx in range(-MARGE, MARGE + 1):
            src_x = slice(max(0, -dx), l - max(0, dx))
            dst_x = slice(max(0, dx), l - max(0, -dx))
            dilate[dst_y, dst_x] |= m[src_y, src_x]
    return dilate


def efface(source, sortie):
    im = Image.open(source).convert("RGB")
    if im.width < X1 or im.height < Y1:
        raise SystemExit(f"{source} : {im.width}x{im.height}, trop petite pour la zone de texte")

    pixels = np.asarray(im, dtype=np.float64)

    # on travaille sur une bande plus large que la zone : les pixels conservés du pourtour
    # fournissent les conditions aux limites du remplissage
    hy0, hy1 = max(0, Y0 - 12), min(im.height, Y1 + 22)
    hx0, hx1 = max(0, X0 - 40), min(im.width, X1 + 40)
    band = pixels[hy0:hy1, hx0:hx1].copy()

    m = np.zeros(band.shape[:2], dtype=bool)
    m[Y0 - hy0:Y1 - hy0, X0 - hx0:X1 - hx0] = masque_texte(
        band[Y0 - hy0:Y1 - hy0, X0 - hx0:X1 - hx0]
    )
    # le bord de la bande doit rester intact : c'est lui qui fixe les valeurs aux limites
    m[0, :] = m[-1, :] = m[:, 0] = m[:, -1] = False
    if not m.any():
        raise SystemExit("aucun texte détecté — la photo est-elle bien l'originale ?")

    travail = band.copy()
    for _ in range(ITERATIONS):
        moyenne = (travail[:-2, 1:-1] + travail[2:, 1:-1]
                   + travail[1:-1, :-2] + travail[1:-1, 2:]) / 4.0
        interieur = m[1:-1, 1:-1]
        travail[1:-1, 1:-1][interieur] = moyenne[interieur]

    grain = np.random.default_rng(0).normal(0.0, GRAIN, travail.shape)
    travail[m] += grain[m]

    band[m] = travail[m]
    pixels[hy0:hy1, hx0:hx1] = band

    Image.fromarray(np.clip(pixels, 0, 255).astype(np.uint8)).save(
        sortie, quality=95, subsampling=0
    )
    print(f"{os.path.basename(sortie)} : {im.width}x{im.height}, "
          f"{int(m.sum())} pixels de ciel reconstruits")


if __name__ == "__main__":
    p = argparse.ArgumentParser(description="Efface le titre incrusté de la photo nocturne.")
    p.add_argument("source")
    p.add_argument("-s", "--sortie", default=None)
    a = p.parse_args()
    efface(a.source, a.sortie or os.path.splitext(a.source)[0] + "-sans-titre.jpg")

// Alias de /api/statut sous le nom demandé par les intégrations tierces : /status.json.
//
// Une seule implémentation, deux adresses. Pages route un fichier de fonction d'après son
// chemin privé de « .js » : « status.json.js » répond donc sur « /status.json ».
export { onRequestGet } from './api/statut.js';

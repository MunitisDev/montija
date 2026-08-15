/**
 * Every player-facing string, in every language.
 *
 * Done now rather than "once there are menus", because retrofitting
 * translation means revisiting every file that ever wrote text. Establishing
 * the pattern while the UI is small is far cheaper than doing it later.
 *
 * No i18n library: the brief says keep dependencies minimal, and a typed
 * record with a lookup function is all this needs. `Messages` is derived from
 * English, so a missing Spanish key is a compile error rather than a blank
 * label discovered by a player.
 */

export const EN = {
  'hud.population': 'Pop',
  'hud.food': 'Food',
  'hud.logs': 'Logs',
  'hud.firewood': 'Firewood',
  'hud.stone': 'Stone',
  'hud.looseHint': 'on the ground, waiting to be carried in',

  'season.spring': 'Spring',
  'season.summer': 'Summer',
  'season.autumn': 'Autumn',
  'season.winter': 'Winter',
  'time.yearShort': 'Y',
  'time.dayShort': 'd',

  'terrain.grass': 'Grass',
  'terrain.meadow': 'Meadow',
  'terrain.forest': 'Forest',
  'terrain.water': 'Water',
  'terrain.stone': 'Rock',
  'terrain.tree': 'Tree',
  'terrain.stoneDeposit': 'Stone deposit',
  'terrain.impassable': 'impassable',
  'terrain.cannotBuild': 'cannot build',

  'action.fell': 'Fell',
  'action.mine': 'Mine',
  'action.cancel': 'Cancel',
  'action.place': 'Place',
  'action.save': 'Save',
  'action.load': 'Load',

  'status.markedForFelling': 'marked for felling',
  'status.markedForMining': 'marked for mining',
  'status.saved': 'Saved',
  'status.loaded': 'Loaded',
  'status.noSave': 'No saved settlement',
  'status.saveOtherVersion': 'Save is from another version',
  'status.saveUnreadable': 'Save is unreadable',
  'status.saveFailed': 'Save failed',
  'status.loadFailed': 'Load failed',

  'villager.age': 'age',
  'villager.idle': 'idle',
  'villager.walking': 'walking',
  'villager.working': 'working',
  'villager.hauling': 'hauling',

  'building.house': 'House',
  'building.house.description': 'Shelter for a family. Keeps its residents warm in winter.',
  'building.storage-yard': 'Storage Yard',
  'building.storage-yard.description': 'Holds logs, stone and firewood.',
  'building.food-storage': 'Food Storage',
  'building.food-storage.description': 'Keeps the settlement’s food through the winter.',
  'building.gatherer-hut': 'Gatherer Hut',
  'building.gatherer-hut.description': 'Workers forage the woods for food. Your only food source.',
  'building.woodcutter': 'Woodcutter',
  'building.woodcutter.description': 'Splits logs into firewood, which keeps houses warm.',

  'placement.offMap': 'beyond the map',
  'placement.blockedTerrain': 'ground will not take it',
  'placement.occupied': 'something is already here',
  'placement.treesInTheWay': 'clear the trees first',

  'warning.foodLow': 'Nobody is gathering food — build a Gatherer Hut',
  'warning.needMoreHuts': 'One hut cannot feed everyone — build another Gatherer Hut',
  'warning.foodSpoiling': 'Food is rotting in the open — build a Food Storage',
  'warning.firewoodLow': 'No firewood for the winter — build a Woodcutter',
  'warning.firewoodShort': 'Not enough firewood to last the winter',
  'warning.starving': 'People are starving',

  'app.rotate': 'Rotate your device for the best view',
  'app.noscript': 'Montija needs JavaScript and WebGL to run.',
} as const;

export type MessageKey = keyof typeof EN;
export type Messages = Record<MessageKey, string>;

export const ES: Messages = {
  'hud.population': 'Pobl',
  'hud.food': 'Comida',
  'hud.logs': 'Troncos',
  'hud.firewood': 'Leña',
  'hud.stone': 'Piedra',
  'hud.looseHint': 'en el suelo, esperando a que lo lleven al almacén',

  'season.spring': 'Primavera',
  'season.summer': 'Verano',
  'season.autumn': 'Otoño',
  'season.winter': 'Invierno',
  'time.yearShort': 'A',
  'time.dayShort': 'd',

  'terrain.grass': 'Hierba',
  'terrain.meadow': 'Pradera',
  'terrain.forest': 'Bosque',
  'terrain.water': 'Agua',
  'terrain.stone': 'Roca',
  'terrain.tree': 'Árbol',
  'terrain.stoneDeposit': 'Yacimiento de piedra',
  'terrain.impassable': 'intransitable',
  'terrain.cannotBuild': 'no se puede construir',

  'action.fell': 'Talar',
  'action.mine': 'Picar',
  'action.cancel': 'Cancelar',
  'action.place': 'Colocar',
  'action.save': 'Guardar',
  'action.load': 'Cargar',

  'status.markedForFelling': 'marcado para talar',
  'status.markedForMining': 'marcado para picar',
  'status.saved': 'Guardado',
  'status.loaded': 'Cargado',
  'status.noSave': 'No hay partida guardada',
  'status.saveOtherVersion': 'La partida es de otra versión',
  'status.saveUnreadable': 'La partida no se puede leer',
  'status.saveFailed': 'Fallo al guardar',
  'status.loadFailed': 'Fallo al cargar',

  'villager.age': 'edad',
  'villager.idle': 'sin tarea',
  'villager.walking': 'caminando',
  'villager.working': 'trabajando',
  'villager.hauling': 'acarreando',

  'building.house': 'Casa',
  'building.house.description': 'Refugio para una familia. Mantiene el calor en invierno.',
  'building.storage-yard': 'Almacén',
  'building.storage-yard.description': 'Guarda troncos, piedra y leña.',
  'building.food-storage': 'Despensa',
  'building.food-storage.description': 'Conserva la comida del asentamiento durante el invierno.',
  'building.gatherer-hut': 'Cabaña de recolección',
  'building.gatherer-hut.description':
    'Los trabajadores recolectan comida del bosque. Tu única fuente de comida.',
  'building.woodcutter': 'Leñador',
  'building.woodcutter.description': 'Parte troncos en leña, que da calor a las casas.',

  'placement.offMap': 'fuera del mapa',
  'placement.blockedTerrain': 'el terreno no lo admite',
  'placement.occupied': 'ya hay algo aquí',
  'placement.treesInTheWay': 'tala los árboles primero',

  'warning.foodLow': 'Nadie recolecta comida: construye una Cabaña de recolección',
  'warning.needMoreHuts': 'Una cabaña no alimenta a todos: construye otra Cabaña de recolección',
  'warning.foodSpoiling': 'La comida se pudre a la intemperie: construye una Despensa',
  'warning.firewoodLow': 'No hay leña para el invierno: construye un Leñador',
  'warning.firewoodShort': 'No hay leña suficiente para pasar el invierno',
  'warning.starving': 'La gente está pasando hambre',

  'app.rotate': 'Gira el dispositivo para ver mejor',
  'app.noscript': 'Montija necesita JavaScript y WebGL para funcionar.',
};

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Permite conexiones desde cualquier origen (móviles/web)
    methods: ["GET", "POST"]
  }
});

// Estructura de Palos y Cartas
const PALOS = {
  BH:  { id: 'BH',  nombre: 'BOMBA HYD',   icono: '⚙️' },
  RS:  { id: 'RS',  nombre: 'REDUCTOR',    icono: '🌀' },
  CP:  { id: 'CP',  nombre: 'CILINDRO',    icono: '🚀' },
  RO:  { id: 'RO',  nombre: 'RODAMIENTO',  icono: '🔘' },
  PLC: { id: 'PLC', nombre: 'PLC',         icono: '💻' },
  EV:  { id: 'EV',  nombre: 'ELECTROVALV', icono: '⚡' }
};

function generateDeck() {
  const deck = [];
  let id = 1;
  const addCard = (paloId, desc, type, rule) => deck.push({ id: id++, suit: paloId, desc, type, rule });
  const suits = Object.keys(PALOS);

  suits.forEach(s => addCard(s, `+10 pts si tienes MÁS ${PALOS[s].nombre}`, 'MAX_SUIT', { suit: s, pts: 10 }));
  suits.forEach(s => addCard(s, `+7 pts si tienes MENOS ${PALOS[s].nombre}`, 'MIN_SUIT', { suit: s, pts: 7 }));
  const c3 = [['BH','RS','CP'], ['RS','CP','RO'], ['CP','RO','PLC'], ['RO','PLC','EV'], ['PLC','EV','BH'], ['EV','BH','RS']];
  c3.forEach(c => addCard(c[0], `+4 ${c[0]}, -2 ${c[1]}, -2 ${c[2]}`, 'COMBO_3', { pos: [[c[0],4]], neg: [[c[1],2],[c[2],2]] }));
  suits.forEach(s => addCard(s, `+8 pts por cada 3 ${PALOS[s].nombre}`, 'TRIO_SAME', { suit: s, pts: 8 }));
  suits.forEach(s => addCard(s, `+2 pts por cada ${PALOS[s].nombre}`, 'MULTIPLIER', { suit: s, pts: 2 }));
  addCard('BH', `+12 pts por cada set completo (1 de cada palo)`, 'FULL_SET', { pts: 12 });
  const c7 = [['RS','CP','RO'], ['CP','RO','PLC'], ['RO','PLC','EV'], ['PLC','EV','BH'], ['EV','BH','RS'], ['BH','RS','CP']];
  c7.forEach(c => addCard(c[0], `+2 ${c[0]}, +1 ${c[1]}, -2 ${c[2]}`, 'COMBO_3', { pos: [[c[0],2],[c[1],1]], neg: [[c[2],2]] }));
  const c8 = [['RS','RO','EV'], ['CP','PLC','BH'], ['RO','EV','RS'], ['PLC','BH','CP'], ['EV','RS','RO'], ['BH','CP','PLC']];
  c8.forEach(c => addCard(c[0], `+3 ${c[0]}, -1 ${c[1]}, -1 ${c[2]}`, 'COMBO_3', { pos: [[c[0],3]], neg: [[c[1],1],[c[2],1]] }));
  for(let i=0; i<6; i++) {
    const p1 = suits[i % 6], p2 = suits[(i+1) % 6], p3 = suits[(i+2) % 6];
    addCard(p1, `+8 pts por grupo (1 ${p1} + 1 ${p2} + 1 ${p3})`, 'TRIO_DIFF', { suits: [p1,p2,p3], pts: 8 });
  }
  for(let i=0; i<6; i++) {
    const p1 = suits[i % 6], p2 = suits[(i+1) % 6];
    addCard(p1, `+1 pt por cada ${p1} y +1 pt por cada ${p2}`, 'DOUBLE_SIMPLE', { suits: [p1,p2], pts: 1 });
  }
  suits.forEach((s, i) => addCard(s, `+3 por ${s}, -2 por ${suits[(i+1)%6]}`, 'COMBO_3', { pos: [[s,3]], neg: [[suits[(i+1)%6],2]] }));
  for(let i=0; i<6; i++) {
    const p1 = suits[i % 6], p2 = suits[(i+1) % 6];
    addCard(p1, `+5 pts por pareja (1 ${p1} + 1 ${p2})`, 'PAIR_DIFF', { suits: [p1,p2], pts: 5 });
  }
  suits.forEach(s => addCard(s, `Si ${s} es PAR = 7 pts / IMPAR = 3 pts`, 'EVEN_ODD', { suit: s, even: 7, odd: 3 }));
  const c14 = [['RS','CP','RO'], ['CP','RO','PLC'], ['RO','PLC','EV'], ['PLC','EV','BH'], ['EV','BH','RS'], ['BH','RS','CP']];
  c14.forEach(c => addCard(c[0], `+2 ${c[0]}, +2 ${c[1]}, -4 ${c[2]}`, 'COMBO_3', { pos: [[c[0],2],[c[1],2]], neg: [[c[2],4]] }));
  addCard('RS', `+10 pts si eres el jugador con MÁS componentes`, 'MAX_TOTAL', { pts: 10 });
  addCard('CP', `+7 pts si eres el jugador con MENOS componentes`, 'MIN_TOTAL', { pts: 7 });
  suits.forEach((s, i) => addCard(suits[(i+2)%6], `+5 pts por cada pareja de ${s}`, 'PAIR_SAME', { suit: s, pts: 5 }));
  addCard('RO', `+5 pts por cada tipo de componente ausente`, 'ABSENT_SUIT', { pts: 5 });
  addCard('PLC', `+5 pts por cada palo con 3 o más cartas`, 'THRESHOLD_SUIT', { count: 3, pts: 5 });
  addCard('EV', `+5 pts por cada palo con 2 o más cartas`, 'THRESHOLD_SUIT', { count: 2, pts: 5 });

  return deck;
}

// Almacenamiento de salas en memoria
const rooms = new Map();

function createRoomState(roomId, hostSocketId, options = {}) {
  return {
    id: roomId,
    host: hostSocketId,
    gameStarted: false,
    useFullDeck: options.useFullDeck || false,
    players: [], // { id, socketId, name, elements, scoreCards }
    currentPlayerIndex: 0,
    piles: [[], [], []],
    market: [null, null, null, null, null, null],
    pendingReplacements: [],
    selectedElementsCount: 0,
    hasTakenScoreCard: false,
    hasFlippedCardThisTurn: false
  };
}

function initGameForRoom(room) {
  let fullDeck = generateDeck();
  const playerCount = room.players.length;

  if (!room.useFullDeck && playerCount < 6) {
    const targetPerSuit = { 2: 6, 3: 9, 4: 12, 5: 15 }[playerCount] || 18;
    const filteredDeck = [];
    const suitCounts = { BH:0, RS:0, CP:0, RO:0, PLC:0, EV:0 };

    for (let i = fullDeck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [fullDeck[i], fullDeck[j]] = [fullDeck[j], fullDeck[i]];
    }

    fullDeck.forEach(card => {
      if (suitCounts[card.suit] < targetPerSuit) {
        filteredDeck.push(card);
        suitCounts[card.suit]++;
      }
    });
    fullDeck = filteredDeck;
  }

  for (let i = fullDeck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [fullDeck[i], fullDeck[j]] = [fullDeck[j], fullDeck[i]];
  }

  room.piles = [[], [], []];
  fullDeck.forEach((card, index) => {
    room.piles[index % 3].push(card);
  });

  room.market = [null, null, null, null, null, null];
  for(let row = 0; row < 3; row++) {
    for(let col = 0; col < 2; col++) {
      const idx = row * 2 + col;
      if (room.piles[row].length > 0) {
        room.market[idx] = room.piles[row].pop();
      }
    }
  }

  room.players.forEach(p => {
    p.elements = { BH:0, RS:0, CP:0, RO:0, PLC:0, EV:0 };
    p.scoreCards = [];
  });

  room.currentPlayerIndex = 0;
  room.gameStarted = true;
  resetTurnState(room);
}

function resetTurnState(room) {
  room.selectedElementsCount = 0;
  room.hasTakenScoreCard = false;
  room.hasFlippedCardThisTurn = false;
  room.pendingReplacements = [];
}

function checkAndRebalancePiles(room) {
  for (let i = 0; i < 3; i++) {
    if (room.piles[i].length === 0) {
      let maxIdx = -1, maxLen = 0;
      for (let j = 0; j < 3; j++) {
        if (room.piles[j].length > maxLen) {
          maxLen = room.piles[j].length;
          maxIdx = j;
        }
      }
      if (maxIdx !== -1 && maxLen >= 2) {
        const half = Math.floor(maxLen / 2);
        room.piles[i] = room.piles[maxIdx].splice(0, half);
      }
    }
  }
}

function refillMarket(room) {
  room.pendingReplacements.forEach(marketIdx => {
    const row = Math.floor(marketIdx / 2);
    let sourcePile = row;
    if (room.piles[sourcePile].length === 0) {
      sourcePile = room.piles.findIndex(p => p.length > 0);
    }
    if (sourcePile !== -1 && room.piles[sourcePile].length > 0) {
      room.market[marketIdx] = room.piles[sourcePile].pop();
    }
  });
  room.pendingReplacements = [];
  checkAndRebalancePiles(room);
}

// CONEXIONES SOCKET.IO
io.on('connection', (socket) => {

  // Crear Sala
  socket.on('CREATE_ROOM', ({ playerName, useFullDeck }) => {
    const roomId = Math.random().toString(36).substring(2, 6).toUpperCase();
    const room = createRoomState(roomId, socket.id, { useFullDeck });
    
    room.players.push({
      id: 1,
      socketId: socket.id,
      name: playerName || 'Jugador 1',
      elements: { BH:0, RS:0, CP:0, RO:0, PLC:0, EV:0 },
      scoreCards: []
    });

    rooms.set(roomId, room);
    socket.join(roomId);
    socket.emit('ROOM_CREATED', { roomId, room });
  });

  // Unirse a Sala
  socket.on('JOIN_ROOM', ({ roomId, playerName }) => {
    const code = roomId.toUpperCase();
    const room = rooms.get(code);

    if (!room) {
      return socket.emit('ERROR', 'La sala no existe.');
    }
    if (room.gameStarted) {
      return socket.emit('ERROR', 'La partida ya ha comenzado.');
    }
    if (room.players.length >= 6) {
      return socket.emit('ERROR', 'La sala está llena (máx. 6 jugadores).');
    }

    const playerObj = {
      id: room.players.length + 1,
      socketId: socket.id,
      name: playerName || `Jugador ${room.players.length + 1}`,
      elements: { BH:0, RS:0, CP:0, RO:0, PLC:0, EV:0 },
      scoreCards: []
    };

    room.players.push(playerObj);
    socket.join(code);

    io.to(code).emit('ROOM_UPDATED', room);
  });

  // Iniciar Partida (solo Host)
  socket.on('START_GAME', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room || room.host !== socket.id) return;

    initGameForRoom(room);
    io.to(roomId).emit('GAME_STARTED', room);
  });

  // Coger Carta de Puntuación
  socket.on('PICK_SCORE_CARD', ({ roomId, pileIdx }) => {
    const room = rooms.get(roomId);
    if (!room || !room.gameStarted) return;
    
    const currentPlayer = room.players[room.currentPlayerIndex];
    if (currentPlayer.socketId !== socket.id) return; // No es tu turno
    if (room.selectedElementsCount > 0) return;
    if (room.piles[pileIdx].length === 0) return;

    const card = room.piles[pileIdx].pop();
    currentPlayer.scoreCards.push(card);
    room.hasTakenScoreCard = true;

    checkAndRebalancePiles(room);
    endTurn(roomId, room);
  });

  // Coger Carta de Elemento
  socket.on('PICK_ELEMENT_CARD', ({ roomId, marketIdx }) => {
    const room = rooms.get(roomId);
    if (!room || !room.gameStarted) return;

    const currentPlayer = room.players[room.currentPlayerIndex];
    if (currentPlayer.socketId !== socket.id) return;
    if (room.hasTakenScoreCard) return;
    if (!room.market[marketIdx]) return;
    if (room.selectedElementsCount >= 2) return;

    const card = room.market[marketIdx];
    currentPlayer.elements[card.suit]++;
    room.market[marketIdx] = null;
    room.selectedElementsCount++;
    room.pendingReplacements.push(marketIdx);

    if (room.selectedElementsCount === 2) {
      endTurn(roomId, room);
    } else {
      io.to(roomId).emit('GAME_STATE_UPDATED', room);
    }
  });

  // Voltear Carta en mano
  socket.on('FLIP_SCORE_CARD', ({ roomId, cardIdx }) => {
    const room = rooms.get(roomId);
    if (!room || !room.gameStarted) return;

    const currentPlayer = room.players[room.currentPlayerIndex];
    if (currentPlayer.socketId !== socket.id) return;
    if (room.hasFlippedCardThisTurn) return;

    const card = currentPlayer.scoreCards.splice(cardIdx, 1)[0];
    currentPlayer.elements[card.suit]++;
    room.hasFlippedCardThisTurn = true;

    io.to(roomId).emit('GAME_STATE_UPDATED', room);
  });

  function endTurn(roomId, room) {
    refillMarket(room);

    // Verificar si ha terminado el juego
    const emptyPiles = room.piles.every(p => p.length === 0);
    const emptyMarket = room.market.every(c => c === null);

    if (emptyPiles && emptyMarket) {
      io.to(roomId).emit('GAME_OVER', room);
      return;
    }

    resetTurnState(room);
    room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.players.length;
    io.to(roomId).emit('GAME_STATE_UPDATED', room);
  }

  // Desconexión
  socket.on('disconnect', () => {
    rooms.forEach((room, roomId) => {
      const index = room.players.findIndex(p => p.socketId === socket.id);
      if (index !== -1) {
        room.players.splice(index, 1);
        if (room.players.length === 0) {
          rooms.delete(roomId);
        } else {
          if (room.host === socket.id) room.host = room.players[0].socketId;
          io.to(roomId).emit('ROOM_UPDATED', room);
        }
      }
    });
  });

});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor de Ingeniería Salad corriendo en puerto ${PORT}`);
});

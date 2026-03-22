const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = 3001;

// Room state storage
// Map of roomCode -> { players: [{id, name}], nicknames: [{playerId, nickname}], gameState: 'lobby'|'waiting'|'reading'|'voting'|'revealed', fakeNicknames: [] }
const rooms = new Map();

const generateFakeNicknames = () => {
  const fakes = [
    "ShadowNinja", "CryptoKing", "Xx_Sniper_xX", "PizzaLover99", "StarGazer",
    "FluffyUnicorn", "IRONHIDE", "MidnightRider", "CouchPotato", "GhostDog"
  ];
  // return 2 random distinct fakes
  const result = [];
  while (result.length < 2) {
    const random = fakes[Math.floor(Math.random() * fakes.length)];
    if (!result.includes(random)) {
      result.push(random);
    }
  }
  return result;
};

// Shuffle array
const shuffle = (array) => {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
};

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  socket.on('createRoom', ({ playerName }) => {
    const roomCode = Math.random().toString(36).substring(2, 6).toUpperCase();
    rooms.set(roomCode, {
      players: [{ id: socket.id, name: playerName }],
      nicknames: [],
      gameState: 'lobby',
      fakeNicknames: [],
      votes: [],
      allEntries: []
    });
    socket.join(roomCode);
    socket.emit('roomCreated', { roomCode, player: { id: socket.id, name: playerName } });
    io.to(roomCode).emit('roomUpdate', rooms.get(roomCode));
  });

  socket.on('joinRoom', ({ roomCode, playerName }) => {
    const roomCodeUpper = roomCode.toUpperCase();
    const room = rooms.get(roomCodeUpper);
    if (room) {
      if (room.gameState !== 'lobby') {
        socket.emit('error', 'Game already started');
        return;
      }
      room.players.push({ id: socket.id, name: playerName });
      socket.join(roomCodeUpper);
      socket.emit('joinedRoom', { roomCode: roomCodeUpper, player: { id: socket.id, name: playerName } });
      io.to(roomCodeUpper).emit('roomUpdate', room);
    } else {
      socket.emit('error', 'Room not found');
    }
  });

  socket.on('submitNickname', ({ roomCode, nickname }) => {
    const room = rooms.get(roomCode);
    if (!room) return;

    // Check if player already submitted
    if (room.nicknames.find(n => n.playerId === socket.id)) return;
    
    room.nicknames.push({ playerId: socket.id, nickname, isFake: false });
    
    // Check if everyone has submitted
    if (room.nicknames.length === room.players.length) {
      room.gameState = 'reading';
      
      // Add fake nicknames
      const fakes = generateFakeNicknames();
      fakes.forEach((f, i) => {
        room.nicknames.push({ playerId: `fake_${i}`, nickname: f, isFake: true });
        room.fakeNicknames.push(f);
      });

      room.allEntries = shuffle([...room.nicknames]);
      io.to(roomCode).emit('startReading', { entries: room.allEntries });
    }
    
    io.to(roomCode).emit('roomUpdate', room);
  });

  socket.on('startVoting', ({ roomCode }) => {
    const room = rooms.get(roomCode);
    if (room) {
      room.gameState = 'voting';
      io.to(roomCode).emit('roomUpdate', room);
    }
  });

  socket.on('submitVote', ({ roomCode, fakeNickname }) => {
    const room = rooms.get(roomCode);
    if (room) {
      room.votes.push({ playerId: socket.id, vote: fakeNickname });
      // If everyone voted
      if (room.votes.length === room.players.length) {
        room.gameState = 'revealed';
      }
      io.to(roomCode).emit('roomUpdate', room);
    }
  });

  socket.on('disconnect', () => {
    console.log('Player disconnected:', socket.id);
    rooms.forEach((room, roomCode) => {
      const playerIndex = room.players.findIndex(p => p.id === socket.id);
      if (playerIndex !== -1) {
        room.players.splice(playerIndex, 1);
        io.to(roomCode).emit('roomUpdate', room);
        if (room.players.length === 0) {
          rooms.delete(roomCode);
        }
      }
    });
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

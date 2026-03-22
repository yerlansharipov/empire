import React, { useState, useEffect, useRef } from 'react';
import Peer from 'peerjs';
import './App.css';

function App() {
  const [gameState, setGameState] = useState('home'); // home, lobby, submitting, waiting, reading, voting, revealed
  const [playerName, setPlayerName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [expectedPlayersInput, setExpectedPlayersInput] = useState(3);
  const [roomInfo, setRoomInfo] = useState({ players: [], nicknames: [], gameState: 'lobby', allEntries: [], votes: [], expectedPlayers: 3 });
  const [nickname, setNickname] = useState('');
  const [fakeVotes, setFakeVotes] = useState([]);
  const [entriesToRead, setEntriesToRead] = useState([]);
  const [isReading, setIsReading] = useState(false);
  const [error, setError] = useState('');
  const [isHost, setIsHost] = useState(false);
  const peerInstance = useRef(null);
  const hostConnection = useRef(null);
  const connections = useRef([]);

  // Generate distinct fake names
  const generateFakeNicknames = () => {
    const fakes = [
      "ShadowNinja", "CryptoKing", "Xx_Sniper_xX", "PizzaLover99", "StarGazer",
      "FluffyUnicorn", "IRONHIDE", "MidnightRider", "CouchPotato", "GhostDog"
    ];
    const result = [];
    while (result.length < 2) {
      const random = fakes[Math.floor(Math.random() * fakes.length)];
      if (!result.includes(random)) result.push(random);
    }
    return result;
  };

  const shuffle = (array) => {
    const newArray = [...array];
    for (let i = newArray.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
    }
    return newArray;
  };

  const broadcast = (data) => {
    connections.current.forEach(conn => {
      if (conn.open) {
        conn.send(data);
      }
    });
  };

  const updateRoomState = (updater, shouldBroadcast = true) => {
    setRoomInfo(prev => {
      const newState = typeof updater === 'function' ? updater(prev) : { ...prev, ...updater };
      
      // Handle automatic state transitions on Host Side
      if (isHost) {
        if (newState.gameState === 'lobby' && prev.gameState !== 'lobby') {
           setGameState('lobby');
        }
        if (newState.gameState === 'submitting') {
           // We no longer automatically transition to reading. Host triggers it manually.
        }
        if (newState.gameState === 'voting') {
            if (newState.votes.length === newState.players.length && newState.players.length > 0) {
              newState.gameState = 'revealed';
            }
        }
      }

      if (shouldBroadcast && isHost) {
        broadcast({ type: 'ROOM_UPDATE', data: newState });
        
        // Since host processes their own transitions too...
        if (newState.gameState === 'reading' && prev.gameState !== 'reading') {
           broadcast({ type: 'START_READING', data: newState.allEntries });
           setGameState('reading');
           setEntriesToRead(newState.allEntries);
           startReadingSequence(newState.allEntries);
        }
      }

      return newState;
    });
  };

  // On mount
  useEffect(() => {
    return () => {
      if (peerInstance.current) peerInstance.current.destroy();
    };
  }, []);

  const createRoom = () => {
    if (!playerName) { setError('Name required'); return; }
    const code = Math.random().toString(36).substring(2, 6).toUpperCase();
    const peerId = `gtn-${code}`;
    
    setIsHost(true);
    setGameState('lobby');
    setRoomCode(code);
    
    const initialPlayers = [{ id: peerId, name: playerName }];
    updateRoomState({ players: initialPlayers, gameState: 'lobby', expectedPlayers: expectedPlayersInput }, false);

    const peer = new Peer(peerId);
    peerInstance.current = peer;

    peer.on('open', (id) => {
      console.log('Host created room with ID:', id);
    });

    peer.on('connection', (conn) => {
      conn.on('open', () => {
        connections.current.push(conn);
      });

      conn.on('data', (data) => {
         if (data.type === 'JOIN') {
            updateRoomState(prev => {
              const p = [...prev.players, { id: conn.peer, name: data.name }];
              return { ...prev, players: p };
            });
         } else if (data.type === 'SUBMIT_NICKNAME') {
            updateRoomState(prev => {
              if (prev.nicknames.find(n => n.playerId === conn.peer)) return prev;
              const n = [...prev.nicknames, { playerId: conn.peer, nickname: data.nickname, isFake: false }];
              return { ...prev, nicknames: n };
            });
         } else if (data.type === 'START_VOTING') {
            updateRoomState({ gameState: 'voting' });
         } else if (data.type === 'SUBMIT_VOTE') {
            updateRoomState(prev => {
              const v = [...prev.votes, { playerId: conn.peer, vote: data.fakeNickname }];
              return { ...prev, votes: v };
            });
         }
      });

      conn.on('close', () => {
        connections.current = connections.current.filter(c => c.peer !== conn.peer);
        updateRoomState(prev => {
           return { ...prev, players: prev.players.filter(p => p.id !== conn.peer) };
        });
      });
    });

    peer.on('error', (err) => {
      setError('Peer Error: ' + err.message);
    });
  };

  const joinRoom = () => {
    if (!playerName || !joinCode) { setError('Name and Room Code required'); return; }
    const peer = new Peer();
    peerInstance.current = peer;
    
    setIsHost(false);
    setRoomCode(joinCode.toUpperCase());

    peer.on('open', (id) => {
      const hostId = `gtn-${joinCode.toUpperCase()}`;
      const conn = peer.connect(hostId);
      hostConnection.current = conn;

      conn.on('open', () => {
         conn.send({ type: 'JOIN', name: playerName });
         setGameState('lobby');
      });

      conn.on('data', (msg) => {
         if (msg.type === 'ROOM_UPDATE') {
            setRoomInfo(msg.data);
            if (msg.data.gameState === 'reading') setGameState('reading');
            else if (msg.data.gameState === 'voting') setGameState('voting');
            else if (msg.data.gameState === 'revealed') setGameState('revealed');
            else if (msg.data.gameState === 'lobby') setGameState('lobby');
         } else if (msg.type === 'START_READING') {
            setEntriesToRead(msg.data);
            setGameState('reading');
            startReadingSequence(msg.data);
         }
      });

      conn.on('close', () => {
        setError('Connection to host lost');
        setGameState('home');
      });
    });

    peer.on('error', (err) => {
      setError('Connection failed: ' + err.message);
    });
  };

  const submitNickname = (e) => {
    e.preventDefault();
    if (!nickname) { setError('Nickname required'); return; }
    
    if (isHost) {
      updateRoomState(prev => {
          if (prev.nicknames.find(n => n.playerId === peerInstance.current.id)) return prev;
          const n = [...prev.nicknames, { playerId: peerInstance.current.id, nickname, isFake: false }];
          return { ...prev, nicknames: n, gameState: prev.gameState === 'lobby' ? 'submitting' : prev.gameState };
      });
    } else {
      hostConnection.current.send({ type: 'SUBMIT_NICKNAME', nickname });
    }
    setGameState('waiting');
  };

  const submitVote = (fakeNickname) => {
    if (!fakeVotes.includes(fakeNickname)) {
        setFakeVotes([...fakeVotes, fakeNickname]);
        if (isHost) {
           updateRoomState(prev => {
             const v = [...prev.votes, { playerId: peerInstance.current.id, vote: fakeNickname }];
             return { ...prev, votes: v };
           });
        } else {
           hostConnection.current.send({ type: 'SUBMIT_VOTE', fakeNickname });
        }
    }
  };

  const readWords = (entries) => {
    return new Promise((resolve) => {
      if (!window.speechSynthesis) {
        resolve();
        return;
      }
      
      let index = 0;
      const speakNext = () => {
        if (index >= entries.length) {
          resolve();
          return;
        }
        
        const utterance = new SpeechSynthesisUtterance(entries[index].nickname);
        utterance.rate = 0.9;
        utterance.pitch = 1.0;
        
        utterance.onend = () => {
          index++;
          setTimeout(speakNext, 1500);
        };
        
        window.speechSynthesis.speak(utterance);
      };
      
      speakNext();
    });
  };

  const startReadingSequence = async (entries) => {
    if (isReading) return;
    setIsReading(true);
    
    const intro = new SpeechSynthesisUtterance('Here are the nicknames for round 1.');
    window.speechSynthesis.speak(intro);
    
    await new Promise(r => setTimeout(r, 2000));
    await readWords(entries);
    
    const middle = new SpeechSynthesisUtterance('Read through complete. Preparing for the second reading.');
    window.speechSynthesis.speak(middle);
    
    await new Promise(r => setTimeout(r, 3000));
    
    const intro2 = new SpeechSynthesisUtterance('Here are the nicknames for round 2.');
    window.speechSynthesis.speak(intro2);
    
    await new Promise(r => setTimeout(r, 2000));
    await readWords(entries);
    
    const outro = new SpeechSynthesisUtterance('Reading sequence finished.');
    window.speechSynthesis.speak(outro);
    
    setIsReading(false);
  };

  const startGame = () => {
     if (isHost) {
        updateRoomState({ gameState: 'submitting' });
     }
  };

  const manualStartVote = () => {
    if (isHost) {
      updateRoomState({ gameState: 'voting' });
    } else {
      hostConnection.current.send({ type: 'START_VOTING' });
    }
  };

  const manualStartReading = () => {
    if (isHost) {
      updateRoomState(prev => {
        const newNicknames = [...prev.nicknames];
        const fakes = generateFakeNicknames();
        fakes.forEach((f, i) => {
          newNicknames.push({ playerId: `fake_${i}`, nickname: f, isFake: true });
        });
        return { ...prev, nicknames: newNicknames, allEntries: shuffle(newNicknames), gameState: 'reading' };
      });
    }
  };

  // Sync state correctly if host updates it manually
  useEffect(() => {
     if (isHost && roomInfo.gameState === 'submitting') {
         setGameState('submitting');
     }
  }, [roomInfo.gameState, isHost]);

  return (
    <div className="app-container">
      {error && <div className="error-toast">{error}</div>}
      
      {gameState === 'home' && (
        <div className="card start-card">
          <h1>Guess the Nickname</h1>
          <p className="subtitle">The ultimate hidden identity party game</p>
          
          <div className="form-group">
            <input 
              placeholder="Your Name" 
              value={playerName} 
              onChange={(e) => setPlayerName(e.target.value)} 
              className="styled-input"
            />
          </div>

          <div className="form-group" style={{ marginBottom: '10px' }}>
             <label style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '-5px' }}>Number of players (Host)</label>
             <input 
               type="number"
               min="3"
               placeholder="Expected Players" 
               value={expectedPlayersInput} 
               onChange={(e) => setExpectedPlayersInput(parseInt(e.target.value) || 3)} 
               className="styled-input"
             />
          </div>
          
          <div className="action-buttons">
            <button onClick={createRoom} className="btn primary-btn">Create Room (Host)</button>
            <div className="divider"><span>OR</span></div>
            <div className="join-group">
              <input 
                placeholder="Room Code" 
                value={joinCode} 
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())} 
                className="styled-input"
              />
              <button onClick={joinRoom} className="btn secondary-btn">Join Room</button>
            </div>
          </div>
        </div>
      )}

      {gameState === 'lobby' && (
        <div className="card room-card">
          <h2>Room: <span className="highlight-code">{roomCode}</span></h2>
          <div className="players-list">
            <h3>Players ({roomInfo.players.length}):</h3>
            <ul>
              {roomInfo.players.map((p, i) => <li key={i}>{p.name} {p.id === (peerInstance.current?.id) && '(You)'}</li>)}
            </ul>
          </div>
          {isHost ? (
            <button className="btn primary-btn" onClick={startGame}>Start Game</button>
          ) : (
            <p className="warning-text">Waiting for host to start...</p>
          )}
        </div>
      )}

      {gameState === 'submitting' && (
        <div className="card game-card">
          <h2>Submit a Nickname</h2>
          <p>Think of a funny or clever nickname. Don't let anyone see!</p>
          <form onSubmit={submitNickname} className="form-group">
            <input 
              placeholder="Your Nickname" 
              value={nickname} 
              onChange={(e) => setNickname(e.target.value)} 
              className="styled-input"
              autoComplete="off"
            />
            <button type="submit" className="btn primary-btn">Submit</button>
          </form>
          <p className="warning-text" style={{ marginTop: '20px' }}>{roomInfo.nicknames.length} / {roomInfo.expectedPlayers} submitted.</p>
          {isHost && (
             <button onClick={manualStartReading} className="btn secondary-btn" style={{ marginTop: '15px' }}>Force Start Reading Phase</button>
          )}
        </div>
      )}

      {gameState === 'waiting' && (
        <div className="card game-card">
          <h2>Waiting...</h2>
          <p>Waiting for other players to submit their nicknames.</p>
          <p className="warning-text">{roomInfo.nicknames.length} / {roomInfo.expectedPlayers} submitted.</p>
          <div className="loader"></div>
          {isHost && (
             <div style={{ marginTop: '30px' }}>
                <button onClick={manualStartReading} className="btn primary-btn">Force Start Reading Phase</button>
             </div>
          )}
        </div>
      )}

      {gameState === 'reading' && (
        <div className="card game-card reading-card">
          <h2>Listen Carefully!</h2>
          <div className="listening-animation">
            <div className="wave"></div>
            <div className="wave"></div>
            <div className="wave"></div>
          </div>
          <p>The system is reading the nicknames out loud...</p>
          <p className="warning-text">Do not look at the screen! Pay attention to the audio.</p>
          
          <div className="host-controls">
             {!isReading && (
               <button onClick={() => startReadingSequence(entriesToRead)} className="btn secondary-btn">
                 Replay Audio
               </button>
             )}
             {(isHost || roomInfo.players[0]?.id === peerInstance.current?.id) && (
               <button onClick={manualStartVote} className="btn primary-btn">
                 Go to Voting
               </button>
             )}
          </div>
        </div>
      )}

      {gameState === 'voting' && (
        <div className="card game-card voting-card">
          <h2>Vote</h2>
          <p>Which names were fake? (There are 2 fake names added by the system)</p>
          <div className="options-grid">
            {roomInfo.allEntries.map((entry, idx) => (
              <button 
                key={idx} 
                className={`vote-btn ${fakeVotes.includes(entry.nickname) ? 'selected' : ''}`}
                onClick={() => submitVote(entry.nickname)}
                disabled={fakeVotes.includes(entry.nickname)}
              >
                {entry.nickname}
              </button>
            ))}
          </div>
          {roomInfo.votes.length > 0 && (
             <p className="votes-count">{roomInfo.votes.length}/{roomInfo.players.length} votes cast so far.</p>
          )}
        </div>
      )}

      {gameState === 'revealed' && (
        <div className="card game-card reveal-card">
          <h2>Results</h2>
          <p>Here is the full list of nicknames submitted:</p>
          <ul className="results-list">
            {roomInfo.allEntries.map((entry, i) => (
              <li key={i} className={`result-item ${entry.isFake ? 'fake-item' : 'real-item'}`}>
                <span className="name">{entry.nickname}</span>
                {entry.isFake && <span className="tag fake-tag">FAKE</span>}
                {!entry.isFake && <span className="tag owner-tag">Submitted by: {roomInfo.players.find(p => p.id === entry.playerId)?.name || 'Unknown'}</span>}
              </li>
            ))}
          </ul>
          <button className="btn primary-btn" onClick={() => window.location.reload()}>Play Again</button>
        </div>
      )}

    </div>
  );
}

export default App;

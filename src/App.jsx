// src/App.jsx
import React, { useEffect, useRef, useState } from "react";
import { initializeApp } from "firebase/app";
import {
  getDatabase,
  ref,
  set,
  push,
  onValue,
  remove,
  get,
  update,
  runTransaction,
} from "firebase/database";

/* ===== Firebase config ===== */
const firebaseConfig = {
  apiKey: "AIzaSyCRVGx8k52WELbFv6jrwC9vElcbE885oUM",
  authDomain: "mma-perspectives-u4.firebaseapp.com",
  databaseURL:
    "https://mma-perspectives-u4-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "mma-perspectives-u4",
  storageBucket: "mma-perspectives-u4.firebasestorage.app",
  messagingSenderId: "241966145630",
  appId: "1:241966145630:web:6a0c341cca439e038cd4cf",
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

const parsePair = (x) => {
  if (!x) return [0, 0];
  if (Array.isArray(x)) return [Number(x[0]) || 0, Number(x[1]) || 0];
  const parts = String(x).split(",").map((t) => Number(t.trim()));
  return [Number.isFinite(parts[0]) ? parts[0] : 0, Number.isFinite(parts[1]) ? parts[1] : 0];
};
const pairToStr = (arr = [0, 0]) => `${arr[0]},${arr[1]}`;

export default function App() {
  const params = new URLSearchParams(window.location.search);
  const isAdmin = (params.get("user") || "").toLowerCase() === "admin";
  return (
    <div className="flex items-start justify-center p-6">
      {isAdmin ? <InstructorView /> : <StudentView />}
    </div>
  );
}

/* ===================== STUDENT VIEW ===================== */
function StudentView() {
  const [gameCode, setGameCode] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState(""); // "A"|"B"
  const [playerKey, setPlayerKey] = useState(null);
  const [settings, setSettings] = useState(null);
  const [payoffs, setPayoffs] = useState(null);
  const [currentRound, setCurrentRound] = useState(1);
  const [globalPlayers, setGlobalPlayers] = useState([]);
  const [roundPlayers, setRoundPlayers] = useState({});
  const [prevRoundPlayers, setPrevRoundPlayers] = useState({});
  const [myChoice, setMyChoice] = useState(null);
  const [gameExists, setGameExists] = useState(null); // null unknown, true exists, false missing
  const [fullGameSnapshot, setFullGameSnapshot] = useState(null);
  const [lastRoundCompleted, setLastRoundCompleted] = useState(false);
  const [currentRoundCompleted, setCurrentRoundCompleted] = useState(false);
  const [resetNotice, setResetNotice] = useState(""); // NEW: message when instructor resets users

  // Settings & payoffs subscription (with existence check)
  useEffect(() => {
    if (!gameCode) {
      setSettings(null);
      setPayoffs(null);
      setGameExists(null);
      return () => {};
    }
    const sRef = ref(db, `games/${gameCode}/settings`);
    const pRef = ref(db, `games/${gameCode}/payoffs`);

    const unsubS = onValue(sRef, (snap) => {
      if (!snap.exists()) {
        setGameExists(false);
        setSettings(null);
        return;
      }
      setGameExists(true);
      const raw = snap.val() || {};
      const defaults = {
        assignmentMode: "random",
        sequential: false,
        revealPayoffs: false,
        autoProgress: false,
        rounds: 1,
        currentRound: 1,
        labels: { A: ["Cooperate", "Defect"], B: ["Cooperate", "Defect"] },
      };
      setSettings({ ...defaults, ...raw });
      if (raw?.currentRound) setCurrentRound(raw.currentRound);
    });

    const unsubP = onValue(pRef, (snap) => {
      if (!snap.exists()) {
        setPayoffs(null);
        return;
      }
      const p = snap.val() || {};
      setPayoffs({
        CC: parsePair(p.CC),
        CD: parsePair(p.CD),
        DC: parsePair(p.DC),
        DD: parsePair(p.DD),
      });
    });

    return () => {
      unsubS();
      unsubP();
    };
  }, [gameCode]);

  // Players list
  useEffect(() => {
    if (!gameCode) return () => {};
    const playersRef = ref(db, `games/${gameCode}/players`);
    const unsub = onValue(playersRef, (snap) => {
      const val = snap.val() || {};
      const arr = Object.entries(val).map(([k, v]) => ({ key: k, ...v }));
      setGlobalPlayers(arr);
    });
    return () => unsub();
  }, [gameCode]);

  // NEW: Detect that my player entry was removed (instructor reset users)
  useEffect(() => {
    if (!playerKey) return;
    const stillExists = globalPlayers.some(p => p.key === playerKey);
    if (!stillExists) {
      // Clear local player session so UI returns to join form
      setPlayerKey(null);
      setRole("");
      setMyChoice(null);
      setResetNotice("The instructor reset all players. Please join again.");
    }
  }, [globalPlayers, playerKey]);

  // Round players & previous round + current round completion
  useEffect(() => {
    if (!gameCode) return () => {};
    const roundRef = ref(db, `games/${gameCode}/rounds/${currentRound}/players`);
    const unsubRound = onValue(roundRef, (snap) => setRoundPlayers(snap.val() || {}));

    let unsubPrev = () => {};
    if (currentRound > 1) {
      const prevRef = ref(db, `games/${gameCode}/rounds/${currentRound - 1}/players`);
      unsubPrev = onValue(prevRef, (snap) => setPrevRoundPlayers(snap.val() || {}));
    } else {
      setPrevRoundPlayers({});
    }

    const crRef = ref(db, `games/${gameCode}/settings/currentRound`);
    const unsubCR = onValue(crRef, (snap) => {
      const v = snap.val();
      if (typeof v === "number") setCurrentRound(v);
    });

    const completedRef = ref(db, `games/${gameCode}/rounds/${currentRound}/completed`);
    const unsubCompleted = onValue(completedRef, (snap) =>
      setCurrentRoundCompleted(!!snap.val())
    );

    setCurrentRoundCompleted(false);

    return () => {
      unsubRound();
      unsubPrev();
      unsubCR();
      unsubCompleted();
    };
  }, [gameCode, currentRound]);

  // Full game snapshot (for end summary)
  useEffect(() => {
    if (!gameCode) return () => {};
    const gameRef = ref(db, `games/${gameCode}`);
    const unsub = onValue(gameRef, (snap) => setFullGameSnapshot(snap.val() || null));
    return () => unsub();
  }, [gameCode]);

  // Last round completion watch
  useEffect(() => {
    if (!gameCode || !settings?.rounds) return () => {};
    const compRef = ref(db, `games/${gameCode}/rounds/${settings.rounds}/completed`);
    const unsub = onValue(compRef, (snap) => setLastRoundCompleted(!!snap.val()));
    return () => unsub;
  }, [gameCode, settings?.rounds]);

  // Reset myChoice on round change
  useEffect(() => {
    setMyChoice(null);
  }, [currentRound]);

  // Update myChoice from round snapshot
  useEffect(() => {
    if (!playerKey) return;
    const me = roundPlayers[playerKey];
    setMyChoice(me ? me.choice : null);
  }, [roundPlayers, playerKey]);

  // Pairing
  const Aglobal = globalPlayers.filter((p) => p.role === "A").map((p) => p.key);
  const Bglobal = globalPlayers.filter((p) => p.role === "B").map((p) => p.key);
  const myIndex = playerKey
    ? role === "A"
      ? Aglobal.indexOf(playerKey)
      : Bglobal.indexOf(playerKey)
    : -1;
  const pairedAKey = role === "B" && myIndex >= 0 ? Aglobal[myIndex] : null;
  const pairedBKey = role === "A" && myIndex >= 0 ? Bglobal[myIndex] : null;

  // Opponent
  const opponentKey = (() => {
    if (!playerKey) return null;
    if (role === "A") return pairedBKey;
    if (role === "B") return pairedAKey;
    return null;
  })();
  const opponentChoice = opponentKey ? roundPlayers[opponentKey]?.choice ?? null : null;

  // Turn logic
  const isMyTurn = (() => {
    if (!settings || !playerKey || myIndex === -1) return false;
    if (myChoice === 0 || myChoice === 1) return false;
    if (!settings.sequential) return true;
    if (role === "A") {
      if (currentRound === 1) return true;
      if (!pairedBKey) return false;
      const prevB = prevRoundPlayers[pairedBKey];
      return !!(prevB && (prevB.choice === 0 || prevB.choice === 1));
    } else {
      if (!pairedAKey) return false;
      const aEntry = roundPlayers[pairedAKey];
      return !!(aEntry && (aEntry.choice === 0 || aEntry.choice === 1));
    }
  })();

  // Game finished?
  const gameFinished =
    !!settings && settings.currentRound === settings.rounds && lastRoundCompleted;

  // Payoff visibility
  const getDisplayedPayoffs = () => {
    if (gameFinished) return { full: payoffs, side: null };
    if (!payoffs || !settings) return null;
    if (settings.revealPayoffs) return { full: payoffs, side: null };
    if (!settings.sequential || isMyTurn) {
      if (role === "A")
        return {
          full: null,
          side: {
            CC: payoffs.CC[0],
            CD: payoffs.CD[0],
            DC: payoffs.DC[0],
            DD: payoffs.DD[0],
          },
        };
      if (role === "B")
        return {
          full: null,
            side: {
              CC: payoffs.CC[1],
              CD: payoffs.CD[1],
              DC: payoffs.DC[1],
              DD: payoffs.DD[1],
          },
        };
    }
    return null;
  };
  const displayed = getDisplayedPayoffs();

  // Outcome key
  const outcomeKey = (aChoice, bChoice) => {
    if (aChoice === 0 && bChoice === 0) return "CC";
    if (aChoice === 0 && bChoice === 1) return "CD";
    if (aChoice === 1 && bChoice === 0) return "DC";
    return "DD";
  };

  // End-of-game summary
  const summaryData = (() => {
    if (!gameFinished || !fullGameSnapshot || !payoffs || !settings) return null;
    const roundsCount = settings.rounds;
    const playersObj = fullGameSnapshot.players || {};
    const roundsObj = fullGameSnapshot.rounds || {};
    const pairs = [];
    const pairCount = Math.min(Aglobal.length, Bglobal.length);
    for (let i = 0; i < pairCount; i++) {
      const aKey = Aglobal[i];
      const bKey = Bglobal[i];
      const aPlayer = playersObj[aKey] || { name: "A?" };
      const bPlayer = playersObj[bKey] || { name: "B?" };
      const perRound = [];
      let totalA = 0;
      let totalB = 0;
      for (let r = 1; r <= roundsCount; r++) {
        const rPlayers = roundsObj?.[r]?.players || {};
        const aEntry = rPlayers[aKey];
        const bEntry = rPlayers[bKey];
        const aC = aEntry?.choice;
        const bC = bEntry?.choice;
        let cell = null;
        let payoffPair = [0, 0];
        if (aC !== undefined && aC !== null && bC !== undefined && bC !== null) {
          cell = outcomeKey(aC, bC);
          payoffPair = payoffs[cell] || [0, 0];
          totalA += payoffPair[0];
          totalB += payoffPair[1];
        }
        perRound.push({
          round: r,
          aChoice: aC,
          bChoice: bC,
          cell,
          payoffA: payoffPair[0],
          payoffB: payoffPair[1],
        });
      }
      pairs.push({
        index: i + 1,
        aKey,
        bKey,
        aName: aPlayer.name,
        bName: bPlayer.name,
        rounds: perRound,
        totalA,
        totalB,
      });
    }
    return { pairs };
  })();

  // Mark round completion
  const checkAndMarkRoundCompleted = async (code, R) => {
    try {
      const playersSnap = await get(ref(db, `games/${code}/players`));
      const playersObj = playersSnap.val() || {};
      const Aglobal_local = Object.entries(playersObj)
        .filter(([, p]) => p.role === "A")
        .map(([k]) => k);
      const Bglobal_local = Object.entries(playersObj)
        .filter(([, p]) => p.role === "B")
        .map(([k]) => k);
      const n = Math.min(Aglobal_local.length, Bglobal_local.length);
      if (n === 0) return;
      const roundSnap = await get(ref(db, `games/${code}/rounds/${R}/players`));
      const roundObj = roundSnap.val() || {};
      for (let i = 0; i < n; i++) {
        const aKey = Aglobal_local[i];
        const bKey = Bglobal_local[i];
        const aEntry = roundObj[aKey];
        const bEntry = roundObj[bKey];
        const aDone = aEntry && (aEntry.choice === 0 || aEntry.choice === 1);
        const bDone = bEntry && (bEntry.choice === 0 || bEntry.choice === 1);
        if (!aDone || !bDone) return;
      }
      await set(ref(db, `games/${code}/rounds/${R}/completed`), true);
    } catch (e) {
      console.error("checkAndMarkRoundCompleted error", e);
    }
  };

  // Join game
  const joinGame = async () => {
    if (!gameCode || !name) return alert("Enter game code and name");
    if (gameExists === false) return alert("Game code not found. Ask the instructor to start the game.");
    if (!settings) return alert("Instructor hasn't started the game");
    try {
      let assigned = role;
      const playersRef = ref(db, `games/${gameCode}/players`);
      if (settings.assignmentMode === "random") {
        const snap = await get(playersRef);
        const existing = snap.val() || {};
        const roles = Object.values(existing).map((p) => p.role);
        const countA = roles.filter((r) => r === "A").length;
        const countB = roles.filter((r) => r === "B").length;
        assigned = countA <= countB ? "A" : "B";
        setRole(assigned);
      } else {
        if (!assigned) return alert("Select a role (A or B)");
      }
      const newRef = push(playersRef);
      await set(newRef, { name, role: assigned });
      setPlayerKey(newRef.key);
      await set(ref(db, `games/${gameCode}/rounds/${currentRound}/players/${newRef.key}`), {
        name,
        role: assigned,
        choice: null,
      });
      setResetNotice(""); // clear any prior reset notice on new join
      alert(`Joined as Player ${assigned}`);
    } catch (e) {
      console.error(e);
      alert("Failed to join game");
    }
  };

  // Submit choice
  const submitChoice = async (idx) => {
    if (!playerKey) return alert("Join first");
    if (gameFinished) return alert("Game finished");
    if (!isMyTurn && settings?.sequential) return alert("Not your turn");
    if (myChoice === 0 || myChoice === 1) return alert("You already chose this round");
    if (currentRound > (settings?.rounds || 1)) return alert("Game finished");
    try {
      const path = `games/${gameCode}/rounds/${currentRound}/players/${playerKey}`;
      await set(ref(db, path), { name, role, choice: idx, ts: Date.now() });
      setMyChoice(idx);
      await checkAndMarkRoundCompleted(gameCode, currentRound);
    } catch (e) {
      console.error(e);
      alert("Failed to submit choice");
    }
  };

  const choiceLabel = (roleLocal, idx) => {
    if (idx === 0 || idx === 1) {
      return (
        settings?.labels?.[roleLocal]?.[idx] ??
        (idx === 0 ? "Option 1" : "Option 2")
      );
    }
    return "—";
  };

  // Opponent choice visibility
  const canRevealOpponentChoice = (() => {
    if (!opponentKey) return false;
    if (settings?.sequential) return opponentChoice === 0 || opponentChoice === 1;
    return (currentRoundCompleted || gameFinished) && (opponentChoice === 0 || opponentChoice === 1);
  })();

  const roleTableClass =
    role === "A" ? "playera" : role === "B" ? "playerb" : "";

  return (
    <div className="bg-white rounded-lg p-6 w-full max-w-lg space-y-4">
      <h2 className="text-lg font-bold text-center">Want to play?</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <input
          placeholder="Game code"
          value={gameCode}
          onChange={(e) => {
            setGameCode(e.target.value.trim());
            if (!e.target.value) setResetNotice("");
          }}
          className="border p-2 rounded w-full"
        />
        <input
          placeholder="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="border p-2 rounded w-full"
        />
      </div>

      {resetNotice && !playerKey && (
        <div className="text-sm text-alert">{resetNotice}</div>
      )}

      {gameCode && gameExists === false && (
        <div className="text-sm text-red">
          Game code not found. Verify the code with your instructor.
        </div>
      )}
      {gameCode && gameExists === null && (
        <div className="text-xs text-grey">Checking game code...</div>
      )}

      {settings?.assignmentMode === "choice" && !playerKey && (
        <div className="flex gap-2">
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="border p-2 rounded w-full"
            disabled={gameExists === false || !settings}
          >
            <option value="">Select role</option>
            <option value="A">Player A</option>
            <option value="B">Player B</option>
          </select>
          <button
            onClick={joinGame}
            disabled={gameExists === false || !settings}
            className={`py-2 px-3 rounded text-white ${
              gameExists === false || !settings
                ? "bg-gray-400 cursor-not-allowed"
                : "bg-blue-600"
            }`}
          >
            Join
          </button>
        </div>
      )}

      {settings?.assignmentMode === "random" && !playerKey && (
        <div>
          <button
            onClick={joinGame}
            disabled={gameExists === false || !settings}
            className={`w-full py-2 rounded text-white ${
              gameExists === false || !settings
                ? "bg-gray-400 cursor-not-allowed"
                : "bg-blue-600"
            }`}
          >
            Join
          </button>
        </div>
      )}

      {playerKey && (
        <>
          <div className="text-sm text-grey">
            You: {name} — Player: <span className = {`font-bold ${roleTableClass}`}>{role}</span> — id:{" "}
            <span className="font-mono">{playerKey}</span>
          </div>
          <div className="text-center font-semibold">
            Round {Math.min(currentRound, settings?.rounds || 1)} /{" "}
            {settings?.rounds || 1}
          </div>

          {!gameFinished && (
            <div>
              {!displayed && (
                <div className="text-center text-red font-semibold">
                  ⏳ Wait for your turn
                </div>
              )}
              {displayed?.full && (
                <div>
                  <h3 className="font-semibold text-center">
                    Payoffs (A,B)
                  </h3>
                  <table className={`w-full border text-center mt-2 ${roleTableClass}`}>
                    <thead>
                      <tr>
                        <th></th>
                        <th className="playerb">B: {settings.labels?.B?.[0]}</th>
                        <th className="playerb">B: {settings.labels?.B?.[1]}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="playera">A: {settings.labels?.A?.[0]}</td>
                        <td>
                          (<span className="playera">{displayed.full.CC[0]}</span>,
                           <span className="playerb">{displayed.full.CC[1]}</span>)
                        </td>
                        <td>
                          (<span className="playera">{displayed.full.CD[0]}</span>,
                           <span className="playerb">{displayed.full.CD[1]}</span>)
                        </td>
                      </tr>
                      <tr>
                        <td className="playera">A: {settings.labels?.A?.[1]}</td>
                        <td>
                          (<span className="playera">{displayed.full.DC[0]}</span>,
                           <span className="playerb">{displayed.full.DC[1]}</span>)
                        </td>
                        <td>
                          (<span className="playera">{displayed.full.DD[0]}</span>,
                           <span className="playerb">{displayed.full.DD[1]}</span>)
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
              {displayed?.side && (
                <div>
                  <h3 className="font-semibold text-center">Your Payoffs</h3>
                  <table className={`w-full border text-center mt-2 ${roleTableClass}`}>
                    <thead>
                      <tr>
                        <th></th>
                        <th className="playerb">B: {settings.labels?.B?.[0]}</th>
                        <th className="playerb">B: {settings.labels?.B?.[1]}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="playera">A: {settings.labels?.A?.[0]}</td>
                        <td>{displayed.side.CC}</td>
                        <td>{displayed.side.CD}</td>
                      </tr>
                      <tr>
                        <td className="playera">A: {settings.labels?.A?.[1]}</td>
                        <td>{displayed.side.DC}</td>
                        <td>{displayed.side.DD}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {!gameFinished && (
            <div className="grid grid-cols-1 gap-2">
              <button
                onClick={() => submitChoice(0)}
                disabled={
                  gameFinished ||
                  !isMyTurn ||
                  myChoice === 0 ||
                  myChoice === 1 ||
                  currentRound > (settings?.rounds || 1)
                }
                className={`py-2 rounded ${
                  isMyTurn
                    ? "bg-green-600 text-white"
                    : "bg-gray-300 text-grey"
                }`}
              >
                {settings?.labels?.[role]?.[0] ?? "Option 1"}
              </button>
              <button
                onClick={() => submitChoice(1)}
                disabled={
                  gameFinished ||
                  !isMyTurn ||
                  myChoice === 0 ||
                  myChoice === 1 ||
                  currentRound > (settings?.rounds || 1)
                }
                className={`py-2 rounded ${
                  isMyTurn
                    ? "bg-red-600 text-white"
                    : "bg-gray-300 text-grey"
                }`}
              >
                {settings?.labels?.[role]?.[1] ?? "Option 2"}
              </button>
            </div>
          )}

          {!gameFinished && canRevealOpponentChoice && (
            <div className="text-center text-sm mt-2">
              👀 Opponent chose:{" "}
              {choiceLabel(role === "A" ? "B" : "A", opponentChoice)}
            </div>
          )}

          {!gameFinished && (myChoice === 0 || myChoice === 1) && (
            <div className="text-center text-sm mt-2">
              ✅ You chose: {choiceLabel(role, myChoice)}
            </div>
          )}

          {gameFinished && (
            <div className="mt-6 space-y-4">
              <div className="text-center text-xl font-bold text-green">
                ✅ Game Completed – Summary
              </div>
              {payoffs && (
                <div>
                  <h3 className="font-semibold text-center">
                    Full Payoff Matrix (A,B)
                  </h3>
                  <table className={`w-full border text-center mt-2 text-sm`}>
                    <thead>
                      <tr>
                        <th></th>
                        <th className="playerb">B: {settings.labels?.B?.[0]}</th>
                        <th className="playerb">B: {settings.labels?.B?.[1]}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="playera">A: {settings.labels?.A?.[0]}</td>
                        <td>(<span className="playera">{payoffs.CC[0]}</span>, <span className="playerb">{payoffs.CC[1]}</span>)</td>
                        <td>(<span className="playera">{payoffs.CD[0]}</span>, <span className="playerb">{payoffs.CD[1]}</span>)</td>
                      </tr>
                      <tr>
                        <td className="playera">A: {settings.labels?.A?.[1]}</td>
                        <td>(<span className="playera">{payoffs.DC[0]}</span>, <span className="playerb">{payoffs.DC[1]}</span>)</td>
                        <td>(<span className="playera">{payoffs.DD[0]}</span>, <span className="playerb">{payoffs.DD[1]}</span>)</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}

              {summaryData?.pairs.map((pair) => (
                <div
                  key={pair.index}
                  className="border rounded p-3 bg-slate-50"
                >
                  <h4 className="font-semibold mb-2">
                    Pair {pair.index}: {pair.aName} (A) vs {pair.bName} (B)
                  </h4>
                  <table className="w-full text-xs md:text-sm border text-center">
                    <thead className="bg-white">
                      <tr>
                        <th>Round</th>
                        <th>A Choice</th>
                        <th>B Choice</th>
                        <th>Outcome</th>
                        <th>Payoff A</th>
                        <th>Payoff B</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pair.rounds.map((r) => (
                        <tr key={r.round}>
                          <td>{r.round}</td>
                          <td>
                            {r.aChoice === 0 || r.aChoice === 1
                              ? choiceLabel("A", r.aChoice)
                              : "—"}
                          </td>
                          <td>
                            {r.bChoice === 0 || r.bChoice === 1
                              ? choiceLabel("B", r.bChoice)
                              : "—"}
                          </td>
                          <td>{r.cell || "—"}</td>
                          <td>{r.cell ? r.payoffA : "—"}</td>
                          <td>{r.cell ? r.payoffB : "—"}</td>
                        </tr>
                      ))}
                      <tr className="font-semibold bg-white">
                        <td colSpan={4}>Totals</td>
                        <td>{pair.totalA}</td>
                        <td>{pair.totalB}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              ))}

              {summaryData?.pairs.length === 0 && (
                <div className="text-sm text-center text-grey">
                  No complete pairs formed.
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ===================== INSTRUCTOR VIEW (URL ?user=admin) ===================== */
function InstructorView() {
  const [gameCode, setGameCode] = useState("");
  const [settings, setSettings] = useState({
    assignmentMode: "choice",
    sequential: false,
    revealPayoffs: false,
    autoProgress: false,
    rounds: 1,
    currentRound: 1,
    labels: { A: ["Cooperate", "Defect"], B: ["Cooperate", "Defect"] },
  });
  const [payoffs, setPayoffs] = useState({
    CC: [3, 3],
    CD: [0, 5],
    DC: [5, 0],
    DD: [1, 1],
  });
  const [players, setPlayers] = useState([]);
  const [roundSnapshot, setRoundSnapshot] = useState({});
  const [fullGameSnapshot, setFullGameSnapshot] = useState(null);
  const prevCompletedRef = useRef(undefined);

  useEffect(() => {
    if (!gameCode) return () => {};
    const sRef = ref(db, `games/${gameCode}/settings`);
    const pRef = ref(db, `games/${gameCode}/payoffs`);
    const unsubS = onValue(sRef, (snap) => {
      const raw = snap.val() || {};
      const defaults = {
        assignmentMode: "choice",
        sequential: false,
        revealPayoffs: false,
        autoProgress: false,
        rounds: 1,
        currentRound: 1,
        labels: { A: ["Cooperate", "Defect"], B: ["Cooperate", "Defect"] },
      };
      setSettings({ ...defaults, ...raw });
    });
    const unsubP = onValue(pRef, (snap) => {
      const p = snap.val() || null;
      if (p)
        setPayoffs({
          CC: parsePair(p.CC),
            CD: parsePair(p.CD),
            DC: parsePair(p.DC),
            DD: parsePair(p.DD),
        });
    });
    const fullRef = ref(db, `games/${gameCode}`);
    const unsubFull = onValue(fullRef, (snap) =>
      setFullGameSnapshot(snap.val() || null)
    );
    return () => {
      unsubS();
      unsubP();
      unsubFull();
    };
  }, [gameCode]);

  useEffect(() => {
    if (!gameCode) return () => {};
    const playersRef = ref(db, `games/${gameCode}/players`);
    const unsub = onValue(playersRef, (snap) => {
      const val = snap.val() || {};
      const arr = Object.entries(val).map(([k, v]) => ({ key: k, ...v }));
      setPlayers(arr);
    });
    return () => unsub();
  }, [gameCode]);

  useEffect(() => {
    if (!gameCode) return () => {};
    const r = settings.currentRound || 1;
    const roundRef = ref(db, `games/${gameCode}/rounds/${r}/players`);
    const unsub = onValue(roundRef, (snap) =>
      setRoundSnapshot(snap.val() || {})
    );
    return () => unsub();
  }, [gameCode, settings.currentRound]);

  useEffect(() => {
    if (!gameCode) return () => {};
    const r = settings.currentRound || 1;
    const completedRef = ref(db, `games/${gameCode}/rounds/${r}/completed`);
    const unsub = onValue(completedRef, (snap) => {
      const val = snap.val();
      if (prevCompletedRef.current === undefined) {
        prevCompletedRef.current = !!val;
        return;
      }
      if (!prevCompletedRef.current && val && settings.autoProgress) {
        const curRef = ref(db, `games/${gameCode}/settings/currentRound`);
        runTransaction(curRef, (cur) => {
          if (typeof cur !== "number") return;
          if (cur === settings.currentRound && cur < (settings.rounds || 1))
            return cur + 1;
          return;
        }).catch((e) => console.error("runTransaction error", e));
      }
      prevCompletedRef.current = !!val;
    });
    return () => {
      unsub();
      prevCompletedRef.current = undefined;
    };
  }, [gameCode, settings.currentRound, settings.autoProgress, settings.rounds]);

  const updateSettings = async (partial) => {
    setSettings((s) => ({ ...s, ...partial }));
    if (!gameCode) return;
    try {
      await update(ref(db, `games/${gameCode}/settings`), partial);
    } catch (e) {
      console.error(e);
    }
  };

  const updatePayoffCell = async (cell, arr) => {
    setPayoffs((p) => ({ ...p, [cell]: arr }));
    if (!gameCode) return;
    try {
      await update(ref(db, `games/${gameCode}/payoffs`), { [cell]: arr });
    } catch (e) {
      console.error(e);
    }
  };

  const startNewGame = async () => {
    if (!gameCode) return alert("Enter a game code");
    try {
      await remove(ref(db, `games/${gameCode}`));
      const sToWrite = { ...settings, currentRound: 1 };
      await set(ref(db, `games/${gameCode}/settings`), sToWrite);
      await set(ref(db, `games/${gameCode}/payoffs`), payoffs);
      setSettings((s) => ({ ...s, currentRound: 1 }));
      setPlayers([]);
      setRoundSnapshot({});
      setFullGameSnapshot(null);
      alert(`Game ${gameCode} started (DB cleared).`);
    } catch (e) {
      console.error(e);
      alert("Failed to start game");
    }
  };

  const nextRoundManual = async () => {
    if (!gameCode) return alert("Enter a game code");
    const cur = settings.currentRound || 1;
    if (cur >= settings.rounds) return alert("All rounds completed");
    const next = cur + 1;
    try {
      await update(ref(db, `games/${gameCode}/settings`), { currentRound: next });
      setSettings((s) => ({ ...s, currentRound: next }));
    } catch (e) {
      console.error(e);
      alert("Failed to advance round");
    }
  };

  // === NEW: Reveal all payoffs for current game ===
  const revealAllPayoffs = async () => {
    if (!gameCode) return alert("Enter a game code first");
    try {
      await update(ref(db, `games/${gameCode}/settings`), { revealPayoffs: true });
      alert("All payoffs revealed to students.");
    } catch (e) {
      console.error(e);
      alert("Failed to reveal payoffs.");
    }
  };

  // === NEW: Reset all users (remove players and their round choices) ===
  const resetAllUsers = async () => {
    if (!gameCode) return alert("Enter a game code first");
    if (!window.confirm("Remove ALL players and their choices? Students must re-join. Continue?")) return;
    try {
      // Remove players list
      await remove(ref(db, `games/${gameCode}/players`));

      // Remove per-round player data & completion flags
      const roundsSnap = await get(ref(db, `games/${gameCode}/rounds`));
      if (roundsSnap.exists()) {
        const roundsObj = roundsSnap.val() || {};
        const updates = {};
        Object.keys(roundsObj).forEach((r) => {
          updates[`games/${gameCode}/rounds/${r}/players`] = null;
          updates[`games/${gameCode}/rounds/${r}/completed`] = null;
        });
        if (Object.keys(updates).length) {
          await update(ref(db), updates);
        }
      }

      // Local state reset
      setPlayers([]);
      alert("All users cleared. Students must join again.");
    } catch (e) {
      console.error(e);
      alert("Failed to reset users.");
    }
  };

  // === NEW: Wipe ALL games from database ===
  const wipeAllGames = async () => {
    if (!window.confirm("This will DELETE ALL games in the database. Are you sure?")) return;
    if (!window.confirm("Final confirmation: This CANNOT be undone. Proceed?")) return;
    try {
      await remove(ref(db, "games"));
      setGameCode("");
      setPlayers([]);
      setRoundSnapshot({});
      setFullGameSnapshot(null);
      alert("All games have been removed.");
    } catch (e) {
      console.error(e);
      alert("Failed to wipe all games.");
    }
  };

  return (
    <div className="bg-white shadow rounded-lg p-6 w-full max-w-3xl space-y-4">
      <h2 className="text-lg font-bold">Instructor Dashboard</h2>

      <div className="grid md:grid-cols-2 gap-3">
        <input
          value={gameCode}
          onChange={(e) => setGameCode(e.target.value.trim())}
          placeholder="Game code"
          className="border p-2 rounded w-full"
        />
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <button
              onClick={startNewGame}
              className="bg-green-600 text-white py-2 px-3 rounded flex-1"
            >
              Start / Reset Game
            </button>
            {!settings.autoProgress && (
              <button
                onClick={nextRoundManual}
                className="bg-yellow-600 text-white py-2 px-3 rounded flex-1"
              >
                Next Round
              </button>
            )}
          </div>
          {/* NEW admin action buttons */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={revealAllPayoffs}
              disabled={!gameCode}
              className={`py-2 px-3 rounded text-white ${
                gameCode ? "bg-indigo-600" : "bg-indigo-300 cursor-not-allowed"
              }`}
            >
              Reveal Payoffs
            </button>
            <button
              onClick={resetAllUsers}
              disabled={!gameCode}
              className={`py-2 px-3 rounded text-white ${
                gameCode ? "bg-rose-600" : "bg-rose-300 cursor-not-allowed"
              }`}
            >
              Reset Users
            </button>
            <button
              onClick={wipeAllGames}
              className="py-2 px-3 rounded text-white bg-black"
            >
              Wipe ALL Games
            </button>
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <h3 className="font-semibold">Game Settings</h3>
          <label className="block mt-2">
            Assignment:
            <select
              value={settings.assignmentMode}
              onChange={(e) =>
                updateSettings({ assignmentMode: e.target.value })
              }
              className="border p-2 rounded w-full mt-1"
            >
              <option value="choice">Students choose</option>
              <option value="random">Random assignment</option>
            </select>
          </label>
          <label className="block mt-2">
            <input
              type="checkbox"
              checked={!!settings.sequential}
              onChange={(e) =>
                updateSettings({ sequential: e.target.checked })
              }
            />{" "}
            Sequential (A then B)
          </label>
          <label className="block mt-2">
            <input
              type="checkbox"
              checked={!!settings.revealPayoffs}
              onChange={(e) =>
                updateSettings({ revealPayoffs: e.target.checked })
              }
            />{" "}
            Reveal payoffs to students?
          </label>
          <label className="block mt-2">
            <input
              type="checkbox"
              checked={!!settings.autoProgress}
              onChange={(e) =>
                updateSettings({ autoProgress: e.target.checked })
              }
            />{" "}
            Automatic round progression?
          </label>
          <label className="block mt-2">
            Rounds:{" "}
            <input
              type="number"
              min={1}
              value={settings.rounds}
              onChange={(e) =>
                updateSettings({
                  rounds: Math.max(1, parseInt(e.target.value || 1)),
                })
              }
              className="border p-1 ml-2 w-24 rounded"
            />
          </label>
          <p className="text-sm mt-2">
            Current round: {settings.currentRound} / {settings.rounds}
          </p>
        </div>

        <div>
          <h3 className="font-semibold">Strategy Labels</h3>
          <div className="grid grid-cols-2 gap-2 mt-2">
            <input
              value={settings.labels.A[0]}
              onChange={(e) =>
                updateSettings({
                  labels: {
                    ...settings.labels,
                    A: [e.target.value, settings.labels.A[1]],
                  },
                })
              }
              className="border p-2 rounded"
            />
            <input
              value={settings.labels.A[1]}
              onChange={(e) =>
                updateSettings({
                  labels: {
                    ...settings.labels,
                    A: [settings.labels.A[0], e.target.value],
                  },
                })
              }
              className="border p-2 rounded"
            />
            <input
              value={settings.labels.B[0]}
              onChange={(e) =>
                updateSettings({
                  labels: {
                    ...settings.labels,
                    B: [e.target.value, settings.labels.B[1]],
                  },
                })
              }
              className="border p-2 rounded"
            />
            <input
              value={settings.labels.B[1]}
              onChange={(e) =>
                updateSettings({
                  labels: {
                    ...settings.labels,
                    B: [settings.labels.B[0], e.target.value],
                  },
                })
              }
              className="border p-2 rounded"
            />
          </div>
        </div>
      </div>

      <div>
        <h3 className="font-semibold">Payoff matrix (A,B)</h3>
        <table className="w-full border text-center mt-2">
          <thead>
            <tr>
              <th></th>
              <th>B: {settings.labels.B[0]}</th>
              <th>B: {settings.labels.B[1]}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>A: {settings.labels.A[0]}</td>
              <td>
                <input
                  className="border p-1 w-28 text-center rounded"
                  value={pairToStr(payoffs.CC)}
                  onChange={(e) =>
                    updatePayoffCell("CC", parsePair(e.target.value))
                  }
                />
              </td>
              <td>
                <input
                  className="border p-1 w-28 text-center rounded"
                  value={pairToStr(payoffs.CD)}
                  onChange={(e) =>
                    updatePayoffCell("CD", parsePair(e.target.value))
                  }
                />
              </td>
            </tr>
            <tr>
              <td>A: {settings.labels.A[1]}</td>
              <td>
                <input
                  className="border p-1 w-28 text-center rounded"
                  value={pairToStr(payoffs.DC)}
                  onChange={(e) =>
                    updatePayoffCell("DC", parsePair(e.target.value))
                  }
                />
              </td>
              <td>
                <input
                  className="border p-1 w-28 text-center rounded"
                  value={pairToStr(payoffs.DD)}
                  onChange={(e) =>
                    updatePayoffCell("DD", parsePair(e.target.value))
                  }
                />
              </td>
            </tr>
          </tbody>
        </table>
        <p className="text-xs text-grey mt-1">
          Enter cell like: <code>3,3</code>
        </p>
      </div>

      <div>
        <h3 className="font-semibold">
          Players joined ({players.length})
        </h3>
        <ul className="list-disc list-inside">
          {players.map((p) => (
            <li key={p.key}>
              {p.name} ({p.role}) — id:{" "}
              <span className="font-mono">{p.key}</span>
            </li>
          ))}
        </ul>
      </div>

      <details className="text-xs text-grey">
        <summary className="cursor-pointer">
          Debug: DB snapshot (games/{gameCode}) & current-round snapshot
        </summary>
        <div className="mt-2 space-y-2">
          <div>
            <strong>Current round snapshot:</strong>
          </div>
          <pre className="bg-slate-50 p-2 rounded max-h-48 overflow-auto">
            {JSON.stringify(roundSnapshot, null, 2)}
          </pre>
          <div>
            <strong>Full games/{gameCode} node:</strong>
          </div>
          <pre className="bg-slate-50 p-2 rounded max-h-64 overflow-auto">
            {JSON.stringify(fullGameSnapshot, null, 2)}
          </pre>
        </div>
      </details>
    </div>
  );
}

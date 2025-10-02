// src/App.jsx
import React, { useEffect, useRef, useState, useMemo } from "react";
import { ref, set, push, onValue, remove, get, update, runTransaction } from "firebase/database";
import { db } from "./firebase";
import ScreenView from "./ScreenView";
import { useAdminAuth } from "./useAdminAuth";
import { auth } from "./firebase";
import { onAuthStateChanged, signInAnonymously } from "firebase/auth";

const parsePair = (x) => {
  if (!x) return [0, 0];
  if (Array.isArray(x)) return [Number(x[0]) || 0, Number(x[1]) || 0];
  const parts = String(x).split(",").map((t) => Number(t.trim()));
  return [Number.isFinite(parts[0]) ? parts[0] : 0, Number.isFinite(parts[1]) ? parts[1] : 0];
};
const pairToStr = (arr = [0, 0]) => `${arr[0]},${arr[1]}`;

export default function App() {
  // Normalize route to work both on localhost (/) and GitHub Pages (/teaching-games/)
  function getBasePath() {
    const b = (import.meta.env.BASE_URL || '/');
    return b.endsWith('/') ? b.slice(0, -1) : b;
  }
  function resolveRoute() {
    const base = getBasePath();
    let p = window.location.pathname;
    if (base && p.startsWith(base)) p = p.slice(base.length);
    if (!p.startsWith('/')) p = '/' + p;
    p = p.replace(/\/{2,}/g, '/');
    if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
    return p || '/';
  }

  const route = resolveRoute();
  const authState = useAdminAuth();

  if (route === '/admin') {
    if (!authState.ready) return <div className="p-8">Authenticating…</div>;
    if (!authState.user)
      return (
        <div className="p-8 bg-background rounded shadow space-y-4 text-center my-auto">
          <h2 className="text-xl font-bold">Gamemaster sign-in</h2>
          <button onClick={authState.login} className="py-3 px-4 rounded bg-blue-700 hover:bg-blue-600 text-white">
            Sign in with GitHub
          </button>
        </div>
      );
    if (!authState.isAdmin)
      return (
        <div className="p-8 bg-alert rounded border text-black space-y-4 text-center my-auto">
          <h2 className="text-xl font-bold">Not authorised</h2>
          <p className="text-sm">This GitHub account does not have access to this app.</p>
          <button onClick={authState.logout} className="py-2 px-3 rounded bg-black hover:bg-orange-600 text-white">
            Sign out
          </button>
        </div>
      );
    // Authorized
    return (
      <>
        <header>
          <h1>Game theory</h1>
          <div className="text-sm flex text-grey-600 dark:text-grey-400 items-center gap-2 py-1">
            {authState.user.reloadUserInfo?.screenName}
            {" "}
            <button onClick={authState.logout} className="p-1">Sign out</button>
          </div>
        </header>
        <div className="flex items-start justify-center md:p-4 mt-auto mb-auto">
          <InstructorView />
        </div>
        <footer>
          <a href="https://www.sdu.dk/en/om-sdu/institutter-centre/oekonomiskinstitut" className="sdu" title="SDU: University of Southern Denmark"></a>
          <a href="https://www.nickford.com" className="nf" title="Nick Ford"></a>
        </footer>
      </>
    );
  }

  if (route === '/screen') {
    return (
      <div className="scoreboard w-screen h-screen">
        <ScreenView />
      </div>
    );
  }

  // Legacy support (?user=admin) → rewrite to base + /admin
  const params = new URLSearchParams(window.location.search);
  if ((params.get('user') || '').toLowerCase() === 'admin') {
    const newUrl = `${getBasePath()}/admin`;
    if (window.location.pathname + window.location.search !== newUrl) {
      window.history.replaceState({}, '', newUrl);
    }
    return (
      <>
        <header>
          <h1>Game theory</h1>
        </header>
        <div className="flex items-start justify-center md:p-4 mt-auto mb-auto">
          <InstructorView />
        </div>
        <footer>
          <a href="https://www.sdu.dk/en/om-sdu/institutter-centre/oekonomiskinstitut" className="sdu" title="SDU: University of Southern Denmark"></a>
          <a href="https://www.nickford.com" className="nf" title="Nick Ford"></a>
        </footer>
      </>
    );
  }

  return (
    <>
      <header>
        <h1>Game theory</h1>
      </header>
      <div className="flex items-start justify-center md:p-4 mt-auto mb-auto">
        <StudentView />
      </div>
      <footer>
        <a href="https://www.sdu.dk/en/om-sdu/institutter-centre/oekonomiskinstitut" className="sdu" title="SDU: University of Southern Denmark"></a>
        <a href="https://www.nickford.com" className="nf" title="Nick Ford"></a>
      </footer>
    </>
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
  const [myChoice, setMyChoice] = useState(null);
  const [gameExists, setGameExists] = useState(null); // null unknown, true exists, false missing
  const [fullGameSnapshot, setFullGameSnapshot] = useState(null);
  const [lastRoundCompleted, setLastRoundCompleted] = useState(false);
  const [currentRoundCompleted, setCurrentRoundCompleted] = useState(false);
  const [resetNotice, setResetNotice] = useState(""); // NEW: message when instructor resets users
  const [uid, setUid] = useState(null);

  // Auth state change listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (u) setUid(u.uid);
      else signInAnonymously(auth).catch(e => console.error("Anon auth error", e));
    });
    if (!auth.currentUser) {
      signInAnonymously(auth).catch(e => console.error("Anon auth error", e));
    }
    return () => unsub();
  }, []);

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
        minOpenSeconds: 10, // NEW
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
      setResetNotice("The gamemaster reset all players. Please join again.");
    }
  }, [globalPlayers, playerKey]);

  // Round players & current round completion
  useEffect(() => {
    if (!gameCode) return () => {};
    const roundRef = ref(db, `games/${gameCode}/rounds/${currentRound}/players`);
    const unsubRound = onValue(roundRef, (snap) => setRoundPlayers(snap.val() || {}));

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
    return () => unsub(); // FIX: invoke cleanup
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

  // Turn logic (updated for sequential games: A always starts each round)
  const isMyTurn = useMemo(() => {
    if (!settings || !playerKey || myIndex === -1) return false;
    if (myChoice === 0 || myChoice === 1) return false; // already moved
    if (!settings.sequential) return true;

    if (role === "A") {
      // In sequential mode A always moves first each round (even after an aborted prior round)
      return true;
    }
    if (role === "B") {
      if (!pairedAKey) return false;
      const aEntry = roundPlayers[pairedAKey];
      return !!(aEntry && (aEntry.choice === 0 || aEntry.choice === 1));
    }
    return false;
  }, [settings, playerKey, myIndex, myChoice, role, roundPlayers, pairedAKey]);

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

  // Map outcome (A row, B column) to original key (for payoff lookup) and a quadrant symbol for display
  const payoffKey = (aChoice, bChoice) => {
    if (aChoice === 0 && bChoice === 0) return "CC";
    if (aChoice === 0 && bChoice === 1) return "CD";
    if (aChoice === 1 && bChoice === 0) return "DC";
    return "DD";
  };
  // Quadrant symbols:
  // ▘ upper-left, ▝ upper-right, ▖ lower-left, ▗ lower-right
  const outcomeSymbol = (aChoice, bChoice) => {
    if (aChoice === 0 && bChoice === 0) return "▘";
    if (aChoice === 0 && bChoice === 1) return "▝";
    if (aChoice === 1 && bChoice === 0) return "▖";
    return "▗";
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
          const key = payoffKey(aC, bC);
          cell = outcomeSymbol(aC, bC);
          payoffPair = payoffs[key] || [0, 0];
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
      const settingsSnap = await get(ref(db, `games/${code}/settings`));
      const sObj = settingsSnap.val() || {};
      const minSecs = sObj.minOpenSeconds ?? 10;
      const roundMetaSnap = await get(ref(db, `games/${code}/rounds/${R}/startedAt`));
      const startedAt = roundMetaSnap.val();
      if (startedAt && Date.now() - startedAt < minSecs * 1000) {
        // Too early to mark this round completed
        return;
      }

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
    if (!uid) return alert("Auth not ready yet");
    if (!gameCode || !name) return alert("Fill all fields");
    if (settings?.assignmentMode === "choice" && !role) return alert("Select a role");

    // Auto-assign role if in random assignment mode
    let finalRole = role;
    if (settings?.assignmentMode === "random") {
      const aCount = globalPlayers.filter(p => p.role === "A").length;
      const bCount = globalPlayers.filter(p => p.role === "B").length;
      if (aCount < bCount) finalRole = "A";
      else if (bCount < aCount) finalRole = "B";
      else finalRole = Math.random() < 0.5 ? "A" : "B";
      setRole(finalRole);
    }

    if (!finalRole) return alert("Could not determine role (try again)");

    try {
      await set(ref(db, `games/${gameCode}/players/${uid}`), {
        name,
        role: finalRole,
        joinedAt: Date.now()
      });
      setPlayerKey(uid);
    } catch (e) {
      console.error(e);
      alert("Join failed");
    }
  };

  // Submit choice
  const submitChoice = async (idx) => {
    if (!uid || !settings?.currentRound) return;
    const round = settings.currentRound;
    await set(ref(db, `games/${gameCode}/rounds/${round}/players/${uid}/choice`), idx);
    await set(ref(db, `games/${gameCode}/rounds/${round}/players/${uid}/committedAt`), Date.now());
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
    <div className="bg-background flex flex-col shadow rounded-lg p-6 md:p-8 w-full max-w-[1200px] space-y-4">
      <h2 className="text-lg font-bold text-center">Do you want to play a game?</h2>

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
          required
        />
      </div>

      {resetNotice && !playerKey && (
        <div className="text-sm bg-alert p-2">{resetNotice}</div>
      )}

      {gameCode && gameExists === false && (
        <div className="text-sm text-red">
          Game code not found. Verify the code with your gamemaster.
        </div>
      )}
      {gameCode && gameExists === null && (
        <div className="text-xs text-grey-500">Checking game code...</div>
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
            className={`py-4 px-2 rounded text-white ${
              gameExists === false || !settings
                ? "cursor-not-allowed"
                : "cursor-allowed"
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
            className={`w-full py-4 px-2 rounded text-white ${
              gameExists === false || !settings
                ? "cursor-not-allowed"
                : "cursor-allowed"
            }`}
          >
            Join
          </button>
        </div>
      )}

      {playerKey && (
        <>
          <div className="grid grid-cols-2 md:flex gap-2">
            <div className = {`flex md:flex-1 flex-col items-center text-base ${roleTableClass}bg text-white rounded p-2`}>
              Player 
              <span className="font-bold text-2xl">{role}</span>
            </div>
            {!gameFinished && (
              <div className="flex md:flex-1 flex-col items-center text-base bg-grey-500 text-white tabular-nums rounded p-2">
                Round 
                <span className="text-2xl text-grey-200"><span className="font-bold text-white">{Math.min(currentRound, settings?.rounds || 1)}</span> /{" "}
                {settings?.rounds || 1}</span>
              </div>
            )}
            {gameFinished && (
              <div className="flex md:flex-1 flex-col items-center justify-center font-bold text-xl text-center leading-[1.1] bg-cyan-500 text-white tabular-nums rounded p-2">
                Game over!
              </div>
            )}
            <div className="col-span-2 md:col-span-1 md:flex-4 flex flex-col justify-between text-base bg-grey-200 dark:bg-grey-600 dark:text-white rounded p-2">
              You: {name}
              <span className="text-xs text-grey-500">id:{" "}
              <span className="font-mono">{playerKey}</span></span>
            </div>

          </div>

          {!gameFinished && (
            <div>
              {!displayed && (
                <div className="text-center text-red font-semibold">
                  ⏳ Wait for your turn
                </div>
              )}
              {displayed?.full && (
                <div className="overflow-auto">
                  <h3 className="font-semibold text-center">
                    Payoffs (A,B)
                  </h3>
                  <table className={`w-full text-center mt-2 ${roleTableClass}`}>
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
                <div className="overflow-auto">
                  <h3 className="font-semibold text-center">Your payoffs</h3>
                  <table className={`w-full text-center mt-2 ${roleTableClass}`}>
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
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => submitChoice(0)}
                disabled={
                  gameFinished ||
                  !isMyTurn ||
                  myChoice === 0 ||
                  myChoice === 1 ||
                  currentRound > (settings?.rounds || 1)
                }
                className={`py-4 px-2 rounded ${
                  isMyTurn
                    ? "cursor-allowed"
                    : "cursor-not-allowed"
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
                className={`py-4 px-2 rounded ${
                  isMyTurn
                    ? "cursor-allowed"
                    : "cursor-not-allowed"
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
            <div className="mt-2 space-y-4">
              {payoffs && (
                <div className="overflow-auto">
                  <h3 className="font-semibold text-center">
                    Payoff matrix (A,B)
                  </h3>
                  <table className={`w-full text-center mt-2 text-base`}>
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

               {(() => {
                 if (!summaryData) return null;
                 // Reorder so the current player's pair (if any) comes first
                 const ordered = [];
                 const others = [];
                 summaryData.pairs.forEach(p => {
                   if (p.aKey === playerKey || p.bKey === playerKey) ordered.push(p);
                   else others.push(p);
                 });
                 const finalList = [...ordered, ...others];
                 let otherCounter = 1;
                 return finalList.map(p => {
                   const isMine = p.aKey === playerKey || p.bKey === playerKey;
                   const heading = isMine ? `Your pair: ${p.aName} (A) vs ${p.bName} (B)` : `Pair ${otherCounter++}`;
                   return (
                     <div
                       key={`${p.index}-${isMine ? 'mine' : 'other'}`}
                       className={`rounded overflow-auto p-2 ${isMine ? "bg-blue" : "bg-toned"}`}
                     >
                       <h4 className="font-semibold mb-4 tabular-nums">{heading}</h4>
                       <table className="w-full text-(length:--font-size--fineprint) md:text-sm text-center table-p-1">
                         <thead className={`bg-background ${isMine ? "text-blue" : ""}`}>
                           <tr>
                             <th>Round</th>
                             <th>A's choice</th>
                             <th>B's choice</th>
                             <th>Quadrant</th>
                             <th>A's payoff</th>
                             <th>B's payoff</th>
                           </tr>
                         </thead>
                         <tbody>
                           {p.rounds.map(r => (
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
                               <td>
                                 {r.cell ? (
                                   <span className="outcome-symbol">{r.cell}</span>
                                 ) : (
                                   "—"
                                 )}
                               </td>
                               <td>{r.cell ? r.payoffA : "—"}</td>
                               <td>{r.cell ? r.payoffB : "—"}</td>
                             </tr>
                           ))}
                           <tr className={`font-semibold bg-background ${isMine ? "text-blue" : ""}`}>
                             <td colSpan={4}>Totals</td>
                             <td>{p.totalA}</td>
                             <td>{p.totalB}</td>
                           </tr>
                         </tbody>
                       </table>
                     </div>
                   );
                 });
               })()}

              {summaryData?.pairs.length === 0 && (
                <div className="text-sm text-center text-grey-500">
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
    assignmentMode: "random",
    sequential: false,
    revealPayoffs: false,
    autoProgress: false,
    rounds: 1,
    currentRound: 1,
    labels: { A: ["Cooperate", "Defect"], B: ["Cooperate", "Defect"] },
    minOpenSeconds: 10, // NEW
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
  const [currentScreenGame, setCurrentScreenGame] = useState(null);
  // NEW: track startedAt + completion state of current round
  const [currentRoundStartedAt, setCurrentRoundStartedAt] = useState(null); // NEW
  const [currentRoundCompleted, setCurrentRoundCompleted] = useState(false); // NEW

  // Settings & payoffs subscription
  useEffect(() => {
    if (!gameCode) return () => {};
    const sRef = ref(db, `games/${gameCode}/settings`);
    const pRef = ref(db, `games/${gameCode}/payoffs`);
    const unsubS = onValue(sRef, (snap) => {
      const raw = snap.val() || {};
      const defaults = {
        assignmentMode: "random",
        sequential: false,
        revealPayoffs: false,
        autoProgress: false,
        rounds: 1,
        currentRound: 1,
        labels: { A: ["Cooperate", "Defect"], B: ["Cooperate", "Defect"] },
        minOpenSeconds: 10, // NEW
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

  // Players list
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

  // Round players
  useEffect(() => {
    if (!gameCode) return () => {};
    const r = settings.currentRound || 1;
    const roundRef = ref(db, `games/${gameCode}/rounds/${r}/players`);
    const unsub = onValue(roundRef, (snap) => setRoundSnapshot(snap.val() || {}));
    return () => unsub();
  }, [gameCode, settings.currentRound]);

  // NEW: subscribe to startedAt of current round
  useEffect(() => {
    if (!gameCode) return () => {};
    const r = settings.currentRound || 1;
    const sRef = ref(db, `games/${gameCode}/rounds/${r}/startedAt`);
    const unsub = onValue(sRef, snap => setCurrentRoundStartedAt(snap.val() || null));
    return () => unsub();
  }, [gameCode, settings.currentRound]);

  // Completed flag & auto progression (store completion state)
  useEffect(() => {
    if (!gameCode) return () => {};
    const r = settings.currentRound || 1;
    const completedRef = ref(db, `games/${gameCode}/rounds/${r}/completed`);
    const unsub = onValue(completedRef, (snap) => {
      const val = snap.val();
      setCurrentRoundCompleted(!!val); // NEW
      if (prevCompletedRef.current === undefined) {
        prevCompletedRef.current = !!val;
        return;
      }
      if (!prevCompletedRef.current && val && settings.autoProgress) {
        const curRef = ref(db, `games/${gameCode}/settings/currentRound`);
        runTransaction(curRef, (cur) => {
          if (typeof cur !== "number") return;
            if (cur === settings.currentRound && cur < (settings.rounds || 1)) return cur + 1;
          return;
        })
          .then(async (res) => {
            if (res.committed) {
              const newVal = res.snapshot.val();
              if (newVal && newVal !== settings.currentRound) {
                await set(ref(db, `games/${gameCode}/rounds/${newVal}/startedAt`), Date.now());
              }
            }
          })
          .catch((e) => console.error("runTransaction error", e));
      }
      prevCompletedRef.current = !!val;
    });
    return () => {
      unsub();
      prevCompletedRef.current = undefined;
    };
  }, [gameCode, settings.currentRound, settings.autoProgress, settings.rounds]);

  // NEW: auto-complete a round when all pairs have chosen AND minOpenSeconds elapsed
  useEffect(() => {
    if (!gameCode) return;
    if (!settings.autoProgress) return;
    if (currentRoundCompleted) return;

    const r = settings.currentRound || 1;
    const minSecs = settings.minOpenSeconds ?? 0;

    // Build ordered role arrays
    const aKeys = players.filter(p => p.role === "A").map(p => p.key);
    const bKeys = players.filter(p => p.role === "B").map(p => p.key);
    const pairCount = Math.min(aKeys.length, bKeys.length);
    if (pairCount === 0) return; // nothing to do

    // Check if every pair has both choices
    for (let i = 0; i < pairCount; i++) {
      const aEntry = roundSnapshot[aKeys[i]];
      const bEntry = roundSnapshot[bKeys[i]];
      const aDone = aEntry && (aEntry.choice === 0 || aEntry.choice === 1);
      const bDone = bEntry && (bEntry.choice === 0 || bEntry.choice === 1);
      if (!aDone || !bDone) return; // still waiting
    }

    // All pairs done; ensure min time elapsed
    if (!currentRoundStartedAt) return;
    const elapsed = Date.now() - currentRoundStartedAt;
    if (elapsed < minSecs * 1000) {
      const remaining = minSecs * 1000 - elapsed + 25;
      const t = setTimeout(() => {
        // Re-check completion & still same round
        if (!currentRoundCompleted && settings.currentRound === r) {
          set(ref(db, `games/${gameCode}/rounds/${r}/completed`), true)
            .catch(e => console.error("auto-complete (delayed) error", e));
        }
      }, remaining);
      return () => clearTimeout(t);
    } else {
      // Min time already satisfied
      set(ref(db, `games/${gameCode}/rounds/${r}/completed`), true)
        .catch(e => console.error("auto-complete error", e));
    }
  }, [
    gameCode,
    settings.autoProgress,
    settings.currentRound,
    settings.minOpenSeconds,
    players,
    roundSnapshot,
    currentRoundStartedAt,
    currentRoundCompleted
  ]);

  // Subscribe to currentGame (public screen toggle)
  useEffect(() => {
    const cgRef = ref(db, "currentGame");
    const unsub = onValue(cgRef, snap => {
      const v = snap.val();
      setCurrentScreenGame(typeof v === "string" ? v : null);
    });
    return () => unsub();
  }, []);

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
      await set(ref(db, `games/${gameCode}/rounds/1/startedAt`), Date.now());
      // NEW: point /currentGame to this code for /screen
      await set(ref(db, "currentGame"), gameCode);
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

  const endOrNextRound = async () => {
    if (!gameCode) return alert("Enter a game code");
    const cur = settings.currentRound || 1;
    const last = settings.rounds || 1;
    try {
      // Mark current round completed regardless of missing choices or minOpenSeconds
      await set(ref(db, `games/${gameCode}/rounds/${cur}/completed`), true);

      if (cur < last) {
        if (settings.autoProgress) {
          // Auto progression listener will detect completion and advance.
          return;
        }
        // Manual advance (autoProgress off)
        const next = cur + 1;
        await update(ref(db, `games/${gameCode}/settings`), { currentRound: next });
        await set(ref(db, `games/${gameCode}/rounds/${next}/startedAt`), Date.now());
        setSettings(s => ({ ...s, currentRound: next }));
      } else {
        // Last round: students will see summary (they react to completed flag)
        alert("Game ended.");
      }
    } catch (e) {
      console.error(e);
      alert("Failed to end / advance round");
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

  // === NEW (replaces resetAllUsers): Drop only inactive (no choice yet) users this round and end the round
  const dropInactiveUsers = async () => {
    if (!gameCode) return alert("Enter a game code first");
    const cur = settings.currentRound || 1;
    try {
      const roundPlayersSnap = await get(ref(db, `games/${gameCode}/rounds/${cur}/players`));
      const roundPlayersObj = roundPlayersSnap.val() || {};
      const inactiveKeys = Object.entries(roundPlayersObj)
        .filter(([, p]) => !(p && (p.choice === 0 || p.choice === 1)))
        .map(([k]) => k);

      if (!inactiveKeys.length) {
        alert("No inactive users to drop (all have chosen).");
        // Still force-complete the round (acts as override)
        await set(ref(db, `games/${gameCode}/rounds/${cur}/completed`), true);
        return;
      }

      if (!window.confirm(`Drop ${inactiveKeys.length} inactive user(s) (have not chosen) and end the round?`))
        return;

      // Collect updates: remove players + their round entries (for all rounds up to current)
      const roundsSnap = await get(ref(db, `games/${gameCode}/rounds`));
      const roundsObj = roundsSnap.val() || {};
      const updates = {};
      inactiveKeys.forEach((k) => {
        updates[`games/${gameCode}/players/${k}`] = null;
        Object.keys(roundsObj).forEach(rKey => {
          // Only clean up existing earlier/current rounds (string keys)
            updates[`games/${gameCode}/rounds/${rKey}/players/${k}`] = null;
        });
      });

      // Mark current round completed (forces progression / end logic)
      updates[`games/${gameCode}/rounds/${cur}/completed`] = true;

      await update(ref(db), updates);

      // Local state cleanup
      setPlayers(prev => prev.filter(p => !inactiveKeys.includes(p.key)));
      setRoundSnapshot(prev => {
        const clone = { ...prev };
        inactiveKeys.forEach(k => delete clone[k]);
        return clone;
      });

      alert(`Dropped ${inactiveKeys.length} inactive user(s) and ended round ${cur}.`);
    } catch (e) {
      console.error(e);
      alert("Failed to drop inactive users.");
    }
  };

  // Wipe ALL games (danger)
  const wipeAllGames = async () => {
    if (!window.confirm("Delete ALL games from the database?")) return;
    if (!window.confirm("This cannot be undone. Confirm again to proceed.")) return;
    try {
      await remove(ref(db, "games"));
      await remove(ref(db, "currentGame"));
      setGameCode("");
      setSettings(s => ({ ...s, currentRound: 1 }));
      setPlayers([]);
      setRoundSnapshot({});
      setFullGameSnapshot(null);
      alert("All games deleted.");
    } catch (e) {
      console.error(e);
      alert("Failed to wipe games.");
    }
  };

  // Toggle screen (public /screen view)
  const toggleScreen = async () => {
    if (!gameCode) return alert("Enter a game code first");
    try {
      if (currentScreenGame === gameCode) {
        await remove(ref(db, "currentGame"));            // disables
        alert("Screen disabled.");
      } else {
        await set(ref(db, "currentGame"), gameCode);     // enables
        alert("Screen enabled for this game.");
      }
    } catch (e) {
      console.error(e);
      alert("Failed to toggle screen.");
    }
  };

  return (
    <div className="bg-background flex flex-col shadow rounded-lg p-6 md:p-8 w-full max-w-[1000px] space-y-8">
      <h2 className="text-lg font-bold">Administrator dashboard</h2>

      <div className="grid md:grid-cols-2 gap-2">
        <input
          value={gameCode}
          onChange={(e) => setGameCode(e.target.value.trim())}
          placeholder="Game code"
          className="border p-2 rounded w-full"
          required
        />
        <div className="flex gap-2">
          <button
            onClick={startNewGame}
            className="py-4 px-3 rounded flex-1 bg-cyan"
          >
            Start / reset game
          </button>
          {/* Always show manual override button (even when autoProgress is on) */}
          <button
            onClick={endOrNextRound}
            className="py-4 px-3 rounded flex-1"
            title="Force end of current round (manual override even if automatic progression is enabled)"
          >
            End / next round
          </button>
          <button
            onClick={toggleScreen}
            disabled={!gameCode}
            className={`py-4 px-3 rounded flex-1 ${gameCode ? "" : "cursor-not-allowed"}`}
            title="Enable or disable the public /screen view for this game code"
          >
            {currentScreenGame === gameCode ? "Disable screen" : "Enable screen"}
          </button>
        </div>
        {gameCode && (
          <p className="text-xs text-grey-500 mt-1">
            Screen status: {currentScreenGame === gameCode
              ? "Broadcasting this game"
              : currentScreenGame
                ? `Broadcasting another game (${currentScreenGame})`
                : "Inactive"}
          </p>
        )}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <h3 className="font-semibold">Game settings</h3>
          <label className="flex items-center justify-start mt-2">
            Players:
            <select
              value={settings.assignmentMode}
              onChange={(e) =>
                updateSettings({ assignmentMode: e.target.value })
              }
              className="border p-1 ml-2 w-24 rounded"
            >
              <option value="random">Automatic assignment</option>
              <option value="choice">Students choose</option>
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
          
        </div>

        <div>
          <h3 className="font-semibold">Rounds</h3>
          <div>
            <label className="flex items-center justify-start mt-2">
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
            <label className="flex items-center justify-start mt-2">
              Minimum time:{" "}
              <input
                type="number"
                min={0}
                value={settings.minOpenSeconds ?? 10}
                onChange={(e) =>
                  updateSettings({
                    minOpenSeconds: Math.max(0, parseInt(e.target.value || 0)),
                  })
                }
                className="border p-1 ml-2 w-24 rounded"
              />
            </label>
            <p className="text-sm mt-2">
              Time given in seconds. A round cannot complete (and auto-progress) before this time elapses.
            </p>
          </div>
        </div>
        
      </div>

      <div>
        <h3 className="font-semibold">Payoff matrix (A,B)</h3>
        <table className="w-full text-center mt-2 border-separate border-spacing-2">
          <thead>
            <tr>
              <th className="w-1/3"></th>
              <th className="w-1/3">
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
                  className="border p-1 text-center rounded w-1/1"
                />
              </th>
              <th className="w-1/3">
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
                  className="border p-1 text-center rounded w-1/1"
                />
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
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
                  className="border p-1 text-center rounded w-1/1"
                />
              </td>
              <td>
                <input
                  className="border p-1 text-center rounded w-1/1"
                  value={pairToStr(payoffs.CC)}
                  onChange={(e) =>
                    updatePayoffCell("CC", parsePair(e.target.value))
                  }
                />
              </td>
              <td>
                <input
                  className="border p-1 text-center rounded w-1/1"
                  value={pairToStr(payoffs.CD)}
                  onChange={(e) =>
                    updatePayoffCell("CD", parsePair(e.target.value))
                  }
                />
              </td>
            </tr>
            <tr>
              <td>
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
                  className="border p-1 text-center rounded w-1/1"
                />
              </td>
              <td>
                <input
                  className="border p-1 text-center rounded w-1/1"
                  value={pairToStr(payoffs.DC)}
                  onChange={(e) =>
                    updatePayoffCell("DC", parsePair(e.target.value))
                  }
                />
              </td>
              <td>
                <input
                  className="border p-1 text-center rounded w-1/1"
                  value={pairToStr(payoffs.DD)}
                  onChange={(e) =>
                    updatePayoffCell("DD", parsePair(e.target.value))
                  }
                />
              </td>
            </tr>
          </tbody>
        </table>
        <p className="flex items-center gap-1 text-xs text-grey-500 mt-1">
          Enter cell like: <span className="border border-grey-500-200 px-[0.2rem] py-[0.1rem] rounded">3,3</span>
        </p>
      </div>

      <div className="grid gap-2">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={revealAllPayoffs}
            disabled={!gameCode}
            className={`py-4 px-3 rounded text-white ${
              gameCode ? "cursor-allowed" : "cursor-not-allowed"
            }`}
          >
            Reveal payoffs
          </button>
          <button
            onClick={dropInactiveUsers}
            disabled={!gameCode}
            className={`py-4 px-3 rounded text-white ${
              gameCode ? "cursor-allowed" : "cursor-not-allowed"
            }`}
            title="Remove only players who have not yet chosen this round and force round end"
          >
            Drop inactive users
          </button>
          <button
            onClick={wipeAllGames}
            className="py-4 px-3 rounded bg-alert"
          >
            Wipe <strong>ALL</strong> games
          </button>
        </div>
      </div>


      <div>
        <h3 className="font-semibold mb-2">
          Players joined ({players.length})
        </h3>
        <ul className="list-disc list-inside text-base">
          {players.map((p) => (
            <li key={p.key}>
              {p.name} ({p.role}) — id:{" "}
              <span className="font-mono">{p.key}</span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h3 className="font-semibold mb-2">
          Current round players ({Object.keys(roundSnapshot).length})
        </h3>
        <ul className="list-disc list-inside text-base">
          {Object.entries(roundSnapshot).map(([k, rp]) => {
            const meta = players.find(pl => pl.key === k);
            const name = meta?.name || 'Unknown';
            const role = meta?.role || '?';
            return (
              <li key={k}>
                {name} ({role}) — id: <span className="font-mono">{k}</span>
                {(rp.choice === 0 || rp.choice === 1) && (
                  <span className="ml-2 text-xs text-grey-500">
                    Choice: {settings.labels?.[role]?.[rp.choice] ?? rp.choice}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <details className="text-xs text-grey-500">
        <summary className="cursor-pointer">
          Debug: DB snapshot (games/{gameCode}) & current-round snapshot
        </summary>
        <div className="mt-2 space-y-2">
          <div>
            <strong>Current round snapshot:</strong>
          </div>
          <pre className="bg-background p-2 rounded max-h-48 overflow-auto">
            {JSON.stringify(roundSnapshot, null, 2)}
          </pre>
          <div>
            <strong>Full games/{gameCode} node:</strong>
          </div>
          <pre className="bg-background p-2 rounded max-h-64 overflow-auto">
            {JSON.stringify(fullGameSnapshot, null, 2)}
          </pre>
        </div>
      </details>
    </div>
  );
}

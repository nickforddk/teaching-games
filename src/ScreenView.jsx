import React, { useEffect, useState, useMemo } from "react";
import { db } from "./firebase";
import { ref, onValue } from "firebase/database";

const parsePair = (x) => {
  if (!x) return [0, 0];
  if (Array.isArray(x)) return [Number(x[0]) || 0, Number(x[1]) || 0];
  const parts = String(x).split(",").map(t => Number(t.trim()));
  return [Number.isFinite(parts[0]) ? parts[0] : 0, Number.isFinite(parts[1]) ? parts[1] : 0];
};

export default function ScreenView() {
  const [currentGameCode, setCurrentGameCode] = useState(null);
  const [gameSnapshot, setGameSnapshot] = useState(null);

  useEffect(() => {
    const cgRef = ref(db, "currentGame");
    const off = onValue(cgRef, snap => {
      const v = snap.val();
      setCurrentGameCode(typeof v === "string" ? v : null);
    });
    return () => off();
  }, []);

  useEffect(() => {
    if (!currentGameCode) { setGameSnapshot(null); return; }
    const gRef = ref(db, `games/${currentGameCode}`);
    const off = onValue(gRef, snap => setGameSnapshot(snap.val() || null));
    return () => off();
  }, [currentGameCode]);

  const { settings, payoffs, players, rounds } = gameSnapshot || {};

  const parsedPayoffs = useMemo(() => {
    if (!payoffs) return null;
    return {
      CC: parsePair(payoffs.CC),
      CD: parsePair(payoffs.CD),
      DC: parsePair(payoffs.DC),
      DD: parsePair(payoffs.DD),
    };
  }, [payoffs]);

  const gameFinished = useMemo(() => {
    if (!settings) return false;
    if (settings.currentRound !== settings.rounds) return false;
    return !!rounds?.[settings.rounds]?.completed;
  }, [settings, rounds]);

  const summaryPairs = useMemo(() => {
    if (!gameFinished || !players || !rounds || !parsedPayoffs || !settings) return [];
    const arr = Object.entries(players).map(([k, v]) => ({ key: k, ...v }));
    const A = arr.filter(p => p.role === "A").map(p => p.key);
    const B = arr.filter(p => p.role === "B").map(p => p.key);
    const n = Math.min(A.length, B.length);
    const payoffKey = (a,b) => (a===0&&b===0?"CC":a===0&&b===1?"CD":a===1&&b===0?"DC":"DD");
    const symbol = (a,b) => (a===0&&b===0?"▘":a===0&&b===1?"▝":a===1&&b===0?"▖":"▗");
    const out = [];
    for (let i=0;i<n;i++){
      const aKey = A[i], bKey = B[i];
      let totalA=0,totalB=0;
      const perRound=[];
      for (let r=1;r<=settings.rounds;r++){
        const rp = rounds?.[r]?.players || {};
        const aC = rp[aKey]?.choice;
        const bC = rp[bKey]?.choice;
        let cell=null,pA=0,pB=0;
        if (aC!=null && bC!=null){
          const k = payoffKey(aC,bC);
          pA = parsedPayoffs[k]?.[0]||0;
            pB = parsedPayoffs[k]?.[1]||0;
          totalA+=pA; totalB+=pB;
          cell = symbol(aC,bC);
        }
        perRound.push({ round:r, aChoice:aC, bChoice:bC, cell, payoffA:pA, payoffB:pB });
      }
      out.push({
        index:i+1,
        aName: players[aKey]?.name || "A?",
        bName: players[bKey]?.name || "B?",
        rounds: perRound,
        totalA, totalB
      });
    }
    return out;
  }, [gameFinished, players, rounds, parsedPayoffs, settings]);

  if (!currentGameCode)
    return (
        <div className="w-screen h-screen flex items-center justify-center">
          <div className="flex flex-col items-center justify-center text-center text-2xl px-6 py-8 bg-grey-400 text-blue-800 dark:bg-grey-700 dark:text-grey-200 rounded">
            <span className="qrcode size-[15rem]"></span>
            git.nickford.com/<span>teaching-games</span>
          </div>
        </div>
    );

  if (!gameFinished)
    return (
        <div className="w-screen h-screen flex items-center justify-center">
          <div className="grid grid-rows-2 md:grid-cols-2 md:grid-rows-1 text-center gap-4">
            <div className="flex flex-col justify-center gap-4 p-8 bg-grey-500 dark:bg-grey-600 text-white rounded">
              <h2 className="text-center text-white">Enter game code</h2>
              <code className="text-6xl m-1 px-2 py-1">{currentGameCode}</code>
            </div>
            <div className="flex flex-col items-center justify-center text-center text-2xl/6 px-6 py-8 bg-grey-400 text-blue-800 dark:bg-grey-700 dark:text-grey-200 rounded">
              <span className="qrcode size-[15rem]"></span>
              git.nickford.com/<span>teaching-games</span>
            </div>
          </div>
        </div>
      )
  ;

  return (
    <div className="flex flex-col w-full h-full gap-8 md:flex-row">
      <div className="flex flex-col w-full h-screen space-y-6 mt-auto mb-auto">
        {parsedPayoffs && settings && (
          <div className="border border-grey-500 rounded px-2 py-4">
            <table className="w-full text-center text-5xl leading-[1.75]">
              <thead>
                <tr className="text-2xl leading-[1.25]">
                  <th className="font-normal text-base text-grey-500">Payoff matrix (A,B)</th>
                  <th className="playerb">B: {settings.labels?.B?.[0]}</th>
                  <th className="playerb">B: {settings.labels?.B?.[1]}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="playera text-2xl leading-[1.25]">A: {settings.labels?.A?.[0]}</td>
                  <td>(<span className="playera">{parsedPayoffs.CC[0]}</span>, <span className="playerb">{parsedPayoffs.CC[1]}</span>)</td>
                  <td>(<span className="playera">{parsedPayoffs.CD[0]}</span>, <span className="playerb">{parsedPayoffs.CD[1]}</span>)</td>
                </tr>
                <tr>
                  <td className="playera text-2xl leading-[1.25]">A: {settings.labels?.A?.[1]}</td>
                  <td>(<span className="playera">{parsedPayoffs.DC[0]}</span>, <span className="playerb">{parsedPayoffs.DC[1]}</span>)</td>
                  <td>(<span className="playera">{parsedPayoffs.DD[0]}</span>, <span className="playerb">{parsedPayoffs.DD[1]}</span>)</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        <div className="space-y-1 overflow-auto">
          {summaryPairs.map(p => (
            <div key={p.index} className="flex rounded bg-blue-100 p-4 overflow-auto">
              <h4 title={`${p.aName} (A) vs ${p.bName} (B)`} className="font-semibold mb-4 tabular-nums w-[10rem]">
                Pair {p.index}
              </h4>
              <table className="w-full text-center">
                <thead className="bg-white">
                  <tr>
                    <th>Round</th>
                    <th>A choice</th>
                    <th>B choice</th>
                    <th>Quadrant</th>
                    <th>A payoff</th>
                    <th>B payoff</th>
                  </tr>
                </thead>
                <tbody>
                  {p.rounds.map(r => (
                    <tr key={r.round}>
                      <td>{r.round}</td>
                      <td>{r.aChoice===0?settings.labels?.A?.[0]:r.aChoice===1?settings.labels?.A?.[1]:"—"}</td>
                      <td>{r.bChoice===0?settings.labels?.B?.[0]:r.bChoice===1?settings.labels?.B?.[1]:"—"}</td>
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
                  <tr className="font-semibold bg-white">
                    <td colSpan={4}>Totals</td>
                    <td>{p.totalA}</td>
                    <td>{p.totalB}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ))}
          {summaryPairs.length === 0 && <div className="text-center text-sm text-grey">No complete pairs.</div>}
        </div>
      </div>
      <div className="md:w-xs bg-grey-500 dark:bg-grey-600 text-white flex md:flex-col gap-4 items-center justify-between rounded">
          <code className="text-4xl mt-6 mx-4 px-2 py-1">{currentGameCode}</code>
          <div className="flex flex-col md:w-full items-center text-center text-md leading-5 px-4 py-8 bg-grey-400 text-blue-800 dark:bg-grey-700 dark:text-grey-200 rounded">
            <span className="qrcode size-[4rem] md:size-[10rem] mb-2"></span>
            git.nickford.com/<span>teaching-games</span>
          </div>
      </div>
    </div>
  );
}
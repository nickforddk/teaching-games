import React, { useEffect, useState, useMemo } from "react";
import { db } from "./firebase";
import { ref, onValue, get } from "firebase/database";

const parsePair = (x) => {
  if (!x) return [0, 0];
  if (Array.isArray(x)) return [Number(x[0]) || 0, Number(x[1]) || 0];
  const parts = String(x).split(",").map(t => Number(t.trim()));
  return [Number.isFinite(parts[0]) ? parts[0] : 0, Number.isFinite(parts[1]) ? parts[1] : 0];
};

export default function ScreenView() {
  const [currentGameCode, setCurrentGameCode] = useState(null);
  const [gameSnapshot, setGameSnapshot] = useState(null);
  const [connected, setConnected] = useState(true);

  // Safe embedded check (cross-origin iframes can throw)
  const isEmbedded = useMemo(() => {
    try { return window.self !== window.top; } catch { return true; }
  }, []);

  // Monitor RTDB connection (websocket) state
  useEffect(() => {
    const cRef = ref(db, ".info/connected");
    const unsub = onValue(cRef, (snap) => setConnected(!!snap.val()));
    return () => unsub();
  }, []);

  // Primary subscription for currentGame (works in normal windows)
  useEffect(() => {
    const cgRef = ref(db, "currentGame");
    const unsub = onValue(cgRef, (snap) => {
      const v = snap.val();
      setCurrentGameCode(typeof v === "string" ? v : null);
    });
    return () => unsub();
  }, []);

  // Fallback: poll currentGame when embedded or when disconnected
  useEffect(() => {
    if (!isEmbedded) return () => {};
    let cancelled = false;
    let t;
    async function poll() {
      try {
        const s = await get(ref(db, "currentGame"));
        if (!cancelled) {
          const v = s.exists() ? s.val() : null;
          setCurrentGameCode(typeof v === "string" ? v : null);
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) t = setTimeout(poll, connected ? 5000 : 2000);
      }
    }
    poll();
    return () => { cancelled = true; if (t) clearTimeout(t); };
  }, [isEmbedded, connected]);

  // Subscribe to the current game's data (normal flow)
  useEffect(() => {
    if (!currentGameCode) return () => {};
    const gRef = ref(db, `games/${currentGameCode}`);
    const unsub = onValue(gRef, (snap) => setGameSnapshot(snap.val() || null));
    return () => unsub();
  }, [currentGameCode]);

  // Fallback: poll the current game when embedded (works even if websockets are blocked)
  useEffect(() => {
    if (!isEmbedded || !currentGameCode) return () => {};
    let cancelled = false;
    let t;
    async function poll() {
      try {
        const s = await get(ref(db, `games/${currentGameCode}`));
        if (!cancelled) setGameSnapshot(s.val() || null);
      } catch {
        // ignore
      } finally {
        if (!cancelled) t = setTimeout(poll, connected ? 2000 : 1000);
      }
    }
    poll();
    return () => { cancelled = true; if (t) clearTimeout(t); };
  }, [isEmbedded, currentGameCode, connected]);

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

  // NEW: heatmap counts, shares, and opacity scaler for CC/CD/DC/DD
  const heat = useMemo(() => {
    const counts = { CC: 0, CD: 0, DC: 0, DD: 0 };
    if (!players || !rounds || !settings) {
      return {
        counts,
        shares: { CC: 0, CD: 0, DC: 0, DD: 0 },
        alpha: () => 0,
        percent: () => '0%',
      };
    }

    const arr = Object.entries(players).map(([k, v]) => ({ key: k, ...v }));
    const A = arr.filter(p => p.role === 'A').map(p => p.key);
    const B = arr.filter(p => p.role === 'B').map(p => p.key);
    const n = Math.min(A.length, B.length);

    const payoffKey = (a, b) =>
      a === 0 && b === 0 ? 'CC' :
      a === 0 && b === 1 ? 'CD' :
      a === 1 && b === 0 ? 'DC' : 'DD';

    // Count outcomes across all formed pairs and all rounds up to currentRound
    const upTo = Math.max(1, Number(settings.currentRound) || 1);
    for (let i = 0; i < n; i++) {
      const aKey = A[i], bKey = B[i];
      for (let r = 1; r <= upTo; r++) {
        const rp = rounds?.[r]?.players || {};
        const aC = rp[aKey]?.choice;
        const bC = rp[bKey]?.choice;
        if (aC != null && bC != null) {
          counts[payoffKey(aC, bC)] += 1;
        }
      }
    }

    const nonZero = Object.values(counts).filter(c => c > 0);
    const min = nonZero.length ? Math.min(...nonZero) : 0;
    const max = nonZero.length ? Math.max(...nonZero) : 0;

    const alpha = (k) => {
      const c = counts[k] || 0;
      if (c === 0) return 0.05; // very faint if never selected
      if (min === max) return 1; // all equal, show full
      return 0.25 + ((c - min) / (max - min)) * 0.75; // 0.25..1
    };

    // NEW: percentage shares per quadrant
    const keys = ['CC', 'CD', 'DC', 'DD'];
    const total = keys.reduce((s, k) => s + (counts[k] || 0), 0);
    const shares = keys.reduce((acc, k) => {
      acc[k] = total > 0 ? (counts[k] || 0) / total : 0;
      return acc;
    }, /** @type {Record<string, number>} */ ({}));

    const percent = (k, digits = 0) => `${(shares[k] * 100).toFixed(digits)}%`;

    return { counts, shares, alpha, percent };
  }, [players, rounds, settings]);

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
    <div className="flex flex-col w-full h-full gap-8 md:flex-row cursor-default">
      <div className="flex flex-col w-full h-screen space-y-6 mt-auto mb-auto">
        {parsedPayoffs && settings && (
          <div className="border border-grey-500 rounded p-2">
            <table className="w-full text-center text-5xl leading-[1.75] border-separate table-fixed">
              <thead>
                <tr className="text-2xl leading-[1.25]">
                  <th className="font-normal text-base text-grey-500">Payoff matrix (A, B)</th>
                  <th className="playerb py-2">B: {settings.labels?.B?.[0]}</th>
                  <th className="playerb py-2">B: {settings.labels?.B?.[1]}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="playera py-2 text-2xl leading-[1.25]">A: {settings.labels?.A?.[0]}</td>
                  <td
                    className="rounded-lg border scale-(--force-scale) hover:scale-100 transition-all cursor-pointer"
                    style={{ borderColor: `oklch(from var(--color-blue-700) l c h / ${heat.alpha('CC')})`, "--force-scale": `calc(0.5 + (${heat.alpha('CC')} / 2))` }} 
                  >
                    {heat.counts.CC > 0 && <span className="rounded-full text-sm font-bold tabular-nums absolute -left-[0.125rem] top-1/2 -translate-1/2 bg-white border-2 border-inherit p-1 cursor-help" title={`Selected ${heat.counts.CC} times`}>{heat.percent('CC')}</span>}
                    (<span className="playera">{parsedPayoffs.CC[0]}</span>, <span className="playerb">{parsedPayoffs.CC[1]}</span>)
                  </td>
                  <td
                    className="rounded-lg border scale-(--force-scale) hover:scale-100 transition-all cursor-pointer"
                    style={{ borderColor: `oklch(from var(--color-blue-700) l c h / ${heat.alpha('CD')})`, "--force-scale": `calc(0.5 + (${heat.alpha('CD')} / 2))` }}
                  >
                    {heat.counts.CD > 0 && <span className="rounded-full text-sm font-bold tabular-nums absolute -left-[0.125rem] top-1/2 -translate-1/2 bg-white border-2 border-inherit p-1 cursor-help" title={`Selected ${heat.counts.CD} times`}>{heat.percent('CD')}</span>}
                    (<span className="playera">{parsedPayoffs.CD[0]}</span>, <span className="playerb">{parsedPayoffs.CD[1]}</span>)
                  </td>
                </tr>
                <tr>
                  <td className="playera py-2 text-2xl leading-[1.25]">A: {settings.labels?.A?.[1]}</td>
                  <td
                    className="rounded-lg border scale-(--force-scale) hover:scale-100 transition-all cursor-pointer"
                    style={{ borderColor: `oklch(from var(--color-blue-700) l c h / ${heat.alpha('DC')})`, "--force-scale": `calc(0.5 + (${heat.alpha('DC')} / 2))` }}
                  >
                    { heat.counts.DC > 0 && <span className="rounded-full text-sm font-bold tabular-nums absolute -left-[0.125rem] top-1/2 -translate-1/2 bg-white border-2 border-inherit p-1 cursor-help" title={`Selected ${heat.counts.DC} times`}>{heat.percent('DC')}</span>}
                    (<span className="playera">{parsedPayoffs.DC[0]}</span>, <span className="playerb">{parsedPayoffs.DC[1]}</span>)
                  </td>
                  <td
                    className="rounded-lg border scale-(--force-scale) hover:scale-100 transition-all cursor-pointer"
                    style={{ borderColor: `oklch(from var(--color-blue-700) l c h / ${heat.alpha('DD')})`, "--force-scale": `calc(0.5 + (${heat.alpha('DD')} / 2))` }}
                  >
                    { heat.counts.DD > 0 && <span className="rounded-full text-sm font-bold tabular-nums absolute -left-[0.125rem] top-1/2 -translate-1/2 bg-white border-2 border-inherit p-1 cursor-help" title={`Selected ${heat.counts.DD} times`}>{heat.percent('DD')}</span>}
                    (<span className="playera">{parsedPayoffs.DD[0]}</span>, <span className="playerb">{parsedPayoffs.DD[1]}</span>)
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        <div className="h-full space-y-1 overflow-auto snap-y snap-proximity rounded">
          {summaryPairs.map(p => (
            <div key={p.index} className="flex bg-blue-100 even:bg-blue-200 p-4 snap-start overflow-auto rounded">
              <h4 title={`${p.aName} (A) vs ${p.bName} (B)`} className="font-semibold mb-4 tabular-nums w-[10rem]">
                Pair {p.index}
              </h4>
              <table className="w-full text-center table-p-1">
                <thead className="bg-white">
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
          {summaryPairs.length === 0 && <div className="text-center text-sm text-grey-500 animate-pulse">No complete pairs.</div>}
        </div>
      </div>
      <div className="md:w-xs bg-grey-400 text-blue-800 dark:bg-grey-700 dark:text-grey-200 flex md:flex-col gap-4 items-center justify-between rounded p-4">
          <code className="text-4xl m-1 md:mt-2 px-2 py-1">{currentGameCode}</code>
          <div className="flex flex-col md:w-full items-center text-center text-md leading-5 md:py-4 bg-grey-400 text-blue-800 dark:bg-grey-700 dark:text-grey-200 rounded">
            <span className="qrcode size-20 md:size-30 mb-2"></span>
            git.nickford.com/<span>teaching-games</span>
          </div>
      </div>
    </div>
  );
}
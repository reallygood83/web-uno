(() => {
  "use strict";

  const COLORS = ["red", "yellow", "green", "blue"];
  const COLOR_KO = { red: "빨강", yellow: "노랑", green: "초록", blue: "파랑", wild: "와일드" };
  const VALUE_KO = {
    skip: "스킵",
    reverse: "리버스",
    draw2: "+2",
    wild: "와일드",
    wild4: "+4",
  };

  const NAMES = ["나 (Moon)", "CPU 1", "CPU 2", "CPU 3"];
  const CPU_DELAY = 700;

  /** @typedef {{ id:string, color:string, value:string|number, kind:string }} Card */

  let state = null;
  let pendingWild = null; // { card, fromDrawn }
  let busy = false;
  let timers = [];

  const $ = (sel) => document.querySelector(sel);

  function uid() {
    return Math.random().toString(36).slice(2, 10);
  }

  function buildDeck() {
    /** @type {Card[]} */
    const deck = [];
    for (const color of COLORS) {
      deck.push({ id: uid(), color, value: 0, kind: "number" });
      for (let n = 1; n <= 9; n++) {
        deck.push({ id: uid(), color, value: n, kind: "number" });
        deck.push({ id: uid(), color, value: n, kind: "number" });
      }
      for (const v of ["skip", "reverse", "draw2"]) {
        deck.push({ id: uid(), color, value: v, kind: "action" });
        deck.push({ id: uid(), color, value: v, kind: "action" });
      }
    }
    for (let i = 0; i < 4; i++) {
      deck.push({ id: uid(), color: "wild", value: "wild", kind: "wild" });
      deck.push({ id: uid(), color: "wild", value: "wild4", kind: "wild" });
    }
    return shuffle(deck);
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function faceLabel(card) {
    if (typeof card.value === "number") return String(card.value);
    return VALUE_KO[card.value] || String(card.value);
  }

  function cornerLabel(card) {
    if (typeof card.value === "number") return String(card.value);
    if (card.value === "skip") return "⊘";
    if (card.value === "reverse") return "⇄";
    if (card.value === "draw2") return "+2";
    if (card.value === "wild") return "W";
    if (card.value === "wild4") return "+4";
    return "?";
  }

  function isWild(card) {
    return card.kind === "wild";
  }

  function topCard() {
    return state.discard[state.discard.length - 1];
  }

  function currentColor() {
    return state.currentColor;
  }

  function canPlay(card, hand) {
    if (!card) return false;
    const top = topCard();
    if (isWild(card)) {
      // Wild Draw 4: traditionally only if no other legal color match — keep simple: always allow
      if (card.value === "wild4" && hand) {
        const hasColorMatch = hand.some(
          (c) => !isWild(c) && (c.color === currentColor() || c.value === top.value)
        );
        // Soft rule: still allow +4 always for fun/playability
        void hasColorMatch;
      }
      return true;
    }
    return card.color === currentColor() || card.value === top.value;
  }

  function legalCards(hand) {
    return hand.filter((c) => canPlay(c, hand));
  }

  function drawFromDeck(n = 1) {
    const drawn = [];
    for (let i = 0; i < n; i++) {
      if (state.deck.length === 0) reshuffleFromDiscard();
      if (state.deck.length === 0) break;
      drawn.push(state.deck.pop());
    }
    return drawn;
  }

  function reshuffleFromDiscard() {
    if (state.discard.length <= 1) return;
    const top = state.discard.pop();
    const rest = shuffle(state.discard);
    state.discard = [top];
    state.deck = rest;
  }

  function nextIndex(from, steps = 1) {
    const dir = state.direction;
    let i = from;
    for (let s = 0; s < steps; s++) {
      i = (i + dir + 4) % 4;
    }
    return i;
  }

  function setMsg(text) {
    state.message = text;
    $("#msg").textContent = text;
  }

  function clearTimers() {
    timers.forEach(clearTimeout);
    timers = [];
  }

  function later(fn, ms) {
    const t = setTimeout(fn, ms);
    timers.push(t);
    return t;
  }

  function newGame() {
    clearTimers();
    busy = false;
    pendingWild = null;
    hideOverlays();

    const deck = buildDeck();
    const hands = [[], [], [], []];
    for (let r = 0; r < 7; r++) {
      for (let p = 0; p < 4; p++) hands[p].push(deck.pop());
    }

    // Flip until non-wild starter
    let starter = deck.pop();
    const buried = [];
    while (starter && isWild(starter)) {
      buried.push(starter);
      starter = deck.pop();
    }
    deck.push(...buried);
    if (!starter) {
      // Extremely unlikely
      starter = { id: uid(), color: "red", value: 0, kind: "number" };
    }

    state = {
      deck,
      discard: [starter],
      hands,
      current: 0,
      direction: 1, // 1 clockwise, -1 counter
      currentColor: starter.color,
      message: "당신 차례입니다. 맞는 카드를 내세요.",
      drawnThisTurn: null,
      mustDrawPenalty: 0,
      winner: null,
    };

    // Starter action effects (skip/reverse/draw2) — apply lightly
    if (starter.value === "reverse") {
      state.direction = -1;
      setMsg("시작 카드 리버스! 반시계로 진행.");
    } else if (starter.value === "skip") {
      state.current = 1;
      setMsg("시작 카드 스킵! CPU 1부터.");
    } else if (starter.value === "draw2") {
      state.hands[0].push(...drawFromDeck(2));
      state.current = 1;
      setMsg("시작 +2! 당신이 2장 받고 CPU 1 차례.");
    }

    render();
    if (state.current !== 0) scheduleCpu();
  }

  function hideOverlays() {
    $("#colorOverlay").classList.remove("show");
    $("#endOverlay").classList.remove("show");
  }

  function showColorPicker(card, fromDrawn) {
    pendingWild = { card, fromDrawn };
    $("#colorOverlay").classList.add("show");
  }

  function chooseColor(color) {
    if (!pendingWild) return;
    const { card, fromDrawn } = pendingWild;
    pendingWild = null;
    $("#colorOverlay").classList.remove("show");
    finishPlay(card, color, fromDrawn);
  }

  function tryPlayHuman(cardId) {
    if (busy || state.winner !== null || state.current !== 0) return;
    const hand = state.hands[0];
    const idx = hand.findIndex((c) => c.id === cardId);
    if (idx < 0) return;
    const card = hand[idx];

    // If already drew this turn, only that drawn card may be played
    if (state.drawnThisTurn && card.id !== state.drawnThisTurn.id) {
      setMsg("뽑은 카드만 낼 수 있어요. 아니면 턴을 넘기세요.");
      return;
    }

    if (!canPlay(card, hand)) {
      setMsg("이 카드는 낼 수 없어요.");
      return;
    }

    if (isWild(card)) {
      showColorPicker(card, !!state.drawnThisTurn);
      return;
    }

    finishPlay(card, card.color, !!state.drawnThisTurn);
  }

  function finishPlay(card, chosenColor, fromDrawn) {
    const p = state.current;
    const hand = state.hands[p];
    const idx = hand.findIndex((c) => c.id === card.id);
    if (idx < 0) return;
    hand.splice(idx, 1);
    state.discard.push(card);
    state.currentColor = chosenColor;
    state.drawnThisTurn = null;

    setMsg(`${NAMES[p]} → ${COLOR_KO[chosenColor]} ${faceLabel(card)}`);

    // Win check
    if (hand.length === 0) {
      state.winner = p;
      render();
      showEnd(p === 0);
      return;
    }

    // UNO call hint
    if (hand.length === 1) {
      setMsg(`${NAMES[p]} 우노! (카드 1장)`);
    }

    applyEffects(card, p);
    render();
    if (state.winner === null) {
      if (state.current === 0) {
        // human again (e.g. after reverse in 2p — we have 4)
        busy = false;
      } else {
        scheduleCpu();
      }
    }
  }

  function applyEffects(card, playedBy) {
    let skipNext = false;
    let extraDraw = 0;

    if (card.value === "reverse") {
      state.direction *= -1;
      // With 4 players reverse just flips direction
    } else if (card.value === "skip") {
      skipNext = true;
    } else if (card.value === "draw2") {
      extraDraw = 2;
      skipNext = true;
    } else if (card.value === "wild4") {
      extraDraw = 4;
      skipNext = true;
    }

    let next = nextIndex(playedBy, 1);
    if (extraDraw > 0) {
      state.hands[next].push(...drawFromDeck(extraDraw));
      setMsg(`${NAMES[next]}가 ${extraDraw}장 받습니다.`);
    }
    if (skipNext) {
      next = nextIndex(next, 1);
    }
    state.current = next;
  }

  function humanDraw() {
    if (busy || state.winner !== null || state.current !== 0) return;
    if (state.drawnThisTurn) {
      // Pass after draw
      setMsg("패스. 다음 차례로.");
      state.drawnThisTurn = null;
      state.current = nextIndex(0, 1);
      render();
      scheduleCpu();
      return;
    }

    // If has legal moves, still allow draw (house rule: optional)
    const drawn = drawFromDeck(1);
    if (!drawn.length) {
      setMsg("덱이 비었습니다.");
      return;
    }
    const card = drawn[0];
    state.hands[0].push(card);
    state.drawnThisTurn = card;

    if (canPlay(card, state.hands[0])) {
      setMsg(`뽑음: ${COLOR_KO[card.color] || ""} ${faceLabel(card)} — 내거나 덱을 다시 눌러 패스`);
    } else {
      setMsg(`뽑음: ${COLOR_KO[card.color] || ""} ${faceLabel(card)} — 낼 수 없어 패스하려면 덱을 다시 누르세요`);
    }
    render();
  }

  function scheduleCpu() {
    busy = true;
    later(() => cpuTurn(), CPU_DELAY);
  }

  function cpuTurn() {
    if (!state || state.winner !== null) return;
    const p = state.current;
    if (p === 0) {
      busy = false;
      render();
      return;
    }

    const hand = state.hands[p];
    const legal = legalCards(hand);

    // Prefer non-wild, then action, then wild, avoid wild4 if other options
    let choice = null;
    if (legal.length) {
      const nonWild = legal.filter((c) => !isWild(c));
      const pool = nonWild.length ? nonWild : legal.filter((c) => c.value !== "wild4");
      const finalPool = pool.length ? pool : legal;
      // Prefer matching color over value, prefer higher numbers / actions
      finalPool.sort((a, b) => scoreCpuCard(b) - scoreCpuCard(a));
      choice = finalPool[0];
    }

    if (!choice) {
      const drawn = drawFromDeck(1);
      if (drawn.length) {
        hand.push(drawn[0]);
        if (canPlay(drawn[0], hand)) {
          choice = drawn[0];
          setMsg(`${NAMES[p]} 뽑고 바로 냄`);
        } else {
          setMsg(`${NAMES[p]} 뽑고 패스`);
          state.current = nextIndex(p, 1);
          render();
          if (state.current === 0) {
            busy = false;
            setMsg("당신 차례입니다.");
          } else {
            scheduleCpu();
          }
          return;
        }
      } else {
        state.current = nextIndex(p, 1);
        render();
        if (state.current === 0) busy = false;
        else scheduleCpu();
        return;
      }
    }

    let color = choice.color;
    if (isWild(choice)) {
      color = pickCpuColor(hand);
    }
    finishPlay(choice, color, false);
  }

  function scoreCpuCard(c) {
    let s = 0;
    if (c.color === currentColor()) s += 5;
    if (c.value === "draw2" || c.value === "skip") s += 3;
    if (c.value === "reverse") s += 2;
    if (typeof c.value === "number") s += c.value * 0.1;
    if (c.value === "wild") s -= 1;
    if (c.value === "wild4") s -= 2;
    return s;
  }

  function pickCpuColor(hand) {
    const counts = { red: 0, yellow: 0, green: 0, blue: 0 };
    for (const c of hand) {
      if (COLORS.includes(c.color)) counts[c.color]++;
    }
    let best = "red";
    let max = -1;
    for (const col of COLORS) {
      if (counts[col] > max) {
        max = counts[col];
        best = col;
      }
    }
    return best;
  }

  function showEnd(won) {
    busy = true;
    clearTimers();
    const el = $("#endOverlay");
    $("#endTitle").textContent = won ? "🎉 승리!" : "패배…";
    $("#endText").textContent = won
      ? "손을 비웠습니다. 우노 챔피언!"
      : `${NAMES[state.winner]}이(가) 이겼습니다. 다시 도전해 보세요.`;
    el.classList.add("show");
  }

  // ——— Render ———

  function cardEl(card, opts = {}) {
    const div = document.createElement("div");
    const colorClass = isWild(card) ? "wild" : card.color;
    div.className = `card ${colorClass}` + (opts.extraClass ? ` ${opts.extraClass}` : "");
    div.dataset.id = card.id;

    const oval = document.createElement("div");
    oval.className = "oval";
    const face = document.createElement("div");
    face.className = "face";
    face.textContent = faceLabel(card);
    oval.appendChild(face);

    const tl = document.createElement("div");
    tl.className = "corner tl";
    tl.textContent = cornerLabel(card);
    const br = document.createElement("div");
    br.className = "corner br";
    br.textContent = cornerLabel(card);

    div.appendChild(oval);
    div.appendChild(tl);
    div.appendChild(br);

    if (opts.onClick) {
      div.addEventListener("click", opts.onClick);
    }
    return div;
  }

  function renderCpuHand(el, count) {
    el.innerHTML = "";
    const show = Math.min(count, 12);
    for (let i = 0; i < show; i++) {
      const b = document.createElement("div");
      b.className = "card-back";
      el.appendChild(b);
    }
  }

  function render() {
    if (!state) return;

    // Seats / turn
    for (let p = 0; p < 4; p++) {
      const seat = $(`#seat${p}`);
      seat.classList.toggle("turn", state.current === p && state.winner === null);
      $(`#count${p}`).textContent = String(state.hands[p].length);
    }

    $("#turnName").textContent = NAMES[state.current];
    $("#turnPill").classList.toggle("active-turn", state.current === 0);

    const clockwise = state.direction === 1;
    $("#dirLabel").textContent = clockwise ? "시계 →" : "반시계 ←";
    $("#dirArrow").textContent = clockwise ? "↻" : "↺";

    const cc = state.currentColor;
    $("#colorLabel").innerHTML = `<span class="color-dot ${cc}"></span>${COLOR_KO[cc] || cc}`;
    $("#deckCount").textContent = String(state.deck.length);

    // Discard
    const discard = $("#discard");
    discard.innerHTML = "";
    const top = topCard();
    if (top) {
      // Show chosen color tint for wilds via border trick: clone with color class override
      const shown = { ...top };
      if (isWild(top)) {
        // Keep wild look but we already show current color in pill
      }
      discard.appendChild(cardEl(shown));
    }

    // Deck draw affordance
    const deckEl = $("#deck");
    const humanTurn = state.current === 0 && state.winner === null && !busy && !pendingWild;
    const canDrawOrPass = humanTurn;
    deckEl.classList.toggle("can-draw", canDrawOrPass);

    // CPU hands
    for (let p = 1; p <= 3; p++) {
      renderCpuHand($(`#hand${p}`), state.hands[p].length);
    }

    // Human hand
    const handEl = $("#hand0");
    handEl.innerHTML = "";
    const hand = state.hands[0];
    const legal = humanTurn ? new Set(legalCards(hand).map((c) => c.id)) : new Set();
    // Sort: legal first, then by color
    const sorted = hand.slice().sort((a, b) => {
      const la = legal.has(a.id) ? 0 : 1;
      const lb = legal.has(b.id) ? 0 : 1;
      if (la !== lb) return la - lb;
      return String(a.color).localeCompare(String(b.color)) || String(a.value).localeCompare(String(b.value));
    });

    for (const card of sorted) {
      let extra = "";
      if (humanTurn) {
        if (state.drawnThisTurn) {
          extra = card.id === state.drawnThisTurn.id && canPlay(card, hand) ? "legal" : "illegal";
        } else {
          extra = legal.has(card.id) ? "legal" : "illegal";
        }
      }
      const el = cardEl(card, {
        extraClass: extra,
        onClick: () => tryPlayHuman(card.id),
      });
      handEl.appendChild(el);
    }

    if (state.message) $("#msg").textContent = state.message;
  }

  // Events
  $("#btnNew").addEventListener("click", () => newGame());
  $("#btnPlayAgain").addEventListener("click", () => newGame());
  $("#deck").addEventListener("click", () => humanDraw());

  document.querySelectorAll(".color-btn").forEach((btn) => {
    btn.addEventListener("click", () => chooseColor(btn.dataset.color));
  });

  // Boot
  newGame();
})();

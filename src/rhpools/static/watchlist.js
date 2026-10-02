(() => {
  "use strict";

  const API_ROOT = "/api/lp";
  const ROBINSCAN = "https://robinscan.io";
  const REQUEST_TIMEOUT_MS = 15_000;
  const ADDRESS_RE = /^0x[0-9a-f]{40}$/;
  const ACTIVITY_LIMIT = 50;
  const REFRESH_INTERVAL_MS = 15_000;

  const byId = (id) => document.getElementById(id);
  const elements = {
    addForm: byId("wl-add-form"),
    addInput: byId("wl-add-input"),
    addLabelInput: byId("wl-add-label-input"),
    addStatus: byId("wl-add-status"),
    cards: byId("wl-cards"),
    empty: byId("wl-empty"),
    copyStatus: byId("wl-copy-status"),
    liveStatus: byId("wl-live-status"),
    liveText: byId("wl-live-text"),
  };

  const cardState = new Map(); // address -> { loading, error, activity, summary, expanded }

  function el(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value != null) node.textContent = String(value);
    return node;
  }

  function finite(value) {
    if (value == null || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function shortIdentifier(value, head = 7, tail = 5) {
    if (!value) return "—";
    const text = String(value);
    return text.length > head + tail + 1 ? `${text.slice(0, head)}…${text.slice(-tail)}` : text;
  }

  function formatUsd(value) {
    const n = finite(value);
    if (n == null) return "—";
    const abs = Math.abs(n);
    const sign = n < 0 ? "-" : "";
    if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
    if (abs >= 1e4) return `${sign}$${Math.round(abs)}`;
    return `${sign}$${abs.toFixed(2)}`;
  }

  function formatSignedUsd(value) {
    const n = finite(value);
    if (n == null) return "—";
    if (n > 0) return `+${formatUsd(n)}`;
    return formatUsd(n);
  }

  function formatCount(value) {
    const n = finite(value);
    if (n == null) return "—";
    const abs = Math.abs(n);
    if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
    if (abs >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
    return Number.isInteger(n) ? String(n) : n.toFixed(2);
  }

  function valueClass(value) {
    const n = finite(value);
    if (n == null || Math.abs(n) < 0.0000001) return "dim";
    return n > 0 ? "positive" : "negative";
  }

  function toDate(value) {
    if (value == null || value === "") return null;
    const text = String(value).trim();
    if (/^[+-]?\d+(?:\.\d+)?$/.test(text)) {
      const n = Number(text);
      if (!Number.isFinite(n)) return null;
      const d = new Date(Math.abs(n) < 1e11 ? n * 1000 : n);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(text);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function formatAge(seconds) {
    const n = finite(seconds);
    if (n == null) return "—";
    if (n < 60) return `${Math.round(n)}s`;
    if (n < 3600) return `${Math.round(n / 60)}m`;
    if (n < 86400) return `${(n / 3600).toFixed(1)}h`;
    return `${(n / 86400).toFixed(1)}d`;
  }

  function formatStamp(value) {
    const d = toDate(value);
    if (!d) return "—";
    return d.toISOString().slice(0, 19).replace("T", " ") + " UTC";
  }

  function copyText(text) {
    if (!text) return;
    try {
      navigator.clipboard.writeText(text).then(
        () => { elements.copyStatus.textContent = `Copied ${shortIdentifier(text)}`; },
        () => { elements.copyStatus.textContent = "Copy failed"; },
      );
    } catch (_) { /* clipboard may be unavailable */ }
  }

  function rowKey(row) {
    return `${row.tx_hash || ""}:${row.block_number || ""}:${row.log_index || ""}:${row.kind || ""}`;
  }

  async function api(path, params, signal) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params || {})) {
      if (value != null && value !== "") query.set(key, String(value));
    }
    const deadline = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const response = await fetch(`${API_ROOT}${path}${query.size ? `?${query.toString()}` : ""}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
    });
    if (!response.ok) {
      let detail = "";
      try { const body = await response.json(); detail = body.error || ""; } catch (_) {}
      throw new Error(detail || `HTTP ${response.status}`);
    }
    return response.json();
  }

  function tokenLabel(row, side) {
    const symbol = row && row[`symbol${side}`];
    if (symbol) return symbol;
    const nested = row && row[`token${side}`];
    if (nested && typeof nested === "object" && nested.symbol) return nested.symbol;
    const addr = nested && typeof nested === "string" ? nested : nested && nested.address;
    return addr ? shortIdentifier(addr) : "—";
  }

  function pairFor(row) {
    const t0 = tokenLabel(row, 0);
    const t1 = tokenLabel(row, 1);
    if (t0 !== "—" || t1 !== "—") return `${t0} / ${t1}`;
    return row && (row.pair || shortIdentifier(row.pool_id || row.id)) || "—";
  }

  function flowFor(row, side) {
    const nested = row && row[`token${side}`];
    const decimals = nested && typeof nested === "object" ? nested.decimals : row && row[`decimals${side}`];
    const raw = row && (row[`cashflow${side}`] != null ? row[`cashflow${side}`] : row[`amount${side}`]);
    if (raw == null || raw === "" || decimals == null) return null;
    const text = String(raw).trim();
    if (!/^[+-]?\d+$/.test(text)) return null;
    const sign = text.startsWith("-") ? "-" : "+";
    const digits = text.replace(/^[+-]/, "").padStart(Number(decimals) + 1, "0");
    const split = digits.length - Number(decimals);
    const display = `${sign}${digits.slice(0, split)}.${digits.slice(split)}`.replace(/\.?0+$/, "");
    return `${display} ${tokenLabel(row, side)}`;
  }

  function eventUsd(row) {
    if (row.cashflow_usd != null) return finite(row.cashflow_usd);
    if (row.usdg_flow_usd != null) return finite(row.usdg_flow_usd);
    const kind = String(row.kind || "").toLowerCase();
    if (kind === "add" || kind === "donate") {
      const d = finite(row.deposit_usd);
      return d == null ? null : -Math.abs(d);
    }
    if (kind === "remove") {
      const w = finite(row.withdrawal_usd);
      return w == null ? null : Math.abs(w);
    }
    if (kind === "collect" || kind === "fee") {
      const f = finite(row.fees_usd);
      if (f != null) return Math.abs(f);
      const w = finite(row.withdrawal_usd);
      return w == null ? null : Math.abs(w);
    }
    return finite(row.size_usd != null ? row.size_usd : row.volume_usd);
  }

  function buildCard(entry) {
    const address = entry.address;
    const card = el("div", "wl-card");
    card.dataset.address = address;

    const head = el("div", "wl-card-head");
    head.dataset.toggle = address;

    const toggle = el("span", "wl-card-toggle", "▸");

    const addrLink = el("span", "wl-card-address", shortIdentifier(address));
    addrLink.dataset.copy = address;
    addrLink.title = `${address}\nClick to copy`;
    addrLink.setAttribute("role", "button");
    addrLink.setAttribute("tabindex", "0");

    const label = el("span", "wl-card-label", entry.label || "");

    const stats = el("div", "wl-card-stats");
    stats.append(
      statNode("positions", "—", "dim"),
      statNode("fees", "—", "dim"),
      statNode("net P/L", "—", "dim"),
      statNode("latest", "—", "dim"),
    );

    const actions = el("div", "wl-card-actions");
    const terminalLink = el("a", "wl-card-link", "OPEN");
    terminalLink.href = `/?owner=${address}&window=all`;
    terminalLink.title = `Open ${address} in the terminal`;

    const unwatchBtn = el("button", "wl-unwatch", "UNWATCH");
    unwatchBtn.type = "button";
    unwatchBtn.dataset.unwatch = address;
    unwatchBtn.title = `Remove ${address} from watchlist`;

    actions.append(terminalLink, unwatchBtn);
    head.append(toggle, addrLink, label, stats, actions);
    card.append(head);

    const body = el("div", "wl-card-body");
    body.hidden = true;
    body.append(el("div", "wl-card-loading", "Loading activity…"));
    card.append(body);

    return card;
  }

  function statNode(label, value, className) {
    const stat = el("div", "wl-card-stat");
    stat.append(el("span", "wl-card-stat-label", label), el("span", `wl-card-stat-value ${className || ""}`, value));
    return stat;
  }

  function updateCardStats(card, summary, activity) {
    const stats = card.querySelector(".wl-card-stats");
    if (!stats) return;
    const children = stats.children;
    // positions
    setText(children[0].lastElementChild, formatCount(summary && summary.positions), valueClass(summary && summary.open_positions));
    // fees
    const fees = finite(summary && summary.fees_usd);
    setText(children[1].lastElementChild, fees != null ? formatUsd(fees) : "—", fees != null ? "positive" : "dim");
    // net P/L
    const pnl = finite(summary && summary.net_pnl_usd);
    setText(children[2].lastElementChild, formatSignedUsd(pnl), valueClass(pnl));
    // latest activity
    if (activity) {
      const d = toDate(activity.timestamp || activity.block_number);
      const age = d ? formatAge(Math.max(0, (Date.now() - d.getTime()) / 1000)) : "—";
      setText(children[3].lastElementChild, age, "dim");
    }
  }

  function setText(node, text, className) {
    if (node.textContent !== String(text)) node.textContent = String(text);
    if (className && node.className !== `wl-card-stat-value ${className}`) {
      node.className = `wl-card-stat-value ${className}`;
    }
  }

  function renderActivityTable(body, rows, newKeys) {
    body.replaceChildren();
    if (!rows || !rows.length) {
      body.append(el("div", "wl-card-loading", "No indexed activity for this wallet."));
      return;
    }
    const newSet = newKeys instanceof Set ? newKeys : null;
    const wrap = el("div", "wl-activity-table-wrap");
    const table = el("table", "wl-activity-table");
    const thead = el("thead");
    thead.append(
      (() => { const tr = el("tr"); tr.append(
        el("th", null, "age"), el("th", null, "action"), el("th", null, "pair"),
        el("th", "numeric", "flow"), el("th", "numeric", "USD"), el("th", "numeric", "fees"),
        el("th", null, "tx"), el("th", null, "block"),
      ); return tr; })(),
    );
    const tbody = el("tbody");
    for (const row of rows) {
      const kind = String(row.kind || "unknown").toLowerCase();
      const isNew = newSet && newSet.has(rowKey(row));
      const tr = el("tr", `event-${kind}${isNew ? " wl-new-row" : ""}`);
      const d = toDate(row.timestamp);
      const age = d ? formatAge(Math.max(0, (Date.now() - d.getTime()) / 1000)) : "—";
      tr.append(
        el("td", "dim", age),
        el("td", "col-action", kind),
        el("td", null, pairFor(row)),
      );
      // flow
      const flows = [flowFor(row, 0), flowFor(row, 1)].filter(Boolean);
      tr.append(el("td", "numeric", flows.length ? flows.join(" · ") : "—"));
      // usd
      const usd = eventUsd(row);
      const usdClass = kind === "swap" ? "dim" : valueClass(usd);
      tr.append(el("td", `numeric ${usdClass}`, usd != null ? (kind === "swap" ? formatUsd(usd) : formatSignedUsd(usd)) : "—"));
      // fees
      const fees = finite(row.fees_usd);
      tr.append(el("td", `numeric ${fees != null ? "positive" : "dim"}`, fees != null ? formatUsd(fees) : "—"));
      // tx
      const tx = row.tx_hash || "";
      const txCell = el("td", null);
      if (tx) {
        const link = el("a", null, shortIdentifier(tx));
        link.href = `${ROBINSCAN}/tx/${encodeURIComponent(tx)}`;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.title = tx;
        txCell.append(link);
      } else {
        txCell.append(el("span", "dim", "—"));
      }
      tr.append(txCell);
      // block
      tr.append(el("td", "dim", row.block_number != null ? `#${row.block_number}` : "—"));
      tbody.append(tr);
    }
    table.append(thead, tbody);
    wrap.append(table);
    body.append(wrap);
    body.append(el("div", "wl-activity-footer", `${rows.length} events shown · window: all history`));
  }

  async function loadCardData(address, card, body, { silent = false } = {}) {
    const state = cardState.get(address);
    if (state && state.loading) return;
    const prevRows = (state && state.activityRows) || [];
    const entry = { loading: true, error: null, activity: state && state.activity || null, summary: state && state.summary || null, expanded: true, activityRows: prevRows };
    cardState.set(address, entry);

    if (!silent) {
      body.replaceChildren(el("div", "wl-card-loading", "Loading activity…"));
    }

    try {
      const [ownerData, tapeData] = await Promise.all([
        api("/owner", { owner: address, window: "all" }).catch((e) => { console.warn("owner fetch failed", e); return null; }),
        api("/tape", { owner: address, kind: "all", limit: ACTIVITY_LIMIT }),
      ]);

      const summary = ownerData && ownerData.summary || null;
      const activity = ownerData && ownerData.activity || (tapeData && tapeData.rows && tapeData.rows[0]) || null;
      const rows = (tapeData && tapeData.rows) || [];

      entry.loading = false;
      entry.summary = summary;
      entry.activity = activity;
      entry.activityRows = rows;

      updateCardStats(card, summary, activity);

      if (silent) {
        const prevKeys = new Set(prevRows.map(rowKey));
        const newKeys = new Set(rows.map(rowKey).filter((k) => !prevKeys.has(k)));
        if (newKeys.size > 0 || rows.length !== prevRows.length) {
          renderActivityTable(body, rows, newKeys);
        }
      } else {
        renderActivityTable(body, rows);
      }
    } catch (error) {
      entry.loading = false;
      entry.error = error.message || "Failed to load";
      if (!silent) {
        body.replaceChildren(el("div", "wl-card-error", `ERROR · ${entry.error}`));
      }
    }
  }

  function toggleCard(address, card) {
    const body = card.querySelector(".wl-card-body");
    const expanded = !body.hidden;
    body.hidden = expanded;
    card.classList.toggle("is-expanded", !expanded);
    card.querySelector(".wl-card-toggle").textContent = expanded ? "▸" : "▾";

    if (!expanded) {
      const state = cardState.get(address);
      if (!state || (!state.loading && !state.activityRows && !state.error)) {
        loadCardData(address, card, body);
      }
    }
  }

  function renderList() {
    const entries = window.__watchlist.list();
    elements.empty.hidden = entries.length > 0;

    // Remove cards for unwatched wallets
    for (const child of Array.from(elements.cards.children)) {
      if (!entries.some((e) => e.address === child.dataset.address)) {
        cardState.delete(child.dataset.address);
        child.remove();
      }
    }

    // Add/update cards
    for (const entry of entries) {
      let card = elements.cards.querySelector(`[data-address="${entry.address}"]`);
      if (!card) {
        card = buildCard(entry);
        elements.cards.append(card);
      } else {
        // Update label
        const labelEl = card.querySelector(".wl-card-label");
        if (labelEl && labelEl.textContent !== (entry.label || "")) {
          labelEl.textContent = entry.label || "";
        }
      }
    }
  }

  function handleAdd(event) {
    event.preventDefault();
    const address = elements.addInput.value.trim().toLowerCase();
    const label = elements.addLabelInput.value.trim();
    if (!ADDRESS_RE.test(address)) {
      elements.addStatus.className = "wl-add-status is-error";
      elements.addStatus.textContent = "Invalid address — must be a 0x... 20-byte hex address";
      return;
    }
    if (window.__watchlist.has(address)) {
      elements.addStatus.className = "wl-add-status is-error";
      elements.addStatus.textContent = "Already on watchlist";
      return;
    }
    window.__watchlist.add(address, label);
    elements.addStatus.className = "wl-add-status is-success";
    elements.addStatus.textContent = `Watching ${shortIdentifier(address)}`;
    elements.addInput.value = "";
    elements.addLabelInput.value = "";
    setTimeout(() => { elements.addStatus.textContent = ""; elements.addStatus.className = "wl-add-status"; }, 3000);
  }

  function handleClick(event) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const copy = event.target.closest && event.target.closest("[data-copy]");
    if (copy) {
      event.preventDefault();
      copyText(copy.dataset.copy);
      return;
    }

    const unwatch = event.target.closest && event.target.closest("[data-unwatch]");
    if (unwatch) {
      event.preventDefault();
      event.stopPropagation();
      window.__watchlist.remove(unwatch.dataset.unwatch);
      return;
    }

    const toggle = event.target.closest && event.target.closest("[data-toggle]");
    if (toggle) {
      event.preventDefault();
      const card = toggle.closest(".wl-card");
      if (card) toggleCard(toggle.dataset.toggle, card);
      return;
    }
  }

  function handleKeydown(event) {
    const copy = event.target.closest && event.target.closest("[data-copy]");
    if (copy && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      copyText(copy.dataset.copy);
    }
  }

  // Auto-expand newly added cards
  let prevAddresses = new Set();
  function onWatchlistChange() {
    const current = new Set(window.__watchlist.list().map((e) => e.address));
    renderList();
    // Auto-expand newly added cards
    for (const addr of current) {
      if (!prevAddresses.has(addr)) {
        const card = elements.cards.querySelector(`[data-address="${addr}"]`);
        if (card) {
          const body = card.querySelector(".wl-card-body");
          body.hidden = false;
          card.classList.add("is-expanded");
          card.querySelector(".wl-card-toggle").textContent = "▾";
          loadCardData(addr, card, body);
        }
      }
    }
    prevAddresses = current;
  }

  // Live polling — continuously pull on-chain data for watched wallets
  let lastRefreshAt = 0;
  function updateLiveStatus() {
    const count = window.__watchlist.list().length;
    if (count === 0) {
      elements.liveStatus.classList.remove("is-live");
      elements.liveText.textContent = "Add a wallet to start live tracking";
      return;
    }
    if (!lastRefreshAt) {
      elements.liveStatus.classList.add("is-live");
      elements.liveText.textContent = `LIVE · ${count} wallet${count > 1 ? "s" : ""} · connecting…`;
      return;
    }
    const age = Math.round((Date.now() - lastRefreshAt) / 1000);
    elements.liveStatus.classList.add("is-live");
    elements.liveText.textContent = `LIVE · ${count} wallet${count > 1 ? "s" : ""} · updated ${age}s ago`;
  }

  function refreshAllExpanded() {
    const cards = document.querySelectorAll(".wl-card.is-expanded");
    let refreshed = 0;
    for (const card of cards) {
      const addr = card.dataset.address;
      const body = card.querySelector(".wl-card-body");
      if (body && !body.hidden) {
        loadCardData(addr, card, body, { silent: true });
        refreshed++;
      }
    }
    if (refreshed > 0) lastRefreshAt = Date.now();
    updateLiveStatus();
  }

  function startLivePolling() {
    lastRefreshAt = Date.now();
    updateLiveStatus();
    setInterval(refreshAllExpanded, REFRESH_INTERVAL_MS);
    setInterval(updateLiveStatus, 1000);
  }

  // Init
  elements.addForm.addEventListener("submit", handleAdd);
  document.addEventListener("click", handleClick);
  document.addEventListener("keydown", handleKeydown);
  window.__watchlist.onChange(onWatchlistChange);
  prevAddresses = new Set(window.__watchlist.list().map((e) => e.address));
  renderList();
  // Auto-expand all existing cards on load
  for (const entry of window.__watchlist.list()) {
    const card = elements.cards.querySelector(`[data-address="${entry.address}"]`);
    if (card) {
      const body = card.querySelector(".wl-card-body");
      body.hidden = false;
      card.classList.add("is-expanded");
      card.querySelector(".wl-card-toggle").textContent = "▾";
      loadCardData(entry.address, card, body);
    }
  }
  // Start continuous live polling
  startLivePolling();
})();

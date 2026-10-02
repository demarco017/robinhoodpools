(() => {
  "use strict";
  const STORAGE_KEY = "rhp-watchlist";
  const ADDRESS_RE = /^0x[0-9a-f]{40}$/;

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((e) => e && ADDRESS_RE.test(e.address))
        .map((e) => ({
          address: e.address.toLowerCase(),
          label: typeof e.label === "string" ? e.label : "",
          addedAt: Number(e.addedAt) || 0,
        }));
    } catch (_) {
      return [];
    }
  }

  function save(entries) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch (_) {
      // storage may be unavailable in private mode
    }
  }

  let entries = load();
  const listeners = new Set();

  function notify() {
    for (const cb of listeners) {
      try { cb(entries); } catch (_) { /* listener errors are non-fatal */ }
    }
    window.dispatchEvent(new CustomEvent("watchlist:change", { detail: entries }));
  }

  window.__watchlist = {
    list() { return entries.slice(); },
    has(address) {
      const norm = String(address || "").toLowerCase();
      return ADDRESS_RE.test(norm) && entries.some((e) => e.address === norm);
    },
    add(address, label = "") {
      const norm = String(address || "").toLowerCase();
      if (!ADDRESS_RE.test(norm)) return false;
      if (entries.some((e) => e.address === norm)) return false;
      entries.push({ address: norm, label: String(label || ""), addedAt: Date.now() });
      save(entries);
      notify();
      return true;
    },
    remove(address) {
      const norm = String(address || "").toLowerCase();
      const before = entries.length;
      entries = entries.filter((e) => e.address !== norm);
      if (entries.length !== before) {
        save(entries);
        notify();
        return true;
      }
      return false;
    },
    toggle(address, label = "") {
      const norm = String(address || "").toLowerCase();
      if (this.has(norm)) {
        this.remove(norm);
        return false;
      }
      this.add(norm, label);
      return true;
    },
    setLabel(address, label) {
      const norm = String(address || "").toLowerCase();
      const entry = entries.find((e) => e.address === norm);
      if (!entry) return false;
      entry.label = String(label || "");
      save(entries);
      notify();
      return true;
    },
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };

  // Sync across tabs / windows
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY) {
      entries = load();
      notify();
    }
  });
})();

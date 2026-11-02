/* Local history transport only. Records never grant source or provider authority. */
(function (scope) {
  'use strict';
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const integer = value => Number.isSafeInteger(value) && value > 0;
  const freeze = value => {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      for (const child of Object.values(value)) freeze(child);
      Object.freeze(value);
    }
    return value;
  };
  function createReceiver() {
    let channels = new Map(), waiting = false;
    function receive(history) {
      const fail = () => { const requestResync = !waiting; waiting = true; return { ok: false, requestResync }; };
      if (!object(history) || history.version !== 1) return fail();
      if (waiting && !(history.conversations?.base === null && history.runtimeWorkspace?.base === null)) return fail();
      const next = new Map(channels), values = {};
      try {
        for (const key of ['conversations', 'runtimeWorkspace']) {
          if (!Object.hasOwn(history, key)) continue;
          const packet = history[key], prior = channels.get(key);
          if (!object(packet) || !integer(packet.generation) || !integer(packet.sequence)) return fail();
          if (prior && (packet.generation < prior.generation || packet.generation === prior.generation && packet.sequence <= prior.sequence))
            return { ok: false, ignored: true };
          const full = packet.base === null;
          if (!full && (waiting || !prior || packet.generation !== prior.generation || packet.base !== prior.sequence)) return fail();
          if (Object.hasOwn(packet, 'value')) {
            if (!full || packet.value !== null) return fail();
            next.set(key, { generation: packet.generation, sequence: packet.sequence, records: new Map(), value: null }); values[key] = null; continue;
          }
          const header = packet.header;
          if (!object(header) || typeof header.projectId !== 'string' || !Number.isSafeInteger(header.revision) || header.revision < 0 ||
            !Array.isArray(packet.records) || !Array.isArray(packet.removed) || !full && prior.value?.projectId !== header.projectId) return fail();
          const records = full ? new Map() : new Map(prior.records);
          for (const id of packet.removed) { if (typeof id !== 'string') return fail(); records.delete(id); }
          for (const record of packet.records) {
            const id = key === 'conversations' ? record?.requestId : record?.id;
            if (!object(record) || typeof id !== 'string' || !id) return fail();
            records.set(id, freeze(record));
          }
          let value;
          const used = new Set();
          const recordFor = id => { if (typeof id !== 'string' || used.has(id) || !records.has(id)) throw Error('Missing or duplicate history record'); used.add(id); return records.get(id); };
          if (key === 'conversations') {
            if (!Array.isArray(header.conversations) || header.conversations.length > 20 || records.size > 800) return fail();
            value = { ...header, conversations: header.conversations.map(chat => {
              if (!object(chat) || !Array.isArray(chat.turnIds) || chat.turnIds.length > 40) throw Error('Invalid history order');
              const { turnIds, ...metadata } = chat; return { ...metadata, turns: turnIds.map(recordFor) };
            }) };
          } else {
            if (!Array.isArray(header.runIds) || header.runIds.length > 40 || records.size > 40) return fail();
            const { runIds, ...metadata } = header; value = { ...metadata, runs: runIds.map(recordFor) };
          }
          if (used.size !== records.size) return fail();
          next.set(key, { generation: packet.generation, sequence: packet.sequence, records, value }); values[key] = value;
        }
        channels = next; waiting = false; return { ok: true, values };
      } catch { return fail(); }
    }
    return { receive };
  }
  const api = { createReceiver };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else scope.FoundationHistory = api;
})(typeof window !== 'undefined' ? window : globalThis);

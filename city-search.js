'use strict';

// Dùng được cả trên trình duyệt và trong bộ kiểm tra Node, không cần thư viện ngoài.
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OrbitGeocoding = api;
})(globalThis, function() {
  function parseLocations(data) {
    if (!data || typeof data !== 'object' || data.error ||
      (data.results !== undefined && !Array.isArray(data.results))) {
      throw new Error('Invalid geocoding response');
    }
    return (data.results || []).filter(place =>
      place && typeof place.name === 'string' && place.name.trim() &&
      Number.isFinite(place.latitude) && Math.abs(place.latitude) <= 90 &&
      Number.isFinite(place.longitude) && Math.abs(place.longitude) <= 180
    ).slice(0, 8).map(place => {
      const name = place.name.trim().slice(0, 120);
      const region = typeof place.admin1 === 'string' ? place.admin1.trim().slice(0, 120) : '';
      const country = typeof place.country === 'string' ? place.country.trim().slice(0, 120) : '';
      const details = [...new Set([region, country].filter(part => part && part !== name))];
      return {
        name, description: details.join(' · ') || 'Chưa có thông tin khu vực',
        label: [name, ...details].join(', ').slice(0, 120),
        lat: place.latitude, lng: place.longitude,
        symbol: typeof place.country_code === 'string' ? place.country_code.slice(0, 2).toUpperCase() : '◎'
      };
    });
  }

  function createSearch({ onState, fetchImpl = (...args) => fetch(...args), delay = 400, timeout = 8000, timers = globalThis }) {
    let generation = 0;
    let debounceTimer = null;
    let active = null;
    const cache = new Map();

    function cancel() {
      generation++;
      timers.clearTimeout(debounceTimer);
      debounceTimer = null;
      if (active) {
        timers.clearTimeout(active.timeoutId);
        active.controller.abort();
        active = null;
      }
    }

    async function request(query, key, id) {
      debounceTimer = null;
      const controller = new AbortController();
      const operation = { controller, timeoutId: null };
      active = operation;
      onState({ status: 'loading', query, results: [] });
      operation.timeoutId = timers.setTimeout(() => {
        if (id !== generation) return;
        // Vô hiệu hóa cả phản hồi đến muộn, ngay cả khi trình duyệt không hủy được request.
        generation++;
        active = null;
        controller.abort();
        onState({ status: 'error', query, results: [], reason: 'timeout' });
      }, timeout);
      try {
        const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
        url.search = new URLSearchParams({ name: query, count: '8', language: 'vi', format: 'json' }).toString();
        const response = await fetchImpl(url.toString(), { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const results = parseLocations(await response.json());
        if (id !== generation) return;
        if (cache.size >= 40) cache.delete(cache.keys().next().value);
        cache.set(key, results);
        onState({ status: 'results', query, results });
      } catch {
        if (id === generation) onState({ status: 'error', query, results: [], reason: 'network' });
      } finally {
        timers.clearTimeout(operation.timeoutId);
        if (active === operation) active = null;
      }
    }

    function search(value) {
      cancel();
      const query = value.trim().replace(/\s+/g, ' ');
      if (!query) { onState({ status: 'idle', query, results: [] }); return; }
      if (query.length < 2) { onState({ status: 'short', query, results: [] }); return; }
      const key = query.toLowerCase();
      if (cache.has(key)) { onState({ status: 'results', query, results: cache.get(key) }); return; }
      const id = generation;
      onState({ status: 'waiting', query, results: [] });
      debounceTimer = timers.setTimeout(() => request(query, key, id), delay);
    }
    return { search, cancel };
  }
  return { createSearch, parseLocations };
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSearch, parseLocations } = require('../city-search.js');

const place = (name, extra = {}) => ({ name, latitude: 11.9404, longitude: 108.4583, admin1: 'Lâm Đồng', country: 'Việt Nam', country_code: 'VN', ...extra });
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

function setup() {
  let now = 0, nextId = 0;
  const tasks = new Map(), requests = [], states = [];
  const timers = {
    setTimeout(callback, delay) { const id = ++nextId; tasks.set(id, { callback, at: now + delay }); return id; },
    clearTimeout(id) { tasks.delete(id); }
  };
  const search = createSearch({
    timers, onState: state => states.push(state),
    fetchImpl(url, options) {
      return new Promise((resolve, reject) => requests.push({
        url: new URL(url), signal: options.signal, reject,
        resolve: data => resolve({ ok: true, json: async () => data }),
        httpError: status => resolve({ ok: false, status })
      }));
    }
  });
  function tick(ms) {
    const target = now + ms;
    while (true) {
      const next = [...tasks].filter(([, task]) => task.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      tasks.delete(next[0]); now = next[1].at; next[1].callback();
    }
    now = target;
  }
  return { search, requests, states, tick, last: () => states.at(-1), tasks };
}

test('parses valid coordinates and keeps region/country to distinguish names', () => {
  const results = parseLocations({ results: [place('Đà Lạt'), place('Bad', { latitude: 91 }), place('Bad', { longitude: '108' }), null] });
  assert.equal(results.length, 1);
  assert.equal(results[0].label, 'Đà Lạt, Lâm Đồng, Việt Nam');
  assert.equal(results[0].description, 'Lâm Đồng · Việt Nam');
  assert.equal(results[0].lat, 11.9404);
  assert.equal(results[0].symbol, 'VN');
  assert.equal(parseLocations({ results: [place('Singapore', { admin1: 'Singapore', country: 'Singapore' })] })[0].label, 'Singapore');
  assert.equal(parseLocations({ results: Array(20).fill(place('City')) }).length, 8);
  assert.deepEqual(parseLocations({ generationtime_ms: 0.3 }), []);
  for (const invalid of [null, { error: true }, { results: 'broken' }]) assert.throws(() => parseLocations(invalid));
});

test('debounces typing for 400ms and sends an encoded Vietnamese API query', async () => {
  const h = setup();
  h.search.search('Đà'); h.tick(250); h.search.search('  Đà   Lạt  '); h.tick(399);
  assert.equal(h.requests.length, 0);
  h.tick(1);
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].url.origin, 'https://geocoding-api.open-meteo.com');
  assert.equal(h.requests[0].url.searchParams.get('name'), 'Đà Lạt');
  assert.equal(h.requests[0].url.searchParams.get('language'), 'vi');
  assert.equal(h.last().status, 'loading');
  h.requests[0].resolve({ results: [place('Đà Lạt')] }); await flush();
  assert.equal(h.last().results[0].name, 'Đà Lạt');
  assert.equal(h.tasks.size, 0);
});

test('aborts old requests and ignores late responses even if fetch ignores abort', async () => {
  const h = setup(); h.search.search('Paris'); h.tick(400);
  h.search.search('Tokyo');
  assert.equal(h.requests[0].signal.aborted, true);
  h.tick(400); h.requests[1].resolve({ results: [place('Tokyo')] }); await flush();
  h.requests[0].resolve({ results: [place('Paris')] }); await flush();
  assert.equal(h.last().query, 'Tokyo'); assert.equal(h.last().results[0].name, 'Tokyo');
});

test('clearing input cancels both debounce and active requests; short input makes no request', async () => {
  const h = setup(); h.search.search('a'); h.tick(1000);
  assert.equal(h.last().status, 'short'); assert.equal(h.requests.length, 0);
  h.search.search('Paris'); h.search.search(''); h.tick(1000);
  assert.equal(h.requests.length, 0); assert.equal(h.last().status, 'idle');
  h.search.search('Paris'); h.tick(400); h.search.search(' ');
  assert.equal(h.requests[0].signal.aborted, true);
  h.requests[0].resolve({ results: [place('Paris')] }); await flush();
  assert.equal(h.last().status, 'idle');
});

test('caches repeated searches and handles empty API results', async () => {
  const h = setup(); h.search.search('Paris'); h.tick(400);
  h.requests[0].resolve({ results: [place('Paris')] }); await flush();
  h.search.search(''); h.search.search('PARIS'); h.tick(1000);
  assert.equal(h.requests.length, 1); assert.equal(h.last().status, 'results');
  h.search.search('zzzzzzzz'); h.tick(400); h.requests[1].resolve({}); await flush();
  assert.equal(h.last().status, 'results'); assert.deepEqual(h.last().results, []);
});

test('network, HTTP and malformed responses show an error and allow retry', async () => {
  const h = setup(); h.search.search('Paris'); h.tick(400);
  h.requests[0].reject(new TypeError('offline')); await flush(); assert.equal(h.last().status, 'error');
  h.search.search('Paris'); h.tick(400); h.requests[1].httpError(429); await flush(); assert.equal(h.last().status, 'error');
  h.search.search('Paris'); h.tick(400); h.requests[2].resolve({ results: 'broken' }); await flush(); assert.equal(h.last().status, 'error');
  h.search.search('Paris'); h.tick(400); h.requests[3].resolve({ results: [place('Paris')] }); await flush();
  assert.equal(h.last().status, 'results');
});

test('times out after 8 seconds and rejects late success without overwriting a new query', async () => {
  const h = setup(); h.search.search('Paris'); h.tick(400); h.tick(8000);
  assert.equal(h.requests[0].signal.aborted, true);
  assert.equal(h.last().reason, 'timeout');
  h.requests[0].resolve({ results: [place('Paris')] }); await flush();
  assert.equal(h.last().status, 'error');
  h.search.search('Tokyo'); h.tick(400); h.requests[1].resolve({ results: [place('Tokyo')] }); await flush();
  assert.equal(h.last().query, 'Tokyo'); assert.equal(h.last().status, 'results');
});

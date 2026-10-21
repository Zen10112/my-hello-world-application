'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const MAX_PINS = 200;
  const storageKey = 'earth-explorer-v1';
  const format = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let toastTimer;
  function notify(message) {
    $('toast').textContent = message;
    $('toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $('toast').hidden = true; }, 5000);
  }
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  function openTab(id) {
    tabs.forEach(tab => {
      const active = tab.dataset.panel === id;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      $(tab.dataset.panel).hidden = !active;
    });
    document.querySelector('.sidebar-content').scrollTop = 0;
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => openTab(tab.dataset.panel));
    tab.addEventListener('keydown', event => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      if (next === undefined) return;
      event.preventDefault();
      openTab(tabs[next].dataset.panel);
      tabs[next].focus();
    });
  });
  if (typeof THREE === 'undefined') { $('sceneError').hidden = false; return; }
  const container = $('canvas-container');
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.z = 4;
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); }
  catch { $('sceneError').hidden = false; return; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  container.appendChild(renderer.domElement);
  const canvas = renderer.domElement;
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Trái Đất tương tác. Kéo hoặc dùng phím mũi tên để xoay, phím cộng trừ để thu phóng. Dùng Công cụ để đặt pin bằng bàn phím.');
  const globeRadius = 1.2;
  const globeGroup = new THREE.Group();
  scene.add(globeGroup);
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0.1 });
  const globe = new THREE.Mesh(new THREE.SphereGeometry(globeRadius, 64, 48), material);
  globeGroup.add(globe);
  let earthTexture = null;
  let viewMode = 'earth';
  new THREE.TextureLoader().load('https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg', texture => {
    earthTexture = texture;
    texture.encoding = THREE.sRGBEncoding;
    if (viewMode === 'earth') { material.map = texture; material.needsUpdate = true; }
  }, undefined, () => notify('Không tải được ảnh vệ tinh. Bạn vẫn có thể dùng kiểu Đa diện hoặc Lưới sáng.'));
  const pinsGroup = new THREE.Group();
  const routeGroup = new THREE.Group();
  globeGroup.add(pinsGroup, routeGroup);
  scene.add(new THREE.AmbientLight(0xb4dfe8, 0.85));
  const light = new THREE.DirectionalLight(0xfff3db, 1.35);
  light.position.set(-3, 4, 5);
  scene.add(light);
  const rim = new THREE.DirectionalLight(0x54d5d0, 0.6);
  rim.position.set(4, -2, -3);
  scene.add(rim);
  // Quầng khí quyển mờ ở rìa, không che ảnh bề mặt và các pin.
  const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(1.25, 48, 32), new THREE.ShaderMaterial({
    uniforms: { tint: { value: new THREE.Color(0x72cfd3) } },
    vertexShader: 'varying vec3 vNormal; varying vec3 vPosition; void main(){vNormal=normalize(normalMatrix*normal); vec4 p=modelViewMatrix*vec4(position,1.0); vPosition=p.xyz; gl_Position=projectionMatrix*p;}',
    fragmentShader: 'uniform vec3 tint; varying vec3 vNormal; varying vec3 vPosition; void main(){float glow=pow(1.0-abs(dot(normalize(vNormal),normalize(-vPosition))),3.0); gl_FragColor=vec4(tint,glow*0.28);}',
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide
  }));
  globeGroup.add(atmosphere);
  const grid = new THREE.Group();
  const gridMaterial = new THREE.LineBasicMaterial({ color: 0x96d8cb, transparent: true, opacity: 0.17 });
  function addGridLine(points) { grid.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), gridMaterial)); }
  for (let lat = -60; lat <= 60; lat += 30) {
    const points = [];
    for (let lng = -180; lng <= 180; lng += 3) points.push(coordinatesToVector(lat, lng).multiplyScalar(1.208));
    addGridLine(points);
  }
  for (let lng = -180; lng < 180; lng += 30) {
    const points = [];
    for (let lat = -90; lat <= 90; lat += 3) points.push(coordinatesToVector(lat, lng).multiplyScalar(1.208));
    addGridLine(points);
  }
  grid.visible = false;
  globeGroup.add(grid);
  const stars = [];
  // Nền sao cố định, không cần tải thêm ảnh.
  let seed = 42;
  const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  for (let i = 0; i < 420; i++) stars.push((random() - 0.5) * 26, (random() - 0.5) * 20, -6 - random() * 12);
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(stars, 3));
  scene.add(new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: 0x8fbcbf, size: 0.025, transparent: true, opacity: 0.5, sizeAttenuation: true })));
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  let isMultiPin = true;
  let autoRotate = !reducedMotion;
  let selectedPin = null;
  let targetQuaternion = null;
  let activePointer = null;
  let dragStart = null;
  let previousPointer = null;
  let hasMoved = false;
  let fittedDistance = 4;
  function validCoordinates(lat, lng) {
    return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
  }
  function coordinatesToVector(lat, lng) {
    const phi = (90 - lat) * Math.PI / 180, theta = (lng + 180) * Math.PI / 180;
    return new THREE.Vector3(-Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta));
  }
  function locationRotation(lat, lng) {
    const direction = coordinatesToVector(lat, lng);
    const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-direction.x, direction.z));
    const pitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), lat * Math.PI / 180);
    return pitch.multiply(yaw);
  }
  function distanceKm(first, second) {
    const r = Math.PI / 180;
    const a = Math.sin((second.lat - first.lat) * r / 2) ** 2 + Math.cos(first.lat * r) * Math.cos(second.lat * r) * Math.sin((second.lng - first.lng) * r / 2) ** 2;
    return 12742 * Math.atan2(Math.sqrt(Math.min(1, a)), Math.sqrt(Math.max(0, 1 - a)));
  }
  function pinData() { return pinsGroup.children.map(pin => ({ ...pin.userData })); }
  function saveState() {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ version: 1, multiPin: isMultiPin, pins: pinData(), view: viewMode, grid: $('gridToggle').checked, routes: $('routeToggle').checked }));
      $('storageStatus').textContent = 'Tự động lưu trên trình duyệt này.';
    } catch { $('storageStatus').textContent = 'Không thể lưu trên trình duyệt này. Hãy xuất JSON để giữ hành trình.'; }
  }
  function closePopup() { $('infoPopup').hidden = true; }
  function disposePin(pin) {
    pinsGroup.remove(pin);
    pin.geometry.dispose(); pin.material.dispose();
    if (selectedPin === pin) { selectedPin = null; closePopup(); }
  }
  function createPin(lat, lng, name = 'Vị trí đã chọn') {
    const pin = new THREE.Mesh(new THREE.SphereGeometry(0.023, 12, 12), new THREE.MeshBasicMaterial({ color: 0xefac79 }));
    pin.position.copy(coordinatesToVector(lat, lng)).multiplyScalar(globeRadius + 0.025);
    pin.userData = { lat, lng, name };
    pinsGroup.add(pin);
    return pin;
  }
  function rebuildRoutes() {
    [...routeGroup.children].forEach(line => { routeGroup.remove(line); line.geometry.dispose(); line.material.dispose(); });
    if (!$('routeToggle').checked) return;
    const pins = pinsGroup.children;
    for (let i = 1; i < pins.length; i++) {
      const from = coordinatesToVector(pins[i - 1].userData.lat, pins[i - 1].userData.lng);
      const to = coordinatesToVector(pins[i].userData.lat, pins[i].userData.lng);
      const rotation = new THREE.Quaternion().setFromUnitVectors(from, to);
      const points = [];
      for (let step = 0; step <= 64; step++) {
        const t = step / 64;
        const q = new THREE.Quaternion().slerp(rotation, t);
        points.push(from.clone().applyQuaternion(q).multiplyScalar(1.225 + Math.sin(t * Math.PI) * 0.1));
      }
      routeGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: 0xefac79, transparent: true, opacity: 0.8 })));
    }
  }
  function renderPinList() {
    const list = $('pinList'); list.replaceChildren();
    const pins = pinsGroup.children;
    $('pinCount').textContent = pins.length;
    $('statPins').textContent = String(pins.length).padStart(2, '0');
    $('clearPins').disabled = $('exportPins').disabled = pins.length === 0;
    if (!pins.length) {
      const empty = document.createElement('li'); empty.className = 'empty-pins';
      empty.textContent = 'Hành trình còn đang chờ bạn. Chọn một thành phố hoặc chạm lên quả cầu để bắt đầu.'; list.append(empty);
    }
    pins.forEach(pin => {
      const row = document.createElement('li'); row.className = 'pin-row';
      const focus = document.createElement('button'); focus.className = 'pin-focus';
      const name = document.createElement('strong'); name.textContent = pin.userData.name;
      const coords = document.createElement('span'); coords.textContent = `${pin.userData.lat.toFixed(2)}°, ${pin.userData.lng.toFixed(2)}°`;
      focus.append(name, coords); focus.addEventListener('click', () => selectPin(pin, true));
      const remove = document.createElement('button'); remove.className = 'pin-remove'; remove.textContent = '×';
      remove.setAttribute('aria-label', `Xóa ${pin.userData.name}`);
      remove.addEventListener('click', () => { disposePin(pin); renderPinList(); saveState(); });
      row.append(focus, remove); list.append(row);
    });
    let total = 0;
    for (let i = 1; i < pins.length; i++) total += distanceKm(pins[i - 1].userData, pins[i].userData);
    $('totalDistance').textContent = format.format(total);
    $('distanceInfo').textContent = pins.length < 2 ? 'Thêm hai điểm đến để đo khoảng cách và vẽ hành trình.' : `${pins.length - 1} chặng · ${format.format(total)} km theo thứ tự danh sách. Đường nối biểu diễn khoảng cách đường tròn lớn, không phải tuyến đường bộ hay lịch bay.`;
    rebuildRoutes();
  }
  function setAutoRotate(enabled) {
    autoRotate = enabled;
    $('rotateToggle').setAttribute('aria-pressed', String(enabled));
    $('rotateToggle').title = enabled ? 'Tạm dừng tự xoay' : 'Bật tự xoay';
  }
  function selectPin(pin, focusCamera = false) {
    if (selectedPin) selectedPin.material.color.setHex(0xefac79);
    selectedPin = pin; pin.material.color.setHex(0xc4edb0);
    setAutoRotate(false);
    const { lat, lng, name } = pin.userData;
    $('popupTitle').textContent = name;
    $('popupCoords').textContent = `Vĩ độ ${lat.toFixed(4)}° · Kinh độ ${lng.toFixed(4)}°`;
    $('pinName').value = name; $('infoPopup').hidden = false;
    if (focusCamera) {
      targetQuaternion = locationRotation(lat, lng);
      if (reducedMotion) { globeGroup.quaternion.copy(targetQuaternion); targetQuaternion = null; }
    }
  }
  function addLocation(lat, lng, name = 'Vị trí đã chọn') {
    if (!validCoordinates(lat, lng)) return;
    if (isMultiPin && pinsGroup.children.length >= MAX_PINS) { notify('Tối đa 200 điểm đến. Hãy xóa bớt điểm trước khi thêm.'); return; }
    if (!isMultiPin) [...pinsGroup.children].forEach(disposePin);
    const pin = createPin(lat, lng, name); selectPin(pin, true); renderPinList(); saveState();
  }
  function setView(mode, persist = true) {
    viewMode = mode;
    globe.geometry.dispose();
    globe.geometry = mode === 'faceted' ? new THREE.IcosahedronGeometry(globeRadius, 2) : new THREE.SphereGeometry(globeRadius, mode === 'hologram' ? 36 : 64, mode === 'hologram' ? 24 : 48);
    material.map = mode === 'earth' ? earthTexture : null;
    material.color.setHex(mode === 'faceted' ? 0x28645f : mode === 'hologram' ? 0x6ad7c5 : 0xffffff);
    material.wireframe = mode === 'hologram'; material.flatShading = mode === 'faceted';
    material.emissive.setHex(mode === 'hologram' ? 0x164039 : 0x000000);
    material.needsUpdate = true;
    // Lõi tối che các mặt lưới phía sau; quả cầu gốc vẫn nhận raycast chính xác.
    hologramCore.visible = mode === 'hologram';
    document.querySelectorAll('[data-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === mode)));
    $('viewLabel').textContent = { earth: 'NATURAL VIEW / 01', faceted: 'POLYGON VIEW / 02', hologram: 'HOLOGRAM VIEW / 03' }[mode];
    if (persist) saveState();
  }
  const hologramCore = new THREE.Mesh(new THREE.SphereGeometry(1.185, 48, 32), new THREE.MeshBasicMaterial({ color: 0x081b20 }));
  hologramCore.visible = false; globeGroup.add(hologramCore);
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
  $('multiPinToggle').addEventListener('change', event => {
    isMultiPin = event.target.checked;
    if (!isMultiPin) [...pinsGroup.children].slice(0, -1).forEach(disposePin);
    renderPinList(); saveState();
  });
  $('clearPins').addEventListener('click', () => {
    [...pinsGroup.children].forEach(disposePin); targetQuaternion = null; closePopup(); renderPinList(); saveState();
  });
  $('closePopup').addEventListener('click', closePopup);
  $('renameForm').addEventListener('submit', event => {
    event.preventDefault(); const name = $('pinName').value.trim();
    if (!selectedPin || !name) return;
    selectedPin.userData.name = name.slice(0, 120); $('popupTitle').textContent = selectedPin.userData.name;
    renderPinList(); saveState(); notify('Đã lưu tên địa điểm.');
  });
  $('coordinateForm').addEventListener('submit', event => {
    event.preventDefault();
    addLocation(Number($('latitude').value), Number($('longitude').value), $('locationName').value.trim() || 'Tọa độ tùy chọn');
  });
  $('routeToggle').addEventListener('change', () => { rebuildRoutes(); saveState(); });
  $('gridToggle').addEventListener('change', event => { grid.visible = event.target.checked; saveState(); });
  function resetView() {
    targetQuaternion = locationRotation(20, 105);
    if (reducedMotion) { globeGroup.quaternion.copy(targetQuaternion); targetQuaternion = null; }
    camera.position.z = fittedDistance; closePopup(); setAutoRotate(false);
  }
  $('resetView').addEventListener('click', resetView);
  function zoomBy(delta) { camera.position.z = THREE.MathUtils.clamp(camera.position.z + delta, 2.6, Math.max(7, fittedDistance * 1.6)); }
  $('zoomIn').addEventListener('click', () => zoomBy(-0.35));
  $('zoomOut').addEventListener('click', () => zoomBy(0.35));
  $('rotateToggle').addEventListener('click', () => { targetQuaternion = null; setAutoRotate(!autoRotate); });
  canvas.addEventListener('wheel', event => { event.preventDefault(); zoomBy(Math.sign(event.deltaY) * 0.2); }, { passive: false });
  canvas.addEventListener('keydown', event => {
    const rotation = { ArrowLeft: ['y', -0.12], ArrowRight: ['y', 0.12], ArrowUp: ['x', -0.12], ArrowDown: ['x', 0.12] }[event.key];
    if (rotation) { event.preventDefault(); targetQuaternion = null; setAutoRotate(false); globeGroup.rotation[rotation[0]] += rotation[1]; }
    if (event.key === '+' || event.key === '=') { event.preventDefault(); zoomBy(-0.35); }
    if (event.key === '-') { event.preventDefault(); zoomBy(0.35); }
    if (event.key === 'Escape') closePopup();
  });
  canvas.addEventListener('pointerdown', event => {
    if (activePointer !== null || !event.isPrimary || event.button !== 0) return;
    activePointer = event.pointerId; dragStart = previousPointer = { x: event.clientX, y: event.clientY };
    hasMoved = false; targetQuaternion = null; canvas.setPointerCapture(event.pointerId); setAutoRotate(false);
  });
  canvas.addEventListener('pointermove', event => {
    if (event.pointerId !== activePointer) return;
    if (Math.hypot(event.clientX - dragStart.x, event.clientY - dragStart.y) > 5) hasMoved = true;
    if (hasMoved) { globeGroup.rotation.y += (event.clientX - previousPointer.x) * 0.005; globeGroup.rotation.x += (event.clientY - previousPointer.y) * 0.005; }
    previousPointer = { x: event.clientX, y: event.clientY };
  });
  canvas.addEventListener('pointerup', event => {
    if (event.pointerId !== activePointer) return;
    activePointer = null; canvas.releasePointerCapture(event.pointerId);
    if (hasMoved || Math.hypot(event.clientX - dragStart.x, event.clientY - dragStart.y) > 5) return;
    const bounds = canvas.getBoundingClientRect();
    mouse.set((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1);
    scene.updateMatrixWorld(true); camera.updateMatrixWorld(true); raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects([globe, ...pinsGroup.children]);
    if (!hits.length) return;
    if (hits[0].object !== globe) { selectPin(hits[0].object); return; }
    const point = globeGroup.worldToLocal(hits[0].point.clone()).normalize();
    const lat = Math.asin(THREE.MathUtils.clamp(point.y, -1, 1)) * 180 / Math.PI;
    const raw = Math.atan2(point.z, -point.x) * 180 / Math.PI - 180;
    const lng = ((raw + 180) % 360 + 360) % 360 - 180;
    if (isMultiPin && pinsGroup.children.length >= MAX_PINS) { notify('Tối đa 200 điểm đến.'); return; }
    if (!isMultiPin) [...pinsGroup.children].forEach(disposePin);
    selectPin(createPin(lat, lng)); renderPinList(); saveState();
  });
  canvas.addEventListener('pointercancel', () => { activePointer = null; });
  canvas.addEventListener('lostpointercapture', () => { activePointer = null; });
  const cities = [
    ['Hà Nội', 'Việt Nam', 21.0285, 105.8542, 'HN'], ['TP. Hồ Chí Minh', 'Việt Nam', 10.8231, 106.6297, 'SG'],
    ['Tokyo', 'Nhật Bản', 35.6762, 139.6503, 'TK'], ['Singapore', 'Singapore', 1.3521, 103.8198, 'SI'],
    ['Paris', 'Pháp', 48.8566, 2.3522, 'PA'], ['New York', 'Hoa Kỳ', 40.7128, -74.006, 'NY'],
    ['London', 'Anh', 51.5074, -0.1278, 'LD'], ['Sydney', 'Úc', -33.8688, 151.2093, 'SY'],
    ['Seoul', 'Hàn Quốc', 37.5665, 126.978, 'SE'], ['Bangkok', 'Thái Lan', 13.7563, 100.5018, 'BK'],
    ['Dubai', 'Các Tiểu vương quốc Ả Rập Thống nhất', 25.2048, 55.2708, 'DB'], ['Cairo', 'Ai Cập', 30.0444, 31.2357, 'CA'],
    ['Cape Town', 'Nam Phi', -33.9249, 18.4241, 'CT'], ['Rio de Janeiro', 'Brazil', -22.9068, -43.1729, 'RJ'],
    ['Đà Nẵng', 'Việt Nam', 16.0544, 108.2022, 'DN'], ['Rome', 'Ý', 41.9028, 12.4964, 'RO']
  ];
  function normalize(value) { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase(); }
  function localCities(query = '') {
    return (query ? cities.filter(city => normalize(city[0] + ' ' + city[1]).includes(normalize(query))) : cities.slice(0, 6))
      .map(city => ({ name: city[0], description: city[1], lat: city[2], lng: city[3], symbol: city[4], label: `${city[0]}, ${city[1]}` }));
  }
  function renderCityResults(results) {
    $('cityResults').replaceChildren();
    results.forEach(city => {
      const row = document.createElement('li');
      const button = document.createElement('button'); button.className = 'city-button';
      const symbol = document.createElement('span'); symbol.className = 'city-symbol'; symbol.textContent = city.symbol;
      const text = document.createElement('span'), title = document.createElement('strong'), country = document.createElement('small');
      text.className = 'city-copy';
      title.textContent = city.name; country.textContent = city.description; text.append(title, country);
      const arrow = document.createElement('span'); arrow.className = 'city-arrow'; arrow.textContent = '↗'; arrow.setAttribute('aria-hidden', 'true');
      button.append(symbol, text, arrow); button.addEventListener('click', () => addLocation(city.lat, city.lng, city.label));
      row.append(button); $('cityResults').append(row);
    });
  }
  const citySearch = OrbitGeocoding.createSearch({
    onState({ status, query, results, reason }) {
      const pending = status === 'waiting' || status === 'loading';
      $('cityResults').setAttribute('aria-busy', String(pending));
      $('retrySearch').hidden = status !== 'error';
      $('searchHeading').textContent = status === 'idle' ? 'Gợi ý khám phá' : 'Kết quả tìm kiếm';
      $('searchCount').textContent = '';
      $('searchStatus').classList.toggle('search-error', status === 'error');
      if (status === 'idle') {
        const suggestions = localCities();
        renderCityResults(suggestions);
        $('searchCount').textContent = `${suggestions.length} gợi ý`;
        $('searchStatus').textContent = '';
      } else if (pending) {
        renderCityResults([]);
        $('searchStatus').textContent = status === 'loading' ? `Đang tìm “${query}”…` : 'Đang chờ bạn nhập xong…';
      } else if (status === 'short') {
        renderCityResults([]);
        $('searchStatus').textContent = 'Nhập ít nhất 2 ký tự để tìm thành phố.';
      } else if (status === 'error') {
        const fallback = localCities(query);
        renderCityResults(fallback);
        $('searchCount').textContent = fallback.length ? `${fallback.length} gợi ý có sẵn` : '';
        $('searchStatus').textContent = (reason === 'timeout' ? 'Tìm kiếm mất quá lâu.' : 'Chưa kết nối được dịch vụ tìm kiếm.') +
          (fallback.length ? ' Bạn có thể chọn gợi ý có sẵn bên dưới hoặc thử lại.' : ' Hãy kiểm tra kết nối mạng và thử lại, hoặc nhập tọa độ trong Công cụ.');
      } else {
        renderCityResults(results);
        $('searchCount').textContent = `${results.length} địa điểm`;
        $('searchStatus').textContent = results.length ? `Tìm thấy ${results.length} địa điểm. Chọn đúng tỉnh và quốc gia để đặt pin.` :
          'Không tìm thấy địa điểm. Thử tên khác, tên không dấu hoặc thêm quốc gia sau dấu phẩy.';
      }
    }
  });
  $('citySearch').addEventListener('input', event => { if (!event.isComposing) citySearch.search(event.target.value); });
  $('citySearch').addEventListener('compositionstart', () => citySearch.cancel());
  $('citySearch').addEventListener('compositionend', () => citySearch.search($('citySearch').value));
  $('retrySearch').addEventListener('click', () => citySearch.search($('citySearch').value));
  window.addEventListener('pagehide', () => citySearch.cancel());
  $('sampleTrip').addEventListener('click', () => {
    const trip = [cities[0], cities[3], cities[2]].filter(city => !pinsGroup.children.some(pin => pin.userData.lat === city[2] && pin.userData.lng === city[3]));
    if (pinsGroup.children.length + trip.length > MAX_PINS) { notify('Không đủ chỗ cho hành trình gợi ý. Hãy xóa bớt điểm.'); return; }
    isMultiPin = true; $('multiPinToggle').checked = true;
    trip.forEach(city => createPin(city[2], city[3], `${city[0]}, ${city[1]}`));
    if (pinsGroup.children.length) selectPin(pinsGroup.children[pinsGroup.children.length - 1], true);
    renderPinList(); saveState(); openTab('panelSaved'); notify('Đã thêm hành trình châu Á; các điểm đã có được giữ nguyên.');
  });
  function validateImport(data) {
    if (!data || data.version !== 1 || !Array.isArray(data.pins) || data.pins.length > MAX_PINS ||
      (data.multiPin !== undefined && typeof data.multiPin !== 'boolean')) throw new Error('Tệp không đúng định dạng Orbit hoặc vượt quá 200 điểm.');
    const pins = data.pins.map(pin => {
      if (!pin || !validCoordinates(pin.lat, pin.lng) || typeof pin.name !== 'string' || !pin.name.trim() || pin.name.length > 120) throw new Error('Tệp chứa địa điểm không hợp lệ. Chưa thay đổi hành trình hiện tại.');
      return { lat: pin.lat, lng: pin.lng, name: pin.name.trim() };
    });
    return { pins, multiPin: data.multiPin !== false };
  }
  $('exportPins').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ version: 1, multiPin: isMultiPin, pins: pinData() }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = 'orbit-hanh-trinh.json'; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000); notify('Đã xuất bản sao hành trình JSON.');
  });
  $('importPins').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', async event => {
    const file = event.target.files[0]; if (!file) return;
    try {
      if (file.size > 256 * 1024) throw new Error('Tệp quá lớn. Vui lòng chọn JSON nhỏ hơn 256 KB.');
      const imported = validateImport(JSON.parse(await file.text()));
      [...pinsGroup.children].forEach(disposePin); targetQuaternion = null; closePopup();
      isMultiPin = imported.multiPin; $('multiPinToggle').checked = isMultiPin;
      (isMultiPin ? imported.pins : imported.pins.slice(-1)).forEach(pin => createPin(pin.lat, pin.lng, pin.name));
      renderPinList(); saveState(); openTab('panelSaved'); notify('Đã nhập hành trình thành công.');
    } catch (error) { notify(error instanceof SyntaxError ? 'Không đọc được JSON. Hành trình hiện tại vẫn được giữ nguyên.' : error.message); }
    finally { event.target.value = ''; }
  });
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (saved && Array.isArray(saved.pins)) {
      isMultiPin = saved.multiPin === true;
      const validPins = saved.pins.filter(pin => pin && validCoordinates(pin.lat, pin.lng));
      (isMultiPin ? validPins.slice(0, MAX_PINS) : validPins.slice(-1)).forEach(pin => createPin(pin.lat, pin.lng, typeof pin.name === 'string' ? pin.name.slice(0, 120) : 'Vị trí đã chọn'));
      $('gridToggle').checked = saved.grid === true; grid.visible = saved.grid === true;
      $('routeToggle').checked = saved.routes !== false;
      if (['earth', 'faceted', 'hologram'].includes(saved.view)) setView(saved.view, false);
    }
  } catch { $('storageStatus').textContent = 'Không đọc được dữ liệu cũ. Bạn vẫn có thể bắt đầu hành trình mới.'; }
  $('multiPinToggle').checked = isMultiPin;
  globeGroup.quaternion.copy(locationRotation(20, 105));
  setAutoRotate(autoRotate); renderPinList(); citySearch.search('');
  function resize() {
    const { width, height } = container.getBoundingClientRect();
    if (!width || !height) return;
    const zoomRatio = camera.position.z / fittedDistance;
    camera.aspect = width / height;
    fittedDistance = Math.max(4, 1.45 / (Math.tan(camera.fov * Math.PI / 360) * Math.min(1, camera.aspect)));
    camera.position.z = THREE.MathUtils.clamp(fittedDistance * zoomRatio, 2.6, Math.max(7, fittedDistance * 1.6));
    camera.updateProjectionMatrix(); renderer.setSize(width, height);
  }
  new ResizeObserver(resize).observe(container); resize();
  canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); $('sceneError').hidden = false; });
  canvas.addEventListener('webglcontextrestored', () => { $('sceneError').hidden = true; });
  const clock = new THREE.Clock();
  function animate() {
    requestAnimationFrame(animate);
    const delta = Math.min(clock.getDelta(), 0.1);
    if (targetQuaternion) {
      globeGroup.quaternion.slerp(targetQuaternion, 1 - Math.exp(-6 * delta));
      if (globeGroup.quaternion.angleTo(targetQuaternion) < 0.001) { globeGroup.quaternion.copy(targetQuaternion); targetQuaternion = null; }
    } else if (autoRotate && activePointer === null) globeGroup.rotation.y += delta * 0.065;
    renderer.render(scene, camera);
  }
  animate();
})();

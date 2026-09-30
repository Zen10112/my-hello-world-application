const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.z = 3.5;

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
container.appendChild(renderer.domElement);

const globeGroup = new THREE.Group();
scene.add(globeGroup);

// Tạo quả cầu Trái Đất
const globeRadius = 1.2;
const geometry = new THREE.SphereGeometry(globeRadius, 64, 64);
const textureLoader = new THREE.TextureLoader();
const earthTexture = textureLoader.load('https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg');
const material = new THREE.MeshStandardMaterial({
  map: earthTexture,
  roughness: 0.8,
  metalness: 0.1
});
const globe = new THREE.Mesh(geometry, material);
globeGroup.add(globe);
globeGroup.rotation.z = 0.41;

// Nhóm chứa các pin
const pinsGroup = new THREE.Group();
globeGroup.add(pinsGroup);

// Ánh sáng
scene.add(new THREE.AmbientLight(0xffffff, 0.4));
const dirLight = new THREE.DirectionalLight(0xffffff, 1.3);
dirLight.position.set(5, 3, 5);
scene.add(dirLight);

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

let isDragging = false;
let hasMoved = false;
let prevMousePos = { x: 0, y: 0 };
let autoRotate = true;
let isMultiPin = false; // Biến trạng thái: Mặc định là False (chỉ hiển thị 1 pin)

// Lắng nghe sự kiện bật/tắt checkbox chọn nhiều pin
window.toggleMultiPin = function(checkbox) {
  isMultiPin = checkbox.checked;
  // Nếu chuyển về chế độ 1 pin mà đang có nhiều pin thì clear bớt, chỉ giữ lại pin mới nhất (hoặc xóa sạch)
  if (!isMultiPin && pinsGroup.children.length > 1) {
    const lastPin = pinsGroup.children[pinsGroup.children.length - 1];
    while(pinsGroup.children.length > 0){ 
      pinsGroup.remove(pinsGroup.children[0]); 
    }
    pinsGroup.add(lastPin);
  }
}

window.addEventListener('mousedown', (e) => {
  isDragging = true;
  hasMoved = false;
  prevMousePos = { x: e.clientX, y: e.clientY };
  autoRotate = false; 
});

window.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  const deltaX = e.clientX - prevMousePos.x;
  const deltaY = e.clientY - prevMousePos.y;

  if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) {
    hasMoved = true;
  }

  globeGroup.rotation.y += deltaX * 0.005;
  globeGroup.rotation.x += deltaY * 0.005;

  prevMousePos = { x: e.clientX, y: e.clientY };
});

window.addEventListener('mouseup', (e) => {
  isDragging = false;

  if (!hasMoved) {
    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObject(globe);

    if (intersects.length > 0) {
      const intersect = intersects[0];
      
      const localPoint = intersect.point.clone();
      globeGroup.worldToLocal(localPoint);

      const lat = 90 - (Math.acos(localPoint.y / globeRadius) * 180 / Math.PI);
      let lng = (Math.atan2(localPoint.z, -localPoint.x) * 180 / Math.PI) - 180;
      while (lng < -180) lng += 360;
      while (lng > 180) lng -= 360;

      // Xử lý tạo pin dựa theo chế độ
      if (!isMultiPin) {
        // Nếu ở chế độ 1 pin: Xóa sạch các pin cũ trước khi cắm pin mới
        while(pinsGroup.children.length > 0){ 
          pinsGroup.remove(pinsGroup.children[0]); 
        }
      }

      createPin(localPoint, lat, lng);
      showPopup("Vị trí đã chọn", `Vĩ độ: ${lat.toFixed(2)}° | Kinh độ: ${lng.toFixed(2)}°`);
    }
  }
});

function createPin(position, lat, lng) {
  const pinGeo = new THREE.SphereGeometry(0.035, 16, 16);
  const pinMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b });
  const pin = new THREE.Mesh(pinGeo, pinMat);

  position.normalize().multiplyScalar(globeRadius + 0.02);
  pin.position.copy(position);
  pin.userData = { lat, lng };

  pinsGroup.add(pin);
}

window.clearAllPins = function() {
  while(pinsGroup.children.length > 0){ 
    pinsGroup.remove(pinsGroup.children[0]); 
  }
  closePopup();
}

function showPopup(title, desc) {
  document.getElementById('popupTitle').innerText = title;
  document.getElementById('popupCoords').innerText = desc;
  document.getElementById('infoPopup').classList.add('active');
}

window.closePopup = function() {
  document.getElementById('infoPopup').classList.remove('active');
  autoRotate = true;
}

let targetRotationY = null;
let targetRotationX = null;

window.focusLocation = function(lat, lng, name) {
  autoRotate = false;
  
  if (!isMultiPin) {
    while(pinsGroup.children.length > 0){ 
      pinsGroup.remove(pinsGroup.children[0]); 
    }
  }

  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);
  const x = -(globeRadius * Math.sin(phi) * Math.cos(theta));
  const z = (globeRadius * Math.sin(phi) * Math.sin(theta));
  const y = (globeRadius * Math.cos(phi));
  createPin(new THREE.Vector3(x, y, z), lat, lng);

  showPopup(name, `Vĩ độ: ${lat.toFixed(2)}° | Kinh độ: ${lng.toFixed(2)}°`);

  targetRotationY = -(lng + 90) * (Math.PI / 180);
  targetRotationX = lat * (Math.PI / 180);
}

function animate() {
  requestAnimationFrame(animate);

  if (autoRotate && !isDragging) {
    globeGroup.rotation.y += 0.0015;
  }

  if (targetRotationY !== null && targetRotationX !== null) {
    globeGroup.rotation.y += (targetRotationY - globeGroup.rotation.y) * 0.05;
    globeGroup.rotation.x += (targetRotationX - globeGroup.rotation.x) * 0.05;

    if (Math.abs(targetRotationY - globeGroup.rotation.y) < 0.01) {
      targetRotationY = null;
      targetRotationX = null;
    }
  }

  renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
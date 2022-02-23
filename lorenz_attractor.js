var simulation = document.getElementById("simulation");
simulation.innerHeight = window.innerHeight;
simulation.innerWidth = window.innerWidth*0.4;
var renderer = new THREE.WebGLRenderer({canvas:simulation,alpha:true});
renderer.setSize(simulation.innerWidth, simulation.innerHeight*0.7); 
renderer.setClearColor(0xffffff, 0);
renderer.setPixelRatio( window.devicePixelRatio );

var camera = new THREE.PerspectiveCamera(70, simulation.innerWidth / simulation.innerHeight, 0.1, 2000);
camera.position.set(0, 0, 75);

var controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.target = new THREE.Vector3(0, 0, 20);
controls.update();

var scene = new THREE.Scene({});
/**scene.background = new THREE.Color( 0x1E2832);**/

var globalMaterial = new THREE.SpriteMaterial({
  map: new THREE.CanvasTexture(generateSprite()),
  blending: THREE.AdditiveBlending });



let particles = [];
let numOfParticles = 10000;

let sigma = 10;
let rho = 22;
let beta = 8 / 3;


let dt = 0.0085;

for (var i = 0; i < numOfParticles; i++) {

  let material = new THREE.Sprite(globalMaterial);

  let x, y, z;
  if (i == 0) {
    x = y = z = 0.1;
  } else {
    x = particles[i - 1].material.position.x;
    y = particles[i - 1].material.position.y;
    z = particles[i - 1].material.position.z;

    let dx = sigma * (y - x);
    let dy = x * (rho - z) - y;
    let dz = x * y - beta * z;

    x += dx * dt;
    y += dy * dt;
    z += dz * dt;
  }

  let particle = new Particle(material, x, y, z);
  particle.material.scale.x = .3;
  particle.material.scale.y = .3;
  particle.material.scale.z = .3;

  scene.add(particle.material);
  particles.push(particle);
}

dt = .0005;
function render() {
  renderer.render(scene, camera);

  //renderer.autoClearColor = false;
  for (var i = 0; i < numOfParticles; i++) {
    let x = particles[i].material.position.x;
    let y = particles[i].material.position.y;
    let z = particles[i].material.position.z;

    let dx = sigma * (y - x);
    let dy = x * (rho - z) - y;
    let dz = x * y - beta * z;

    x += dx * dt;
    y += dy * dt;
    z += dz * dt;

    particles[i].material.position.x = x;
    particles[i].material.position.y = y;
    particles[i].material.position.z = z;

  }

  controls.update();
  requestAnimationFrame(render);
}

render();

simulation.appendChild(renderer.domElement);

// Functions to generate particle and particle sprite

function Particle(material, x, y, z) {
  this.material = material;
  this.material.position.x = x;
  this.material.position.y = y;
  this.material.position.z = z;
}

function generateSprite() {
  var canvas = document.createElement('canvas');
  canvas.width = 48;
  canvas.height = 48;

  var context = canvas.getContext('2d');
  var gradient = context.createRadialGradient(canvas.width / 2, canvas.height / 2, 0, canvas.width / 2, canvas.height / 2, canvas.width / 2);
  gradient.addColorStop(0.1, 'rgba(254, 149, 1,0.2)');
  gradient.addColorStop(0.2, 'rgba(176, 104, 2,0.5)');
  gradient.addColorStop(0.3, 'rgba(128, 75, 0,0.8)');
  gradient.addColorStop(0.95, 'rgba(128, 81, 15,0.9)');
  gradient.addColorStop(1, 'rgba(30,40,50,1)');

  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);

  return canvas;
}
class App {
    constructor({animate, setup}) {
        this.animate = animate;
        this.setup = setup;
        window.app = this;
    };

    init = () => {
        this.initScene();
        this.initRenderer(); // 50 ms
        this.initCamera();
        this.initControls();
        this.render(); // 50 ms
        this.update(); // 50 ms
    };

    initScene = () => {
        this.scene = new THREE.Scene();
    };

    initRenderer = () => {
        let w = document.querySelector('.schero__img-earth').offsetWidth,
            h = document.querySelector('.schero__img-earth').offsetHeight

        this.renderer = new THREE.WebGLRenderer({alpha: true});
        this.renderer.setClearColor(0xffffff, 0);
        this.renderer.setSize(w, h);
        this.renderer.setPixelRatio(window.devicePixelRatio * 1.5);
        this.renderer.shadowMap.enabled = true;
        this.renderer.antialias = true;
    };

    initCamera = () => {
        let w = document.querySelector('.schero__img-earth').offsetWidth,
            h = document.querySelector('.schero__img-earth').offsetHeight

        this.ratio = w / h;
        this.camera = new THREE.PerspectiveCamera(45, this.ratio, 0.1, 10000);
        this.camera.lookAt(this.scene.position);
        this.camera.position.set(0, 15, 30);
    };

    initControls = () => {
        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);

        this.controls.enablePan = false;
        this.controls.enableKeys = false;
        this.controls.enableZoom = false;
    };

    render = () => {
        this.setup(this);
        document.querySelector('.schero__img-earth').appendChild(this.renderer.domElement);
    };

    update = () => {
        this.animate(this);
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
        requestAnimationFrame(this.update);
    };

    handleResize = () => {
        let w = document.querySelector('.schero__img-earth').offsetWidth,
            h = document.querySelector('.schero__img-earth').offsetHeight

        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
    };
}

class Globe {
    constructor(radius) {
        this.radius = config.sizes.globe;
        this.geometry = new THREE.SphereGeometry(this.radius, 64, 64);

        groups.globe = new THREE.Group();
        groups.globe.name = 'Globe';

        this.initGlobe();

        return groups.globe;
    }

    initGlobe() {
        const scale = config.scale.globeScale;
        this.globeMaterial = this.createGlobeMaterial();
        this.globe = new THREE.Mesh(this.geometry, this.globeMaterial);
        this.globe.scale.set(scale, scale, scale);
        elements.globe = this.globe;

        groups.map = new THREE.Group();
        groups.map.name = 'Map';

        groups.map.add(this.globe);
        groups.globe.add(groups.map);
    }

    createGlobeMaterial() {
        const texture = loader.load()

        const shaderMaterial = new THREE.ShaderMaterial({
            uniforms: { texture: { value: texture } },
            vertexShader: shaders.globe.vertexShader,
            fragmentShader: shaders.globe.fragmentShader,
            blending: THREE.AdditiveBlending,
            transparent: true,
        });

        return shaderMaterial;
    }
}

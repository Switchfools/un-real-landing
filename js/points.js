class Points {
    constructor(grid) {
        this.grid = grid;
        this.total = grid.length;
        this.radius = config.sizes.globe + config.sizes.globe * config.scale.points;

        this.sizeArray = [];
        this.positionArray = [];
        this.colorsArray = [];

        groups.points = new THREE.Group();
        groups.points.name = 'Points';

        this.create();

        elements.globePoints = this.points;
        groups.points.add(this.points);
    }

    create() {
        const color = new THREE.Color();

        for (let i = 0; i < this.grid.length; i++) {
            const { lat, lon } = this.grid[i];
            const { x, y, z } = toSphereCoordinates(lat, lon, this.radius);

            this.positionArray.push(-x, -y, -z);
            this.sizeArray.push(this.pointSize);

            color.set(this.pointColor);
            color.toArray(this.colorsArray, i * 3);
        }

        const positions = new Float32Array(this.positionArray);
        const colors = new Float32Array(this.colorsArray);
        const sizes = new Float32Array(this.sizeArray);

        this.geometry = new THREE.BufferGeometry();
        this.material = new THREE.PointsMaterial({
            color: config.colors.globeDotColor,
            size: config.sizes.globeDotSize
        });

        this.geometry.addAttribute('position', new THREE.BufferAttribute(positions, 3));
        this.geometry.addAttribute('customColor', new THREE.BufferAttribute(colors, 3));
        this.geometry.addAttribute('size', new THREE.BufferAttribute(sizes, 1));

        this.points = new THREE.Points(this.geometry, this.material);
    }
}

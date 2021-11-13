let config = {
	urls: {
		globeTexture: '',
		pointTexture: ''
	},
	sizes: {
		globe: 200,
		globeDotSize: 2
	},
	scale: {
		points: 0.025,
		markers: 0.025,
		globeScale: 0.878
	},
	rotation: {
		globe: 0.001
	},
	colors: {
		globeDotColor: '#a17af8',
		globeMarkerColor: 'rgb(143, 216, 216)',
		globeMarkerGlow: 'rgb(255, 255, 255)',
		globeLines: 'rgb(255, 255, 255)',
		globeLinesDots: 'rgb(255, 255, 255)'
	},
	display: {
		points: true,
		map: true,
		lines: true,
		markers: true,
		markerLabel: true,
		markerPoint: true
	},
	dots: {
		total: 30
	}
};

let elements = {
	globe: null,
	atmosphere: null,
	globePoints: null,
	lineDots: [],
	markers: [],
	markerLabel: [],
	markerPoint: [],
	lines: []
};

let textures = {
	markerLabels: []
};

let groups = {
	map: null,
	main: null,
	globe: null,
	lines: null,
	points: null,
	markers: null,
	atmosphere: null,
	lineDots: null,
};

let countries = {
	interval: 20000,
	selected: null,
	index: 0
};

let animations = {
	rotateGlobe: true
};
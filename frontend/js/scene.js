import * as THREE from 'three';

let scene, camera, renderer, particles;
let mouseX = 0, mouseY = 0;
let windowHalfX = window.innerWidth / 2;
let windowHalfY = window.innerHeight / 2;
let animationId;
let paused = false;

export function initBackground() {
    const canvas = document.getElementById('bg-canvas');
    if (!canvas) return;

    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0a192f, 0.001);

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 1, 3000);
    camera.position.z = 1000;

    renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);

    const geometry = new THREE.BufferGeometry();
    const vertices = [];
    for ( let i = 0; i < 2000; i ++ ) {
        const x = 2000 * Math.random() - 1000;
        const y = 2000 * Math.random() - 1000;
        const z = 2000 * Math.random() - 1000;
        vertices.push( x, y, z );
    }
    geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( vertices, 3 ) );

    const material = new THREE.PointsMaterial( { size: 4, color: 0x24bfe8, transparent: true, opacity: 0.6, sizeAttenuation: true } );
    particles = new THREE.Points( geometry, material );
    scene.add( particles );

    document.addEventListener( 'pointermove', onPointerMove );
    window.addEventListener( 'resize', onWindowResize );
    document.addEventListener( 'visibilitychange', onVisibilityChange );

    animate();
}

function onWindowResize() {
    windowHalfX = window.innerWidth / 2;
    windowHalfY = window.innerHeight / 2;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize( window.innerWidth, window.innerHeight );
}

function onPointerMove( event ) {
    if ( event.isPrimary === false ) return;
    mouseX = event.clientX - windowHalfX;
    mouseY = event.clientY - windowHalfY;
}

function onVisibilityChange() {
    paused = document.hidden;
}

function animate() {
    animationId = requestAnimationFrame( animate );
    if (!paused) render();
}

function render() {
    camera.position.x += ( mouseX - camera.position.x ) * 0.05;
    camera.position.y += ( - mouseY - camera.position.y ) * 0.05;
    camera.lookAt( scene.position );

    const time = Date.now() * 0.00005;
    particles.rotation.y = time;
    particles.rotation.x = time * 0.5;

    renderer.render( scene, camera );
}

export function setInterviewMode(isInterview) {
    if (!particles) return;
    // Keep the star-field alive DURING the interview (it used to freeze, which
    // made the screen feel static). Only pause when the tab is hidden.
    paused = document.hidden;
    if (isInterview) {
        particles.material.color.setHex(0xf8b228);
    } else {
        particles.material.color.setHex(0x24bfe8);
    }
}

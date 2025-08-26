// --- Global App State ---
let appPaths = {};

// --- Global WebGL variables ---
let gl;
let programs = {};
let textures = {};
let fbos = {};
let originalImage = { width: 0, height: 0 };
let currentLutSize = 0;

// --- Resource Path Helper ---
function getResourcePath(relativePath) {
    let basePath;
    if (!appPaths.isDev) {
        // Packaged app path
        basePath = appPaths.resourcesPath;
    } else {
        // Development path
        basePath = appPaths.dirname;
    }
    // Use URL format for fetch
        // In development, it's relative to the project root.
    return `file://${appPaths.dirname}/${relativePath.replace(/\/g, '/')}`;
}

// --- Main Initialization ---
async function main() {
    // First, get the paths from the main process
    appPaths = await window.electron.invoke('get-paths');

    const canvas = document.getElementById('gl-canvas');
    gl = canvas.getContext('webgl', { preserveDrawingBuffer: true });

    if (!gl) {
        console.error("WebGL not supported!");
        return;
    }

    gl.getExtension('OES_texture_float');
    gl.getExtension('WEBGL_color_buffer_float');
    console.log("Supported WebGL Extensions:", gl.getSupportedExtensions());

    setupUI();
    await loadFilmProfiles();
    initWebGL();
}

document.addEventListener('DOMContentLoaded', main);


// --- UI Setup ---
function setupUI() {
    document.getElementById('load-btn').addEventListener('click', () => document.getElementById('file-input').click());
    document.getElementById('save-btn').addEventListener('click', saveImage);
    document.getElementById('batch-btn').addEventListener('click', () => document.getElementById('batch-input').click());
    document.getElementById('file-input').addEventListener('change', handleImageUpload);

    const controls = document.querySelectorAll('input, select');
    controls.forEach(control => {
        control.addEventListener('input', render);
        control.addEventListener('change', render);
    });
}

// --- Film Profile Loading ---
async function loadFilmProfiles() {
    try {
        const profilePath = getResourcePath('pic-styles.json');
        const response = await fetch(profilePath + '?_cacheBust=' + new Date().getTime());
        const profiles = await response.json();
        const profileSelector = document.getElementById('film-profile-selector');
        
        profileSelector.innerHTML = ''; // Clear existing
        profiles.forEach(profile => {
            const option = document.createElement('option');
            option.value = profile.id;
            option.textContent = profile.name;
            option.dataset.lut = profile.lut_3d;
            Object.keys(profile.engine_parameters).forEach(key => {
                option.dataset[key] = profile.engine_parameters[key];
            });
            profileSelector.appendChild(option);
        });
        
        profileSelector.addEventListener('change', applySelectedProfile);
        applySelectedProfile();
    } catch (error) {
        console.error('Error loading film profiles:', error);
    }
}

function applySelectedProfile() {
    const selector = document.getElementById('film-profile-selector');
    if(selector.options.length === 0) return;
    const selectedOption = selector.options[selector.selectedIndex];
    const params = selectedOption.dataset;

    document.getElementById('temperature-slider').value = params.temperature || 0;
    document.getElementById('tint-slider').value = params.tint || 0;
    document.getElementById('vibrance-slider').value = params.vibrance || 0;
    document.getElementById('grain-intensity-slider').value = params.grainIntensity || 0;
    document.getElementById('grain-size-slider').value = params.grainSize || 1.5;
    document.getElementById('grain-roughness-slider').value = params.grainRoughness || 0.5;
    document.getElementById('grain-mono-toggle').checked = params.grainMono === 'true';
    document.getElementById('halation-intensity-slider').value = params.halationIntensity || 0;
    document.getElementById('halation-radius-slider').value = params.halationRadius || 25;
    document.getElementById('halation-threshold-slider').value = params.halationThreshold || 0.9;
    document.getElementById('vignette-intensity-slider').value = params.vignetteIntensity || 0;

    if (params.lut) {
        const lutPath = getResourcePath(`cubes/${params.lut}`);
        loadLut(lutPath);
    } else {
        render();
    }
}

// --- WebGL Initialization ---
async function initWebGL() {
    const shaderSources = await loadAllShaders();
    
    programs.color = createProgram(shaderSources.vertex, shaderSources.color);
    programs.halation = createProgram(shaderSources.vertex, shaderSources.halation);
    programs.composite = createProgram(shaderSources.vertex, shaderSources.composite);

    const quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,0,0, 1,-1,1,0, -1,1,0,1, 1,1,1,1]), gl.STATIC_DRAW);

    setupVertexAttributes(programs.color);
    setupVertexAttributes(programs.halation);
    setupVertexAttributes(programs.composite);

    textures.image = createTexture();
    textures.lut = createTexture(); // Will be our 2D LUT texture

    console.log("WebGL initialized with 2D LUT emulation.");
    gl.clearColor(0.1, 0.1, 0.1, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);
}

function setupVertexAttributes(program) {
    gl.useProgram(program);
    const positionLocation = gl.getAttribLocation(program, 'a_position');
    const texCoordLocation = gl.getAttribLocation(program, 'a_texCoord');
    gl.enableVertexAttribArray(positionLocation);
    gl.enableVertexAttribArray(texCoordLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 16, 0);
    gl.vertexAttribPointer(texCoordLocation, 2, gl.FLOAT, false, 16, 8);
}

// --- Shader and Program Utilities ---
async function loadShader(url) {
    const response = await fetch(url);
    return response.text();
}

async function loadAllShaders() {
    const [vertex, color, halation, composite] = await Promise.all([
        loadShader(getResourcePath('shaders/vertex.glsl')),
        loadShader(getResourcePath('shaders/color.glsl')),
        loadShader(getResourcePath('shaders/halation.glsl')),
        loadShader(getResourcePath('shaders/composite.glsl'))
    ]);
    return { vertex, color, halation, composite };
}

function createShader(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('Error compiling shader:', gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }
    return shader;
}

function createProgram(vertexSource, fragmentSource) {
    const vertexShader = createShader(gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = createShader(gl.FRAGMENT_SHADER, fragmentSource);
    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error('Error linking program:', gl.getProgramInfoLog(program));
        gl.deleteProgram(program);
        return null;
    }
    return program;
}

// --- Texture and FBO Utilities ---
function createTexture(width = 1, height = 1, data = null, type = gl.UNSIGNED_BYTE) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, type, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
}

function createFBO(width, height) {
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    const texture = createTexture(width, height);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        console.error("Framebuffer is not complete");
    }
    return { framebuffer, texture };
}

function resizeFBOs(width, height) {
    if (fbos.color) gl.deleteFramebuffer(fbos.color.framebuffer), gl.deleteTexture(fbos.color.texture);
    if (fbos.halation) gl.deleteFramebuffer(fbos.halation.framebuffer), gl.deleteTexture(fbos.halation.texture);
    fbos.color = createFBO(width, height);
    fbos.halation = createFBO(width, height);
}

// --- Image and LUT Loading ---
function handleImageUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            originalImage = { width: img.width, height: img.height };
            gl.canvas.width = img.width;
            gl.canvas.height = img.height;
            gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
            
            // Flip the image's Y-axis to match WebGL's coordinate system
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
            gl.bindTexture(gl.TEXTURE_2D, textures.image);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
            // IMPORTANT: Reset the state to false so it doesn't affect other texture uploads (like LUTs)
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

            resizeFBOs(img.width, img.height);
            render();
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

async function loadLut(url) {
    try {
        const response = await fetch(url);
        const text = await response.text();
        const { data, size } = parseCube(text);
        currentLutSize = size;
        
        const { textureData, textureWidth, textureHeight } = convertLutTo2D(data, size);

        gl.bindTexture(gl.TEXTURE_2D, textures.lut);
        // Use RGBA UNSIGNED_BYTE textures for maximum compatibility
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, textureWidth, textureHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, textureData);
        
        render();
    } catch (error) {
        console.error("Failed to load or parse LUT:", error);
    }
}

function parseCube(text) {
    const lines = text.split('\n');
    let size = 0;
    const data = [];
    let readingData = false;

    for (const line of lines) {
        const trimmedLine = line.trim();
        if (trimmedLine.length === 0 || trimmedLine.startsWith('#') || trimmedLine.startsWith('TITLE') || trimmedLine.startsWith('DOMAIN')) {
            continue; // Skip comments, titles, and other metadata
        }

        if (trimmedLine.startsWith('LUT_3D_SIZE')) {
            size = parseInt(trimmedLine.split(' ')[1]);
            continue;
        }
        
        // If we have a size, we can start reading data points
        if (size > 0) {
            const parts = trimmedLine.split(/\s+/).filter(Boolean).map(parseFloat);
            if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
                data.push(...parts);
            }
        }
    }

    if (size === 0) {
        throw new Error("LUT_3D_SIZE not found in CUBE file");
    }
    if (data.length !== size * size * size * 3) {
        throw new Error(`LUT data size does not match header. Expected ${size*size*size*3} values, but found ${data.length}`);
    }
    
    return { data, size };
}

function convertLutTo2D(data, size) {
    const slicesPerRow = Math.floor(Math.sqrt(size));
    const numRows = Math.ceil(size / slicesPerRow);
    const textureWidth = size * slicesPerRow;
    const textureHeight = size * numRows;
    // Create RGBA data and convert floats to bytes
    const textureData = new Uint8Array(textureWidth * textureHeight * 4);

    for (let z = 0; z < size; z++) {
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const srcIndex = (z * size * size + y * size + x) * 3;
                
                const sliceX = Math.floor(z % slicesPerRow);
                const sliceY = Math.floor(z / slicesPerRow);

                const dstX = sliceX * size + x;
                const dstY = sliceY * size + y;
                const dstIndex = (dstY * textureWidth + dstX) * 4;

                textureData[dstIndex] = Math.round(data[srcIndex] * 255);
                textureData[dstIndex + 1] = Math.round(data[srcIndex + 1] * 255);
                textureData[dstIndex + 2] = Math.round(data[srcIndex + 2] * 255);
                textureData[dstIndex + 3] = 255; // Alpha channel
            }
        }
    }
    return { textureData, textureWidth, textureHeight };
}


// --- Rendering Pipeline ---
function render() {
    if (!originalImage.width || !programs.composite) return;

    // 1. Color Pass
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbos.color.framebuffer);
    gl.useProgram(programs.color);
    
    // Explicitly bind textures to specific units
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, textures.image);
    gl.uniform1i(gl.getUniformLocation(programs.color, 'u_image'), 0);
    
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, textures.lut); // Bind our 2D LUT
    gl.uniform1i(gl.getUniformLocation(programs.color, 'u_lut'), 1);

    setUniforms('color');
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // 2. Halation Pass
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbos.halation.framebuffer);
    gl.useProgram(programs.halation);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, fbos.color.texture);
    gl.uniform1i(gl.getUniformLocation(programs.halation, 'u_image'), 0);
    
    setUniforms('halation');
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // 3. Composite Pass (render to canvas)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(programs.composite);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, fbos.color.texture);
    gl.uniform1i(gl.getUniformLocation(programs.composite, 'u_color_pass'), 0);
    
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, fbos.halation.texture);
    gl.uniform1i(gl.getUniformLocation(programs.composite, 'u_halation_pass'), 1);
    
    setUniforms('composite');
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

function setUniforms(pass) {
    const p = programs[pass];
    const getVal = (id) => parseFloat(document.getElementById(id).value);
    const getChecked = (id) => document.getElementById(id).checked;

    const uniforms = {
        'u_resolution': [gl.canvas.width, gl.canvas.height],
        'u_time': performance.now() / 1000,
        'u_lut_size': currentLutSize,
        'u_temperature': (getVal('temperature-slider')/100)*0.5, 'u_tint': (getVal('tint-slider')/100)*0.5,
        'u_vibrance': getVal('vibrance-slider')/100, 'u_grain_intensity': getVal('grain-intensity-slider')/100,
        'u_grain_size': getVal('grain-size-slider'), 'u_grain_mono': getChecked('grain-mono-toggle'),
        'u_halation_intensity': getVal('halation-intensity-slider'), 'u_halation_radius': getVal('halation-radius-slider'),
        'u_halation_threshold': getVal('halation-threshold-slider'), 'u_vignette_intensity': getVal('vignette-intensity-slider'),
    };

    for (const [name, value] of Object.entries(uniforms)) {
        const location = gl.getUniformLocation(p, name);
        if (location) {
            if (Array.isArray(value)) gl.uniform2fv(location, value);
            else if (typeof value === 'boolean') gl.uniform1i(location, value);
            else gl.uniform1f(location, value);
        }
    }
}

// --- File Operations ---
function saveImage() {
    window.electron.invoke('save-image', gl.canvas.toDataURL('image/png'));
}
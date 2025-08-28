// --- Global App State ---
let appPaths = {};

// --- Debug Logging Helper ---
const debugLog = (...args) => {
    if (appPaths.isDev) {
        console.log(...args);
    }
};

// --- Global WebGL variables ---
let gl;
let programs = {};
let textures = {};
let fbos = {};
let originalImage = { width: 0, height: 0 };
let currentLutSize = 0;

// --- Zoom and Pan State ---
let zoomLevel = 1.0;
let panOffset = { x: 0.0, y: 0.0 };
let isDragging = false;
let lastMousePos = { x: 0, y: 0 };
let renderRequested = false;

// --- Resource Path Helper ---
function getResourcePath(relativePath) {
    const basePath = appPaths.isDev ? appPaths.dirname : appPaths.resourcesPath;
    const cleanPath = relativePath.replace(/\\/g, '/'); // 統一路徑分隔符號
    return `file://${basePath}/${cleanPath}`;
}

// --- Main Initialization ---
async function main() {
    appPaths = await window.electron.getPaths();

    const canvas = document.getElementById('gl-canvas');
    gl = canvas.getContext('webgl', { preserveDrawingBuffer: true });

    if (!gl) {
        console.error("WebGL not supported!");
        return;
    }

    gl.getExtension('OES_texture_float');
    gl.getExtension('WEBGL_color_buffer_float');
    debugLog("支援的 WebGL 擴展:", gl.getSupportedExtensions());

    setupUI();
    // Initialize WebGL resources (shaders, programs, textures, FBOs) first
    await initWebGL();
    // Then load film profiles which may call loadLut() and depend on textures being ready
    await loadFilmProfiles();
}

document.addEventListener('DOMContentLoaded', main);

// --- UI Setup ---
function setupUI() {
    document.getElementById('load-btn').addEventListener('click', () => document.getElementById('file-input').click());
    document.getElementById('save-btn').addEventListener('click', saveImage);
    document.getElementById('batch-btn').addEventListener('click', () => document.getElementById('batch-input').click());
    document.getElementById('file-input').addEventListener('change', handleImageUpload);
    document.getElementById('batch-input').addEventListener('change', handleBatchProcess);

    const controls = document.querySelectorAll('input, select');
    controls.forEach(control => {
        control.addEventListener('input', requestRender);
        control.addEventListener('change', requestRender);
    });

    // Setup zoom and pan controls
    setupZoomPanControls();
}

// --- Zoom and Pan Controls ---
function setupZoomPanControls() {
    const canvas = document.getElementById('gl-canvas');
    
    // Mouse wheel for zoom
    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        
        const zoomFactor = 1.1;
        const rect = canvas.getBoundingClientRect();
        const mouseX = (e.clientX - rect.left) / rect.width;
        const mouseY = (e.clientY - rect.top) / rect.height;
        
        if (e.deltaY < 0) {
            // Zoom in
            const oldZoom = zoomLevel;
            zoomLevel *= zoomFactor;
            zoomLevel = Math.min(zoomLevel, 10.0); // Max zoom
            
            // Adjust pan to zoom toward mouse position
            const zoomChange = zoomLevel / oldZoom;
            panOffset.x += (mouseX - 0.5) * (1.0 - 1.0 / zoomChange) / zoomLevel;
            panOffset.y += (mouseY - 0.5) * (1.0 - 1.0 / zoomChange) / zoomLevel;
        } else {
            // Zoom out
            const oldZoom = zoomLevel;
            zoomLevel /= zoomFactor;
            zoomLevel = Math.max(zoomLevel, 0.1); // Min zoom
            
            // Adjust pan to zoom toward mouse position
            const zoomChange = zoomLevel / oldZoom;
            panOffset.x += (mouseX - 0.5) * (1.0 - 1.0 / zoomChange) / zoomLevel;
            panOffset.y += (mouseY - 0.5) * (1.0 - 1.0 / zoomChange) / zoomLevel;
        }
        
        // Apply pan limits after zoom
        const maxPan = (zoomLevel - 1.0) / (2.0 * zoomLevel);
        panOffset.x = Math.max(-maxPan, Math.min(maxPan, panOffset.x));
        panOffset.y = Math.max(-maxPan, Math.min(maxPan, panOffset.y));
        
        requestRender();
    });
    
    // Mouse drag for pan
    canvas.addEventListener('mousedown', (e) => {
        if (e.button === 0) { // Left mouse button
            isDragging = true;
            lastMousePos = { x: e.clientX, y: e.clientY };
            canvas.style.cursor = 'grabbing';
        }
    });
    
    canvas.addEventListener('mousemove', (e) => {
        if (isDragging) {
            const deltaX = e.clientX - lastMousePos.x;
            const deltaY = e.clientY - lastMousePos.y;
            
            // Convert pixel movement to texture coordinate movement
            const rect = canvas.getBoundingClientRect();
            const newPanX = panOffset.x - (deltaX / rect.width) / zoomLevel;
            const newPanY = panOffset.y + (deltaY / rect.height) / zoomLevel; // Invert Y axis
            
            // Calculate maximum pan limits based on zoom level
            const maxPan = (zoomLevel - 1.0) / (2.0 * zoomLevel);
            
            // Clamp pan offset to prevent showing too much empty space
            panOffset.x = Math.max(-maxPan, Math.min(maxPan, newPanX));
            panOffset.y = Math.max(-maxPan, Math.min(maxPan, newPanY));
            
            lastMousePos = { x: e.clientX, y: e.clientY };
            requestRender(); // Use throttled rendering
        }
    });
    
    canvas.addEventListener('mouseup', (e) => {
        if (e.button === 0) {
            isDragging = false;
            canvas.style.cursor = 'grab';
        }
    });
    
    canvas.addEventListener('mouseleave', () => {
        isDragging = false;
        canvas.style.cursor = 'default';
    });
    
    // Set initial cursor
    canvas.style.cursor = 'grab';
    
    // Double-click to reset zoom and pan
    canvas.addEventListener('dblclick', () => {
        zoomLevel = 1.0;
        panOffset = { x: 0.0, y: 0.0 };
        requestRender();
    });
}

// --- Film Profile Loading ---
async function loadFilmProfiles() {
    try {
        let profiles;
        if (!appPaths.isDev) {
            // In packaged mode, use read-extra-resource
            const profileContent = await window.electron.readExtraResource('pic-styles.json');
            profiles = JSON.parse(profileContent);
        } else {
            // In dev mode, use fetch as before
            const profilePath = getResourcePath('pic-styles.json');
            const response = await fetch(profilePath + '?_cacheBust=' + new Date().getTime());
            profiles = await response.json();
        }
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
        console.error('載入底片風格時發生錯誤:', error);
    }
}

function applySelectedProfile() {
    const selector = document.getElementById('film-profile-selector');
    if (selector.options.length === 0) return;

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
        requestRender();
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
    textures.lut = createTexture();
    // Ensure LUT texture has a safe default 1x1 white pixel to act as a neutral/pass-through LUT
    gl.bindTexture(gl.TEXTURE_2D, textures.lut);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255,255,255,255]));
    gl.bindTexture(gl.TEXTURE_2D, null);

    debugLog("WebGL 已初始化，使用 2D LUT 模擬");
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
    // When packaged, fetch won't work for files inside app.asar. Use the main process to read resources.
    if (!appPaths.isDev) {
        // url comes in form file://{base}/{path}
        const fileUrlPrefix = 'file://';
        let absolute = url;
        if (absolute.startsWith(fileUrlPrefix)) absolute = absolute.slice(fileUrlPrefix.length);
        // Normalize slashes
        absolute = absolute.replace(/\\/g, '/');
        const resources = (appPaths.resourcesPath || '').replace(/\\/g, '/');
        let relative;
        // If absolute path starts with the resources path, strip that prefix
        if (resources && absolute.toLowerCase().startsWith(resources.toLowerCase())) {
            relative = absolute.slice(resources.length);
            relative = relative.replace(/^\/+/, '');
        } else {
            // Fallback: if path contains app.asar, strip up to and including app.asar/
            const idx = absolute.toLowerCase().indexOf('app.asar/');
            if (idx !== -1) {
                relative = absolute.slice(idx + 'app.asar/'.length);
            } else {
                // As a last resort, remove leading drive letter or slash
                relative = absolute.replace(/^([A-Za-z]:)?\//, '');
            }
        }
        return await window.electron.invoke('read-resource', relative);
    } else {
        const response = await fetch(url);
        return response.text();
    }
}

async function loadAllShaders() {
    const shaderPaths = [
        'shaders/vertex.glsl',
        'shaders/color.glsl',
        'shaders/halation.glsl',
        'shaders/composite.glsl'
    ];

    // When packaged, read shader sources from extraResources using read-extra-resource.
    if (!appPaths.isDev) {
        const loaders = shaderPaths.map(p => window.electron.readExtraResource(p));
        const [vertex, color, halation, composite] = await Promise.all(loaders);
        return { vertex, color, halation, composite };
    }

    // In dev mode, fetch via file:// URLs as before.
    const loaders = shaderPaths.map(p => loadShader(getResourcePath(p)));
    const [vertex, color, halation, composite] = await Promise.all(loaders);
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
    // Ensure a texture is bound before calling texImage2D
    if (!gl.getParameter(gl.TEXTURE_BINDING_2D)) {
        console.error('createTexture: failed to bind texture');
    }
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
    if (fbos.color) {
        gl.deleteFramebuffer(fbos.color.framebuffer);
        gl.deleteTexture(fbos.color.texture);
    }
    if (fbos.halation) {
        gl.deleteFramebuffer(fbos.halation.framebuffer);
        gl.deleteTexture(fbos.halation.texture);
    }
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

            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
            gl.bindTexture(gl.TEXTURE_2D, textures.image);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

            resizeFBOs(img.width, img.height);
            requestRender();
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

async function loadLut(url) {
    try {
        let text;
        if (!appPaths.isDev) {
            // In packaged mode, extract relative path and use read-extra-resource
            const relativePath = url.replace(/^file:\/\/.*?\//, '').replace(/\\/g, '/');
            text = await window.electron.readExtraResource(relativePath);
        } else {
            // In dev mode, use fetch as before
            const response = await fetch(url);
            text = await response.text();
        }
        const { data, size } = parseCube(text);
        currentLutSize = size;

        const { textureData, textureWidth, textureHeight } = convertLutTo2D(data, size);

        // Defensive bind: make sure the LUT texture is bound before uploading texImage2D
        if (!textures.lut) textures.lut = createTexture();
        gl.bindTexture(gl.TEXTURE_2D, textures.lut);
        if (!gl.getParameter(gl.TEXTURE_BINDING_2D)) {
            console.error('loadLut: failed to bind LUT texture');
        }
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, textureWidth, textureHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, textureData);

        requestRender();
    } catch (error) {
        console.error("載入或解析 LUT 時發生錯誤:", error);
    }
}

function parseCube(text) {
    const lines = text.split('\n');
    let size = 0;
    const data = [];

    for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine || trimmedLine.startsWith('#') || trimmedLine.startsWith('TITLE') || trimmedLine.startsWith('DOMAIN')) {
            continue;
        }

        if (trimmedLine.startsWith('LUT_3D_SIZE')) {
            size = parseInt(trimmedLine.split(' ')[1]);
            continue;
        }

        if (size > 0) {
            const parts = trimmedLine.split(/\s+/).filter(Boolean).map(parseFloat);
            if (parts.length === 3 && parts.every(v => !isNaN(v))) {
                data.push(...parts);
            }
        }
    }

    if (size === 0) {
        throw new Error("CUBE 檔案中找不到 LUT_3D_SIZE");
    }
    if (data.length !== size * size * size * 3) {
        throw new Error(`LUT 資料大小不符. 預期 ${size*size*size*3}, 實際 ${data.length}`);
    }

    return { data, size };
}

function convertLutTo2D(data, size) {
    const slicesPerRow = Math.floor(Math.sqrt(size));
    const numRows = Math.ceil(size / slicesPerRow);
    const textureWidth = size * slicesPerRow;
    const textureHeight = size * numRows;

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
                textureData[dstIndex + 3] = 255;
            }
        }
    }
    return { textureData, textureWidth, textureHeight };
}

// --- Optimized Rendering with RequestAnimationFrame ---
function requestRender() {
    if (!renderRequested) {
        renderRequested = true;
        requestAnimationFrame(() => {
            render();
            renderRequested = false;
        });
    }
}

// --- Rendering Pipeline ---
function render(forSave = false) {
    if (!originalImage.width || !programs.composite) return;

    // Color Pass
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbos.color.framebuffer);
    gl.useProgram(programs.color);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, textures.image);
    gl.uniform1i(gl.getUniformLocation(programs.color, 'u_image'), 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, textures.lut);
    gl.uniform1i(gl.getUniformLocation(programs.color, 'u_lut'), 1);

    setUniforms('color', forSave);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Halation Pass
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbos.halation.framebuffer);
    gl.useProgram(programs.halation);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, fbos.color.texture);
    gl.uniform1i(gl.getUniformLocation(programs.halation, 'u_image'), 0);

    setUniforms('halation', forSave);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Composite Pass
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(programs.composite);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, fbos.color.texture);
    gl.uniform1i(gl.getUniformLocation(programs.composite, 'u_color_pass'), 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, fbos.halation.texture);
    gl.uniform1i(gl.getUniformLocation(programs.composite, 'u_halation_pass'), 1);

    setUniforms('composite', forSave);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

function setUniforms(pass, forSave = false) {
    const p = programs[pass];
    const getVal = (id) => parseFloat(document.getElementById(id).value);
    const getChecked = (id) => document.getElementById(id).checked;

    // For saving, reset zoom and pan to original view
    const currentZoom = forSave ? 1.0 : zoomLevel;
    const currentPanX = forSave ? 0.0 : panOffset.x;
    const currentPanY = forSave ? 0.0 : panOffset.y;

    const uniforms = {
        'u_resolution': [gl.canvas.width, gl.canvas.height],
        'u_time': performance.now() / 1000,
        'u_lut_size': Math.max(1, currentLutSize),
        'u_zoom_pan': [currentZoom, 0.0],
        'u_pan_offset': [currentPanX, currentPanY],
        'u_temperature': (getVal('temperature-slider')/100)*0.5,
        'u_tint': (getVal('tint-slider')/100)*0.5,
        'u_vibrance': getVal('vibrance-slider')/100,
        'u_grain_intensity': getVal('grain-intensity-slider')/100,
        'u_grain_size': getVal('grain-size-slider'),
        'u_grain_roughness': getVal('grain-roughness-slider'),
        'u_grain_mono': getChecked('grain-mono-toggle'),
        'u_halation_intensity': getVal('halation-intensity-slider'),
        'u_halation_radius': getVal('halation-radius-slider'),
        'u_halation_threshold': getVal('halation-threshold-slider'),
        'u_vignette_intensity': getVal('vignette-intensity-slider'),
    };

    for (const [name, value] of Object.entries(uniforms)) {
        const location = gl.getUniformLocation(p, name);
        if (location !== null) {
            if (Array.isArray(value)) gl.uniform2fv(location, value);
            else if (typeof value === 'boolean') gl.uniform1i(location, value);
            else gl.uniform1f(location, value);
        }
    }
}

// --- Batch Processing ---
async function handleBatchProcess(event) {
    const files = Array.from(event.target.files);
    if (files.length === 0) return;
    
    debugLog(`開始批次處理 ${files.length} 個檔案...`);
    
    const originalCanvas = { width: gl.canvas.width, height: gl.canvas.height };
    
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        debugLog(`處理檔案 ${i + 1}/${files.length}: ${file.name}`);
        
        try {
            // Load image
            const imageData = await loadFileAsImage(file);
            
            // Process image off-screen
            await processImageOffscreen(imageData);
            
            // Save processed image
            const fileName = file.name.replace(/\.[^/.]+$/, '_底片.png');
            const dataURL = gl.canvas.toDataURL('image/png');
            await window.electron.saveImage(dataURL);
            
            debugLog(`完成: ${fileName}`);
        } catch (error) {
            console.error(`處理 ${file.name} 時發生錯誤:`, error);
        }
    }
    
    // Restore original canvas size
    gl.canvas.width = originalCanvas.width;
    gl.canvas.height = originalCanvas.height;
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    
    debugLog('批次處理完成！');
    event.target.value = ''; // Reset file input
}

function loadFileAsImage(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

async function processImageOffscreen(img) {
    // Update canvas size and viewport
    originalImage = { width: img.width, height: img.height };
    gl.canvas.width = img.width;
    gl.canvas.height = img.height;
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

    // Upload image to GPU
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.bindTexture(gl.TEXTURE_2D, textures.image);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

    // Resize FBOs for new image size
    resizeFBOs(img.width, img.height);
    
    // Render with current settings
    render(); // Keep direct render for batch processing to ensure completion
}

// --- File Operations ---
function saveImage() {
    // Render once with original view (no zoom/pan) for saving
    render(true);
    window.electron.saveImage(gl.canvas.toDataURL('image/png'));
    // Render again with current view for display
    requestRender();
}


// --- IPC Communication ---
// Note: The save-image invoke already handles the save dialog and returns the result
// No need for separate event listener since it's handled via invoke/response pattern
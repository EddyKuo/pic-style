precision mediump float;

varying vec2 v_texCoord;

uniform sampler2D u_color_pass; // Result from the color shader
uniform sampler2D u_halation_pass; // Result from the halation shader

// Grain parameters (will be calculated in this shader)
uniform float u_time;
uniform float u_grain_intensity;
uniform float u_grain_size;
uniform float u_grain_roughness;
uniform bool u_grain_mono;

// Vignette parameters
uniform float u_vignette_intensity;

// A simple pseudo-random number generator
float random(vec2 co) {
    return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
    vec3 color = texture2D(u_color_pass, v_texCoord).rgb;
    vec3 halation = texture2D(u_halation_pass, v_texCoord).rgb;

    // --- Grain Calculation ---
    vec2 grain_uv = v_texCoord * u_grain_size;
    float base_noise = random(grain_uv + fract(u_time));
    
    // Apply roughness - higher values create more irregular, chunky grain
    float roughened_noise = pow(base_noise, mix(1.0, 3.0, u_grain_roughness));
    
    vec3 grain;
    if (u_grain_mono) {
        grain = vec3(roughened_noise);
    } else {
        grain = vec3(
            pow(random(grain_uv + vec2(fract(u_time), -fract(u_time))), mix(1.0, 3.0, u_grain_roughness)),
            pow(random(grain_uv + vec2(-fract(u_time), fract(u_time))), mix(1.0, 3.0, u_grain_roughness)),
            pow(random(grain_uv + vec2(fract(u_time), fract(u_time))), mix(1.0, 3.0, u_grain_roughness))
        );
    }
    // Apply grain using an overlay blend
    vec3 color_with_grain = mix(
        2.0 * color * grain,
        1.0 - 2.0 * (1.0 - color) * (1.0 - grain),
        step(0.5, color)
    );
    color = mix(color, color_with_grain, u_grain_intensity);

    // --- Halation ---
    // Apply halation using a screen blend
    color = 1.0 - (1.0 - color) * (1.0 - halation);

    // --- Vignette ---
    float dist = distance(v_texCoord, vec2(0.5));
    float vignette = smoothstep(0.8, 0.2, dist);
    color *= mix(1.0, vignette, u_vignette_intensity);

    gl_FragColor = vec4(color, 1.0);
}

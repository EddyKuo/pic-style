precision highp float;

varying vec2 v_texCoord;

uniform sampler2D u_image; // The color-corrected image
uniform float u_time;

uniform float u_grain_intensity;
uniform float u_grain_size;
uniform float u_grain_roughness;
uniform bool u_grain_mono;

// A simple pseudo-random number generator
float random(vec2 co) {
    return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
    vec4 color = texture2D(u_image, v_texCoord);
    
    vec2 grain_uv = v_texCoord * u_grain_size;
    float noise = random(grain_uv + u_time) * u_grain_roughness;
    
    vec3 grain;
    if (u_grain_mono) {
        grain = vec3(noise);
    } else {
        grain = vec3(
            random(grain_uv + vec2(u_time, -u_time)),
            random(grain_uv + vec2(-u_time, u_time)),
            random(grain_uv + vec2(u_time, u_time))
        );
    }

    // Using an overlay blend mode for the grain
    vec3 result = mix(
        2.0 * color.rgb * grain,
        1.0 - 2.0 * (1.0 - color.rgb) * (1.0 - grain),
        step(0.5, color.rgb)
    );

    gl_FragColor = vec4(mix(color.rgb, result, u_grain_intensity), 1.0);
}

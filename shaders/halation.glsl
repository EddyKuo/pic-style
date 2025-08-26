precision mediump float;

varying vec2 v_texCoord;

uniform sampler2D u_image;
uniform float u_halation_threshold;
uniform float u_halation_radius;
uniform float u_halation_intensity;
uniform vec2 u_resolution;

vec4 extract_bright(sampler2D tex, vec2 uv, float threshold) {
    vec4 color = texture2D(tex, uv);
    float brightness = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
    return color * smoothstep(threshold, threshold + 0.1, brightness);
}

void main() {
    vec2 texel_size = 1.0 / u_resolution;
    vec4 blurred_brights = vec4(0.0);
    float total_weight = 0.0;

    for (float x = -4.0; x <= 4.0; x++) {
        for (float y = -4.0; y <= 4.0; y++) {
            vec2 offset = vec2(x, y) * texel_size * u_halation_radius;
            float weight = exp(-(x*x + y*y) / 8.0);
            blurred_brights += extract_bright(u_image, v_texCoord + offset, u_halation_threshold) * weight;
            total_weight += weight;
        }
    }

    blurred_brights /= total_weight;
    
    // Tint the blurred brights red
    blurred_brights.r *= 1.2;
    blurred_brights.gb *= 0.8;

    gl_FragColor = vec4(blurred_brights.rgb * u_halation_intensity, 1.0);
}

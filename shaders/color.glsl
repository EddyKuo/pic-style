precision mediump float;

varying vec2 v_texCoord;

uniform sampler2D u_image;
uniform sampler2D u_lut;
uniform float u_lut_size;

uniform float u_temperature;
uniform float u_tint;
uniform float u_vibrance;

vec3 applyLut(vec3 color) {
    float slicesPerRow = floor(sqrt(u_lut_size));
    float numRows = ceil(u_lut_size / slicesPerRow);

    float slice_z = color.b * (u_lut_size - 1.0);
    float slice_z_floor = floor(slice_z);
    float slice_z_ceil = min(u_lut_size - 1.0, slice_z_floor + 1.0);
    float slice_z_mix = fract(slice_z);

    vec2 slice_offset_floor;
    slice_offset_floor.x = mod(slice_z_floor, slicesPerRow) / slicesPerRow;
    slice_offset_floor.y = floor(slice_z_floor / slicesPerRow) / numRows;

    vec2 slice_offset_ceil;
    slice_offset_ceil.x = mod(slice_z_ceil, slicesPerRow) / slicesPerRow;
    slice_offset_ceil.y = floor(slice_z_ceil / slicesPerRow) / numRows;

    vec2 uv_in_slice = color.rg * vec2(1.0 / slicesPerRow, 1.0 / numRows);

    vec2 uv_floor = slice_offset_floor + uv_in_slice;
    vec2 uv_ceil = slice_offset_ceil + uv_in_slice;

    vec3 sample_floor = texture2D(u_lut, uv_floor).rgb;
    vec3 sample_ceil = texture2D(u_lut, uv_ceil).rgb;

    return mix(sample_floor, sample_ceil, slice_z_mix);
}

vec3 adjustTemperature(vec3 color) {
    vec3 temp_color = color;
    temp_color.r += u_temperature * 0.1;
    temp_color.b -= u_temperature * 0.1;
    return clamp(temp_color, 0.0, 1.0);
}

vec3 adjustTint(vec3 color) {
    vec3 tint_color = color;
    tint_color.g += u_tint * 0.1;
    return clamp(tint_color, 0.0, 1.0);
}

vec3 adjustVibrance(vec3 color) {
    float avg = (color.r + color.g + color.b) / 3.0;
    float max_color = max(max(color.r, color.g), color.b);
    float mix_rate = abs(max_color - avg) * 2.0;
    vec3 sat_color = mix(vec3(avg), color, 1.0 + u_vibrance);
    return mix(color, sat_color, mix_rate);
}

void main() {
    // Check if texture coordinate is within bounds
    if (v_texCoord.x < 0.0 || v_texCoord.x > 1.0 || v_texCoord.y < 0.0 || v_texCoord.y > 1.0) {
        // Outside bounds - render transparent or black
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
    }
    
    vec3 color = texture2D(u_image, v_texCoord).rgb;

    color = adjustTemperature(color);
    color = adjustTint(color);
    color = adjustVibrance(color);

    // Apply LUT if a real 3D LUT is loaded (size > 1). If not, skip LUT sampling to avoid NaNs.
    if (u_lut_size > 1.0) {
        color = applyLut(color);
    }

    gl_FragColor = vec4(color, 1.0);
}
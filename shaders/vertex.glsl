attribute vec4 a_position;
attribute vec2 a_texCoord;

uniform vec2 u_zoom_pan; // x = zoom, y unused
uniform vec2 u_pan_offset; // x, y pan offset

varying vec2 v_texCoord;

void main() {
    gl_Position = a_position;
    
    // Apply zoom and pan transformations to texture coordinates
    vec2 centered = a_texCoord - 0.5; // Center around origin
    centered *= (1.0 / u_zoom_pan.x); // Apply zoom (smaller value = more zoom)
    centered += u_pan_offset; // Apply pan offset
    centered += 0.5; // Move back to 0-1 range
    
    v_texCoord = centered;
}

attribute vec4 a_position;
attribute vec2 a_texCoord;

varying vec2 v_texCoord;

void main() {
    gl_Position = a_position;
    // Flip the Y-coordinate of the texture
    v_texCoord = vec2(a_texCoord.x, 1.0 - a_texCoord.y);
}

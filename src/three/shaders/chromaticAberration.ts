export const ChromaticAberrationShader = {
  uniforms: {
    tDiffuse: { value: null as unknown },
    amount: { value: 0.004 },
  },

  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,

  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float amount;
    varying vec2 vUv;

    void main() {
      // Radial offset — stronger at edges, zero at center
      vec2 dir = vUv - vec2(0.5);
      float dist = length(dir);
      vec2 offset = normalize(dir) * dist * dist * amount;

      float r = texture2D(tDiffuse, vUv + offset * 1.6).r;
      float g = texture2D(tDiffuse, vUv).g;
      float b = texture2D(tDiffuse, vUv - offset * 1.6).b;

      gl_FragColor = vec4(r, g, b, 1.0);
    }
  `,
};

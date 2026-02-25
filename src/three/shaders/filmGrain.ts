export const FilmGrainShader = {
  uniforms: {
    tDiffuse: { value: null as unknown },
    time: { value: 0.0 },
    intensity: { value: 0.12 },
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
    uniform float time;
    uniform float intensity;
    varying vec2 vUv;

    float rand(vec2 co) {
      return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec4 color = texture2D(tDiffuse, vUv);

      // Film grain — ticks every frame via time
      float grain = rand(vUv + fract(time * 0.1)) - 0.5;
      color.rgb += grain * intensity;

      // Subtle vignette
      vec2 uv = vUv * (1.0 - vUv.yx);
      float vig = uv.x * uv.y * 18.0;
      vig = clamp(pow(vig, 0.3), 0.0, 1.0);
      color.rgb *= mix(0.5, 1.0, vig);

      gl_FragColor = color;
    }
  `,
};

/**
 * 🌊 FLUID RENDERER
 * "The Living Canvas"
 * 
 * A minimalistic WebGL implementation of stable fluids (Navier-Stokes).
 * Reacts to mouse input and agent emotional state.
 */

import { EmotionalState } from '../EmotionalCore';

export interface FluidConfig {
    SIM_RESOLUTION: number;
    DYE_RESOLUTION: number;
    DENSITY_DISSIPATION: number;
    VELOCITY_DISSIPATION: number;
    PRESSURE_DISSIPATION: number;
    PRESSURE_ITERATIONS: number;
    CURL: number;
    SPLAT_RADIUS: number;
    SPLAT_FORCE: number;
    SHADING: boolean;
    COLORFUL: boolean;
    PAUSED: boolean;
    BACK_COLOR: { r: number, g: number, b: number };
    TRANSPARENT: boolean;
}

export const DEFAULT_FLUID_CONFIG: FluidConfig = {
    SIM_RESOLUTION: 128,
    DYE_RESOLUTION: 512,
    DENSITY_DISSIPATION: 0.98,
    VELOCITY_DISSIPATION: 0.99,
    PRESSURE_DISSIPATION: 0.8,
    PRESSURE_ITERATIONS: 20,
    CURL: 30,
    SPLAT_RADIUS: 0.4,
    SPLAT_FORCE: 6000,
    SHADING: true,
    COLORFUL: true,
    PAUSED: false,
    BACK_COLOR: { r: 0, g: 0, b: 0 },
    TRANSPARENT: false
};

// --- SHADERS ---

const baseVertexShader = `#version 300 es
in vec2 aPosition;
out vec2 vUv;
out vec2 vL;
out vec2 vR;
out vec2 vT;
out vec2 vB;
uniform vec2 texelSize;

void main () {
    vUv = aPosition * 0.5 + 0.5;
    vL = vUv - vec2(texelSize.x, 0.0);
    vR = vUv + vec2(texelSize.x, 0.0);
    vT = vUv + vec2(0.0, texelSize.y);
    vB = vUv - vec2(0.0, texelSize.y);
    gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const clearShader = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUv;
uniform sampler2D uTexture;
uniform float value;
out vec4 fragColor;
void main () {
    fragColor = value * texture(uTexture, vUv);
}
`;

const splatShader = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUv;
uniform sampler2D uTarget;
uniform float aspectRatio;
uniform vec3 color;
uniform vec2 point;
uniform float radius;
out vec4 fragColor;
void main () {
    vec2 p = vUv - point.xy;
    p.x *= aspectRatio;
    vec3 splat = exp(-dot(p, p) / radius) * color;
    vec3 base = texture(uTarget, vUv).xyz;
    fragColor = vec4(base + splat, 1.0);
}
`;

const advectionShader = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUv;
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform vec2 texelSize;
uniform float dt;
uniform float dissipation;
out vec4 fragColor;
void main () {
    vec2 coord = vUv - dt * texture(uVelocity, vUv).xy * texelSize;
    vec4 result = texture(uSource, coord);
    fragColor = result * dissipation;
}
`;

const divergenceShader = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUv;
in vec2 vL;
in vec2 vR;
in vec2 vT;
in vec2 vB;
uniform sampler2D uVelocity;
out vec4 fragColor;
void main () {
    float L = texture(uVelocity, vL).x;
    float R = texture(uVelocity, vR).x;
    float T = texture(uVelocity, vT).y;
    float B = texture(uVelocity, vB).y;
    float div = 0.5 * (R - L + T - B);
    fragColor = vec4(div, 0.0, 0.0, 1.0);
}
`;

const curlShader = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUv;
in vec2 vL;
in vec2 vR;
in vec2 vT;
in vec2 vB;
uniform sampler2D uVelocity;
out vec4 fragColor;
void main () {
    float L = texture(uVelocity, vL).y;
    float R = texture(uVelocity, vR).y;
    float T = texture(uVelocity, vT).x;
    float B = texture(uVelocity, vB).x;
    float vorticity = R - L - T + B;
    fragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
}
`;

const vorticityShader = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUv;
in vec2 vL;
in vec2 vR;
in vec2 vT;
in vec2 vB;
uniform sampler2D uVelocity;
uniform sampler2D uCurl;
uniform float curl;
uniform float dt;
out vec4 fragColor;
void main () {
    float L = texture(uCurl, vL).x;
    float R = texture(uCurl, vR).x;
    float T = texture(uCurl, vT).x;
    float B = texture(uCurl, vB).x;
    float C = texture(uCurl, vUv).x;
    vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
    force /= length(force) + 0.0001;
    force *= curl * C;
    force.y *= -1.0;
    vec2 pos = texture(uVelocity, vUv).xy;
    fragColor = vec4(pos + force * dt, 0.0, 1.0);
}
`;

const pressureShader = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUv;
in vec2 vL;
in vec2 vR;
in vec2 vT;
in vec2 vB;
uniform sampler2D uPressure;
uniform sampler2D uDivergence;
out vec4 fragColor;
void main () {
    float L = texture(uPressure, vL).x;
    float R = texture(uPressure, vR).x;
    float T = texture(uPressure, vT).x;
    float B = texture(uPressure, vB).x;
    float div = texture(uDivergence, vUv).x;
    float pressure = (L + R + T + B - div) * 0.25;
    fragColor = vec4(pressure, 0.0, 0.0, 1.0);
}
`;

const gradientSubtractShader = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUv;
in vec2 vL;
in vec2 vR;
in vec2 vT;
in vec2 vB;
uniform sampler2D uPressure;
uniform sampler2D uVelocity;
out vec4 fragColor;
void main () {
    float L = texture(uPressure, vL).x;
    float R = texture(uPressure, vR).x;
    float T = texture(uPressure, vT).x;
    float B = texture(uPressure, vB).x;
    vec2 velocity = texture(uVelocity, vUv).xy;
    velocity.xy -= vec2(R - L, T - B);
    fragColor = vec4(velocity, 0.0, 1.0);
}
`;

const displayShader = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUv;
uniform sampler2D uTexture; // Density
out vec4 fragColor;
void main () {
    vec3 c = texture(uTexture, vUv).rgb;
    // Tone mapping
    c = c / (c + vec3(1.0));
    fragColor = vec4(c, 1.0);
}
`;

interface RenderTarget {
    texture: WebGLTexture | null;
    fbo: WebGLFramebuffer | null;
    attach: (id: number) => number;
}

interface DoubleRenderTarget {
    read: RenderTarget;
    write: RenderTarget;
    swap: () => void;
}

interface ProgramBundle {
    program: WebGLProgram;
    uniforms: Record<string, WebGLUniformLocation | null>;
    bind: () => void;
}

type FluidProgramName =
    | 'splat'
    | 'curl'
    | 'vorticity'
    | 'divergence'
    | 'clear'
    | 'pressure'
    | 'gradientSubtract'
    | 'advection'
    | 'display';

interface FluidTextures {
    velocity: DoubleRenderTarget;
    density: DoubleRenderTarget;
    divergence: RenderTarget;
    curl: RenderTarget;
    pressure: DoubleRenderTarget;
}

export class FluidRenderer {
    private canvas: HTMLCanvasElement;
    private gl: WebGL2RenderingContext;
    public config: FluidConfig;

    private programs = {} as Record<FluidProgramName, ProgramBundle>;
    private textures = {} as FluidTextures;
    private quadBuffer: WebGLBuffer | null = null;

    // State
    private lastUpdateTime: number = 0;
    private lastEmotionalState: EmotionalState | null = null;
    public color: { r: number, g: number, b: number } = { r: 0.2, g: 0.5, b: 1.0 }; // Default Blue

    // P1-07: Store refs for cleanup
    private splatIntervalId: ReturnType<typeof setInterval> | null = null;
    private resizeHandler: (() => void) | null = null;
    private contextLostHandler: ((event: Event) => void) | null = null;
    private contextRestoredHandler: ((event: Event) => void) | null = null;
    private animationFrameId: number | null = null;
    private disposed: boolean = false;

    constructor(canvas: HTMLCanvasElement, config: Partial<FluidConfig> = {}) {
        this.canvas = canvas;
        this.config = { ...DEFAULT_FLUID_CONFIG, ...config };

        const gl = canvas.getContext('webgl2', { alpha: this.config.TRANSPARENT, premultipliedAlpha: false });
        if (!gl) throw new Error('WebGL2 not supported');
        this.gl = gl;

        // Extensions
        gl.getExtension('EXT_color_buffer_float');
        // OES_texture_float_linear is crucial for smooth advection
        gl.getExtension('OES_texture_float_linear');

        this.initGeometry();
        this.initShaders();
        this.initFramebuffers();
        this.resize();

        // FIX P1-07: Store listener and interval refs for teardown
        this.resizeHandler = () => this.resize();
        if (typeof window !== 'undefined') {
            window.addEventListener('resize', this.resizeHandler);
        }

        this.contextLostHandler = (event: Event) => {
            const webglEvent = event as WebGLContextEvent;
            webglEvent.preventDefault();
            if (this.animationFrameId) {
                cancelAnimationFrame(this.animationFrameId);
                this.animationFrameId = null;
            }
            console.warn('🌊 FluidRenderer context lost');
        };

        this.contextRestoredHandler = () => {
            if (this.disposed) return;
            console.info('🌊 FluidRenderer context restored');
            this.programs = {} as Record<FluidProgramName, ProgramBundle>;
            this.textures = {} as FluidTextures;
            this.quadBuffer = null;
            this.initGeometry();
            this.initShaders();
            this.initFramebuffers();
            this.resize();
            this.lastUpdateTime = 0;
            this.render();
        };

        this.canvas.addEventListener('webglcontextlost', this.contextLostHandler);
        this.canvas.addEventListener('webglcontextrestored', this.contextRestoredHandler);

        this.splatIntervalId = setInterval(() => {
            if (!this.disposed && !this.config.PAUSED)
                this.splat(Math.random(), Math.random(), (Math.random() - 0.5) * 200, (Math.random() - 0.5) * 200, this.color);
        }, 3000);
    }

    public applyEmotionalState(state: EmotionalState) {
        this.lastEmotionalState = state;

        // 1. Color: Valence
        // 0 (Bad) = Red [1, 0, 0]
        // 1 (Good) = Blue [0, 0.5, 1]
        // 0.5 = Purple
        this.color.r = 1.0 - state.valence;
        this.color.g = state.attention * 0.5; // Attention adds Green/Structure
        this.color.b = state.valence;

        // 2. Dissipation: Momentum
        // High momentum = low dissipation (longer trails)
        // Momentum 0 -> 0.9 (Fast decay)
        // Momentum 1 -> 0.995 (Slow decay)
        this.config.DENSITY_DISSIPATION = 0.9 + (state.momentum * 0.095);
        this.config.VELOCITY_DISSIPATION = 0.9 + (state.momentum * 0.095);

        // 3. Curl: Entropy/Confusion (Simulated by high curl)
        // Default 30
        this.config.CURL = 20 + (state.cortisol * 0.5); // Stress makes it swirl more? Or maybe Chaos?

        // 4. Splat Force: Arousal
        this.config.SPLAT_FORCE = 6000 * (0.5 + state.arousal);

        // Trigger a splat on update if arousal is high
        if (state.arousal > 0.7 && Math.random() > 0.8) {
            const x = Math.random();
            const y = Math.random();
            this.splat(x, y, 0, 0, this.color); // Static bloom
        }
    }

    public setColor(r: number, g: number, b: number) {
        this.color = { r, g, b };
    }

    public splat(x: number, y: number, dx: number, dy: number, color: { r: number, g: number, b: number }) {
        if (this.disposed) return;
        const gl = this.gl;
        this.programs.splat.bind();
        gl.uniform1i(this.programs.splat.uniforms.uTarget, this.textures.velocity.read.attach(0));
        gl.uniform1f(this.programs.splat.uniforms.aspectRatio, this.canvas.width / this.canvas.height);
        gl.uniform2f(this.programs.splat.uniforms.point, x, y);
        gl.uniform3f(this.programs.splat.uniforms.color, dx, dy, 0.0);
        gl.uniform1f(this.programs.splat.uniforms.radius, this.config.SPLAT_RADIUS / 100.0);
        this.blit(this.textures.velocity.write);
        this.textures.velocity.swap();

        gl.uniform1i(this.programs.splat.uniforms.uTarget, this.textures.density.read.attach(0));
        gl.uniform3f(this.programs.splat.uniforms.color, color.r, color.g, color.b);
        this.blit(this.textures.density.write);
        this.textures.density.swap();
    }

    public render() {
        if (this.disposed) return;
        if (this.config.PAUSED) return;

        const now = Date.now();
        if (this.lastUpdateTime === 0) {
            this.lastUpdateTime = now;
        }
        const dt = Math.min((now - this.lastUpdateTime) / 1000, 0.016);
        this.lastUpdateTime = now;

        this.step(dt);
        this.display();

        if (!this.disposed) {
            this.animationFrameId = requestAnimationFrame(() => this.render());
        }
    }

    private step(dt: number) {
        const gl = this.gl;
        gl.disable(gl.BLEND);

        // Curl
        this.programs.curl.bind();
        gl.uniform2f(this.programs.curl.uniforms.texelSize, 1.0 / this.config.SIM_RESOLUTION, 1.0 / this.config.SIM_RESOLUTION);
        gl.uniform1i(this.programs.curl.uniforms.uVelocity, this.textures.velocity.read.attach(0));
        this.blit(this.textures.curl);

        // Vorticity
        this.programs.vorticity.bind();
        gl.uniform2f(this.programs.vorticity.uniforms.texelSize, 1.0 / this.config.SIM_RESOLUTION, 1.0 / this.config.SIM_RESOLUTION);
        gl.uniform1i(this.programs.vorticity.uniforms.uVelocity, this.textures.velocity.read.attach(0));
        gl.uniform1i(this.programs.vorticity.uniforms.uCurl, this.textures.curl.attach(1));
        gl.uniform1f(this.programs.vorticity.uniforms.curl, this.config.CURL);
        gl.uniform1f(this.programs.vorticity.uniforms.dt, dt);
        this.blit(this.textures.velocity.write);
        this.textures.velocity.swap();

        // Divergence
        this.programs.divergence.bind();
        gl.uniform2f(this.programs.divergence.uniforms.texelSize, 1.0 / this.config.SIM_RESOLUTION, 1.0 / this.config.SIM_RESOLUTION);
        gl.uniform1i(this.programs.divergence.uniforms.uVelocity, this.textures.velocity.read.attach(0));
        this.blit(this.textures.divergence);

        // Clear Pressure
        this.programs.clear.bind();
        gl.uniform1i(this.programs.clear.uniforms.uTexture, this.textures.pressure.read.attach(0));
        gl.uniform1f(this.programs.clear.uniforms.value, this.config.PRESSURE_DISSIPATION);
        this.blit(this.textures.pressure.write);
        this.textures.pressure.swap();

        // Pressure Solve
        this.programs.pressure.bind();
        gl.uniform2f(this.programs.pressure.uniforms.texelSize, 1.0 / this.config.SIM_RESOLUTION, 1.0 / this.config.SIM_RESOLUTION);
        gl.uniform1i(this.programs.pressure.uniforms.uDivergence, this.textures.divergence.attach(0));
        for (let i = 0; i < this.config.PRESSURE_ITERATIONS; i++) {
            gl.uniform1i(this.programs.pressure.uniforms.uPressure, this.textures.pressure.read.attach(1));
            this.blit(this.textures.pressure.write);
            this.textures.pressure.swap();
        }

        // Gradient Subtract
        this.programs.gradientSubtract.bind();
        gl.uniform2f(this.programs.gradientSubtract.uniforms.texelSize, 1.0 / this.config.SIM_RESOLUTION, 1.0 / this.config.SIM_RESOLUTION);
        gl.uniform1i(this.programs.gradientSubtract.uniforms.uPressure, this.textures.pressure.read.attach(0));
        gl.uniform1i(this.programs.gradientSubtract.uniforms.uVelocity, this.textures.velocity.read.attach(1));
        this.blit(this.textures.velocity.write);
        this.textures.velocity.swap();

        // Advection Velocity
        this.programs.advection.bind();
        gl.uniform2f(this.programs.advection.uniforms.texelSize, 1.0 / this.config.SIM_RESOLUTION, 1.0 / this.config.SIM_RESOLUTION);
        gl.uniform1i(this.programs.advection.uniforms.uVelocity, this.textures.velocity.read.attach(1));
        gl.uniform1i(this.programs.advection.uniforms.uSource, this.textures.velocity.read.attach(0));
        gl.uniform1f(this.programs.advection.uniforms.dt, dt);
        gl.uniform1f(this.programs.advection.uniforms.dissipation, this.config.VELOCITY_DISSIPATION);
        this.blit(this.textures.velocity.write);
        this.textures.velocity.swap();

        // Advection Density
        gl.uniform1i(this.programs.advection.uniforms.uVelocity, this.textures.velocity.read.attach(0));
        gl.uniform1i(this.programs.advection.uniforms.uSource, this.textures.density.read.attach(1));
        gl.uniform1f(this.programs.advection.uniforms.dissipation, this.config.DENSITY_DISSIPATION);
        this.blit(this.textures.density.write);
        this.textures.density.swap();
    }

    private display() {
        const gl = this.gl;
        this.programs.display.bind();
        gl.uniform1i(this.programs.display.uniforms.uTexture, this.textures.density.read.attach(0));
        this.blit(null);
    }

    private initShaders() {
        this.programs.splat = this.createProgram(baseVertexShader, splatShader);
        this.programs.curl = this.createProgram(baseVertexShader, curlShader);
        this.programs.vorticity = this.createProgram(baseVertexShader, vorticityShader);
        this.programs.divergence = this.createProgram(baseVertexShader, divergenceShader);
        this.programs.clear = this.createProgram(baseVertexShader, clearShader);
        this.programs.pressure = this.createProgram(baseVertexShader, pressureShader);
        this.programs.gradientSubtract = this.createProgram(baseVertexShader, gradientSubtractShader);
        this.programs.advection = this.createProgram(baseVertexShader, advectionShader);
        this.programs.display = this.createProgram(baseVertexShader, displayShader);
    }

    private initGeometry() {
        const gl = this.gl;
        this.quadBuffer = gl.createBuffer();
        if (!this.quadBuffer) {
            throw new Error('Failed to create quad buffer');
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
    }

    private createProgram(vertexShader: string, fragmentShader: string): ProgramBundle {
        const gl = this.gl;
        const program = gl.createProgram();
        if (!program) throw new Error("Failed to create program");

        const vs = this.compileShader(gl.VERTEX_SHADER, vertexShader);
        const fs = this.compileShader(gl.FRAGMENT_SHADER, fragmentShader);

        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);

        if (!gl.getProgramParameter(program, gl.LINK_STATUS))
            console.error(gl.getProgramInfoLog(program));

        // No longer needed after linking; free shader objects immediately.
        gl.deleteShader(vs);
        gl.deleteShader(fs);

        const uniforms: Record<string, WebGLUniformLocation | null> = {};
        const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
        for (let i = 0; i < count; i++) {
            const name = gl.getActiveUniform(program, i)?.name;
            if (name) uniforms[name] = gl.getUniformLocation(program, name);
        }

        return {
            program,
            uniforms,
            bind: () => {
                gl.useProgram(program);
                if (!this.quadBuffer) return;
                gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
                const loc = gl.getAttribLocation(program, 'aPosition');
                if (loc >= 0) {
                    gl.enableVertexAttribArray(loc);
                    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
                }
            }
        };
    }

    private compileShader(type: number, source: string) {
        const gl = this.gl;
        const shader = gl.createShader(type);
        if (!shader) throw new Error("Failed to create shader");

        gl.shaderSource(shader, source);
        gl.compileShader(shader);

        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
            console.error(gl.getShaderInfoLog(shader));

        return shader;
    }

    private initFramebuffers() {
        const simRes = this.config.SIM_RESOLUTION;
        const dyeRes = this.config.DYE_RESOLUTION;

        const type = this.gl.FLOAT;

        this.textures.velocity = this.createDoubleFBO(simRes, simRes, type);
        this.textures.density = this.createDoubleFBO(dyeRes, dyeRes, type);
        this.textures.divergence = this.createFBO(simRes, simRes, type);
        this.textures.curl = this.createFBO(simRes, simRes, type);
        this.textures.pressure = this.createDoubleFBO(simRes, simRes, type);
    }

    private createFBO(w: number, h: number, type: number): RenderTarget {
        const gl = this.gl;
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, type, null);

        const fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        gl.viewport(0, 0, w, h);
        gl.clear(gl.COLOR_BUFFER_BIT);

        return {
            texture,
            fbo,
            attach: (id: number) => {
                gl.activeTexture(gl.TEXTURE0 + id);
                gl.bindTexture(gl.TEXTURE_2D, texture);
                return id;
            }
        };
    }

    private createDoubleFBO(w: number, h: number, type: number): DoubleRenderTarget {
        const fbo1 = this.createFBO(w, h, type);
        const fbo2 = this.createFBO(w, h, type);

        // FIX P1-08: Return object that updates its OWN read/write properties
        const dblFbo = {
            read: fbo1,
            write: fbo2,
            swap: () => {
                const temp = dblFbo.read;
                dblFbo.read = dblFbo.write;
                dblFbo.write = temp;
            }
        };
        return dblFbo;
    }

    /**
     * 🧹 DISPOSE: Release all GPU resources, listeners, timers
     */
    public dispose(): void {
        this.disposed = true;

        if (this.splatIntervalId) {
            clearInterval(this.splatIntervalId);
            this.splatIntervalId = null;
        }
        if (this.resizeHandler) {
            if (typeof window !== 'undefined') {
                window.removeEventListener('resize', this.resizeHandler);
            }
            this.resizeHandler = null;
        }
        if (this.contextLostHandler) {
            this.canvas.removeEventListener('webglcontextlost', this.contextLostHandler);
            this.contextLostHandler = null;
        }
        if (this.contextRestoredHandler) {
            this.canvas.removeEventListener('webglcontextrestored', this.contextRestoredHandler);
            this.contextRestoredHandler = null;
        }
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        // Clean up WebGL resources
        const gl = this.gl;
        for (const key of Object.keys(this.programs)) {
            const program = this.programs[key as FluidProgramName];
            gl.deleteProgram(program?.program);
        }
        this.programs = {} as Record<FluidProgramName, ProgramBundle>;

        const textures = this.textures as Partial<FluidTextures>;
        const textureTargets: Array<RenderTarget | DoubleRenderTarget | undefined> = [
            textures.velocity,
            textures.density,
            textures.divergence,
            textures.curl,
            textures.pressure
        ];
        for (const target of textureTargets) {
            if (!target) continue;
            if ('read' in target && 'write' in target) {
                this.deleteRenderTarget(target.read);
                this.deleteRenderTarget(target.write);
            } else {
                this.deleteRenderTarget(target);
            }
        }
        this.textures = {} as FluidTextures;

        if (this.quadBuffer) {
            gl.deleteBuffer(this.quadBuffer);
            this.quadBuffer = null;
        }

        gl.getExtension('WEBGL_lose_context')?.loseContext();

        console.log('🌊 FluidRenderer disposed');
    }

    private deleteRenderTarget(target: RenderTarget | null | undefined) {
        if (!target) return;
        const gl = this.gl;
        if (target.texture) {
            gl.deleteTexture(target.texture);
        }
        if (target.fbo) {
            gl.deleteFramebuffer(target.fbo);
        }
    }

    private resize() {
        if (!this.canvas) return;
        this.canvas.width = this.canvas.clientWidth;
        this.canvas.height = this.canvas.clientHeight;
    }

    private blit(destination: RenderTarget | null) {
        const gl = this.gl;
        gl.bindFramebuffer(gl.FRAMEBUFFER, destination ? destination.fbo : null);
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
}

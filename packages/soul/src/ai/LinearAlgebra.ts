/**
 * Lightweight Linear Algebra helper for Thermodynamic Engine.
 * Optimized for small dimensions (5x5) using Float64Array for memory locality.
 */
export class Vector {
    public data: Float64Array;

    constructor(data: number[] | Float64Array) {
        if (data instanceof Float64Array) {
            this.data = data;
        } else {
            this.data = new Float64Array(data);
        }
    }

    static zeros(dim: number): Vector {
        return new Vector(new Float64Array(dim));
    }

    static from(data: number[]): Vector {
        return new Vector(new Float64Array(data));
    }

    get len(): number {
        return this.data.length;
    }

    get(i: number): number {
        return this.data[i];
    }

    set(i: number, val: number) {
        this.data[i] = val;
    }

    add(v: Vector): Vector {
        const out = new Float64Array(this.len);
        for (let i = 0; i < this.len; i++) out[i] = this.data[i] + v.data[i];
        return new Vector(out);
    }

    sub(v: Vector): Vector {
        const out = new Float64Array(this.len);
        for (let i = 0; i < this.len; i++) out[i] = this.data[i] - v.data[i];
        return new Vector(out);
    }

    mul(scalar: number): Vector {
        const out = new Float64Array(this.len);
        for (let i = 0; i < this.len; i++) out[i] = this.data[i] * scalar;
        return new Vector(out);
    }

    dot(v: Vector): number {
        let sum = 0;
        for (let i = 0; i < this.len; i++) sum += this.data[i] * v.data[i];
        return sum;
    }

    norm(): number {
        return Math.sqrt(this.dot(this));
    }

    clamp(min: number, max: number): Vector {
        const out = new Float64Array(this.len);
        for (let i = 0; i < this.len; i++) {
            out[i] = Math.min(Math.max(this.data[i], min), max);
        }
        return new Vector(out);
    }

    clone(): Vector {
        return new Vector(new Float64Array(this.data));
    }
}

export class Matrix {
    public data: Float64Array;

    constructor(public rows: number, public cols: number, data?: Float64Array) {
        if (data) {
            this.data = data;
        } else {
            this.data = new Float64Array(rows * cols);
        }
    }

    static zeros(rows: number, cols: number): Matrix {
        return new Matrix(rows, cols);
    }

    set(row: number, col: number, val: number) {
        this.data[row * this.cols + col] = val;
    }

    get(row: number, col: number): number {
        return this.data[row * this.cols + col];
    }

    // Matrix-Vector multiplication
    mulVec(v: Vector): Vector {
        if (this.cols !== v.len) throw new Error("Dimension mismatch");
        const result = new Float64Array(this.rows);

        for (let i = 0; i < this.rows; i++) {
            let sum = 0;
            const rowOffset = i * this.cols;
            for (let j = 0; j < this.cols; j++) {
                sum += this.data[rowOffset + j] * v.data[j];
            }
            result[i] = sum;
        }
        return new Vector(result);
    }
}

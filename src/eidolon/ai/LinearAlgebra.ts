/**
 * Lightweight Linear Algebra helper for Thermodynamic Engine.
 * Optimized for small dimensions (5x5).
 */
export class Vector {
    constructor(public data: number[]) { }

    static zeros(dim: number): Vector {
        return new Vector(new Array(dim).fill(0));
    }

    static from(data: number[]): Vector {
        return new Vector([...data]);
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
        return new Vector(this.data.map((x, i) => x + v.data[i]));
    }

    sub(v: Vector): Vector {
        return new Vector(this.data.map((x, i) => x - v.data[i]));
    }

    mul(scalar: number): Vector {
        return new Vector(this.data.map(x => x * scalar));
    }

    dot(v: Vector): number {
        return this.data.reduce((sum, x, i) => sum + x * v.data[i], 0);
    }

    norm(): number {
        return Math.sqrt(this.dot(this));
    }

    clamp(min: number, max: number): Vector {
        return new Vector(this.data.map(x => Math.min(Math.max(x, min), max)));
    }

    clone(): Vector {
        return new Vector([...this.data]);
    }
}

export class Matrix {
    constructor(public rows: number, public cols: number, public data: number[][]) { }

    static zeros(rows: number, cols: number): Matrix {
        const data = Array(rows).fill(0).map(() => Array(cols).fill(0));
        return new Matrix(rows, cols, data);
    }

    set(row: number, col: number, val: number) {
        this.data[row][col] = val;
    }

    get(row: number, col: number): number {
        return this.data[row][col];
    }

    // Matrix-Vector multiplication
    mulVec(v: Vector): Vector {
        if (this.cols !== v.len) throw new Error("Dimension mismatch");
        const result = new Array(this.rows).fill(0);
        for (let i = 0; i < this.rows; i++) {
            for (let j = 0; j < this.cols; j++) {
                result[i] += this.data[i][j] * v.data[j];
            }
        }
        return new Vector(result);
    }
}

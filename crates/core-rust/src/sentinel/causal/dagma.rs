use nalgebra::DMatrix;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DagmaConfig {
    pub max_iter: usize,
    pub tol: f32,
    pub lambda1: f32, // L1 regularization
    pub rho_max: f32,
    pub s: f32, // Check sI - W o W > 0
}

impl Default for DagmaConfig {
    fn default() -> Self {
        Self {
            max_iter: 100, // Outer iterations
            tol: 1e-4,
            lambda1: 0.02,
            rho_max: 1e10,
            s: 1.0,
        }
    }
}

pub struct Dagma {
    config: DagmaConfig,
}

impl Dagma {
    pub fn new(config: DagmaConfig) -> Self {
        Self { config }
    }

    /// Learn the weighted adjacency matrix W from data X (n_samples x d_vars)
    /// Returns W (d x d)
    pub fn fit(&self, x: &DMatrix<f32>) -> DMatrix<f32> {
        let d = x.ncols();
        let n = x.nrows() as f32;

        // Initialize W with zeros
        let mut w = DMatrix::<f32>::zeros(d, d);

        let mut rho = 1.0;
        let mut alpha = 0.0;
        let mut h_val = f32::MAX;

        // Precompute X^T * X for MSE gradient
        // MSE = 0.5/n * ||X - XW||^2
        // Grad = 1/n * (X^T X W - X^T X)
        let xt_x = x.transpose() * x;

        for _iter in 0..self.config.max_iter {
            let w_new = self.minimize_subproblem(&w, &xt_x, n, rho, alpha);

            let h_new = self.h_func(&w_new);

            if h_new > 0.25 * h_val {
                rho *= 10.0;
            } else {
                // Converged enough for this level
            }

            w = w_new;
            h_val = h_new;
            alpha += rho * h_val;

            if h_val < self.config.tol && rho > self.config.rho_max {
                break;
            }
        }

        // Final thresholding (simple)
        w.map(|v| if v.abs() < 0.05 { 0.0 } else { v })
    }

    // Inner loop: minimize primal objective using Adam
    fn minimize_subproblem(
        &self,
        w_init: &DMatrix<f32>,
        xt_x: &DMatrix<f32>,
        n: f32,
        rho: f32,
        alpha: f32,
    ) -> DMatrix<f32> {
        let mut w = w_init.clone();
        let d = w.nrows();

        // Adam parameters
        let lr = 3e-4; // Learning rate
        let beta1 = 0.9;
        let beta2 = 0.999;
        let epsilon = 1e-8;

        let mut m = DMatrix::<f32>::zeros(d, d);
        let mut v = DMatrix::<f32>::zeros(d, d);

        // Inner iterations
        for t in 1..500 {
            // 1. Calculate Gradients
            // Grad MSE = 1/n * (X'X W - X'X)
            let grad_mse = (xt_x * &w - xt_x) / n;

            // Grad h(W)
            // h(W) = -log det(sI - W o W) + const
            // Grad h = 2 * (sI - W o W)^-T o W
            let (h_val, grad_h) = self.h_func_grad(&w);

            if h_val.is_nan() {
                // If domain error, break or fallback (should not happen with correct bounds)
                break;
            }

            // Grad Total = Grad MSE + lambda * sign(W) + (rho * h + alpha) * Grad h
            // Smooth L1 approximation? Or subgradient. Using sign() for now.
            let grad_l1 = w.map(|x| x.signum());

            let term_aug = rho * h_val + alpha;
            let grad_total = grad_mse + grad_l1 * self.config.lambda1 + grad_h * term_aug;

            // 2. Adam Update
            m = m.scale(beta1) + grad_total.scale(1.0 - beta1);
            let grad_sq = grad_total.component_mul(&grad_total);
            v = v.scale(beta2) + grad_sq.scale(1.0 - beta2);

            // Bias correction
            let m_hat = &m / (1.0 - beta1.powi(t));
            let v_hat = &v / (1.0 - beta2.powi(t));

            let step = m_hat.component_div(&v_hat.map(|x| x.sqrt() + epsilon));
            w = w - step.scale(lr);

            // Enforce zero diagonal (DAGs have no self-loops)
            for i in 0..d {
                w[(i, i)] = 0.0;
            }
        }

        w
    }

    fn h_func(&self, w: &DMatrix<f32>) -> f32 {
        let d = w.nrows();
        let s = self.config.s;

        // M = sI - W o W
        let w_sq = w.component_mul(w);
        let m = DMatrix::<f32>::identity(d, d).scale(s) - w_sq;

        // Log det
        // nalgebra's determinant might overflow for large matrices, but here 5x5 is fine.
        // Better to use LU decomposition
        match m.lu().determinant().abs().ln() {
            val if val.is_finite() => -val + (d as f32) * s.ln(),
            _ => f32::INFINITY,
        }
    }

    fn h_func_grad(&self, w: &DMatrix<f32>) -> (f32, DMatrix<f32>) {
        let d = w.nrows();
        let s = self.config.s;

        let w_sq = w.component_mul(w);
        let m = DMatrix::<f32>::identity(d, d).scale(s) - w_sq;

        // Inverse of M
        let m_inv = match m.clone().try_inverse() {
            Some(inv) => inv,
            None => return (f32::INFINITY, DMatrix::zeros(d, d)),
        };

        let log_det = m.determinant().abs().ln();
        let h_val = -log_det + (d as f32) * s.ln();

        // Grad h = 2 * (M^-T) o W
        // M is symmetric if W o W is symmetric? No.
        // M = sI - W o W. W o W is symmetric if W is symmetric? No.
        // Actually (W o W)_ij = W_ij^2. So it is symmetric if W_ij^2 = W_ji^2.
        // In general M is not symmetric.
        // Gradient formula derived: \nabla_W h(W) = 2 * (M^-T o W)
        let grad_h = 2.0 * m_inv.transpose().component_mul(w);

        (h_val, grad_h)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_dagma_learning() {
        use rand::Rng;
        let mut rng = rand::thread_rng();

        // Ground Truth: Collider 0 -> 2 <- 1
        // X0, X1 ~ U(-0.5, 0.5)
        // X2 = X0 + X1 + Noise
        // We use non-standardized data because Variance asymmetry helps identification.

        let n_samples = 2000;
        let mut data = vec![0.0; n_samples * 3];

        for i in 0..n_samples {
            let x0 = rng.gen::<f32>() - 0.5;
            let x1 = rng.gen::<f32>() - 0.5;
            // X2 has higher variance
            let x2 = x0 + x1 + (rng.gen::<f32>() - 0.5) * 0.5;

            data[i * 3 + 0] = x0;
            data[i * 3 + 1] = x1;
            data[i * 3 + 2] = x2;
        }

        let x = DMatrix::from_row_slice(n_samples, 3, &data);

        // No Standardization

        // Check correlations
        let cov = (x.transpose() * &x) / (n_samples as f32);
        println!("Covariance/Correlation (Raw):\n{:.2}", cov);

        let config = DagmaConfig {
            max_iter: 200, // More iterations
            tol: 1e-4,
            lambda1: 0.0,
            rho_max: 1e8,
            s: 1.0,
        };

        let dagma = Dagma::new(config);
        let w = dagma.fit(&x);

        println!("Learned W (Raw): {:.2}", w);

        // Expect:
        // W[0, 2] > 0.5
        // W[1, 2] > 0.5

        assert!(w[(0, 2)].abs() > 0.5, "Failed to learn 0->2");
        assert!(w[(1, 2)].abs() > 0.5, "Failed to learn 1->2");
        assert!(w[(0, 1)].abs() < 0.2, "False edge 0->1");
        assert!(w[(1, 0)].abs() < 0.2, "False edge 1->0");
        assert!(w[(2, 0)].abs() < 0.2, "Cycle 2->0");
    }
}

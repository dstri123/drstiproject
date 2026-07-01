import * as numeric from "numeric";

/**
 * Kabsch Algorithm with uniform scale
 * -----------------------------------
 * source  → moving points (Point Cloud)
 * target  → fixed points (BIM)
 *
 * Returns:
 *  - R (3x3 rotation matrix)
 *  - t (translation vector)
 *  - scale (uniform scaling factor)
 */
export function kabschAlgorithm(source, target) {
  const n = source.length;

  if (n !== target.length || n < 3) {
    throw new Error("Kabsch needs same number of points and at least 3 pairs");
  }

  /* ---------------------------------------------------
     1️⃣ Compute centroids
  --------------------------------------------------- */
  const centroidA = [
    source.reduce((s, p) => s + p.x, 0) / n,
    source.reduce((s, p) => s + p.y, 0) / n,
    source.reduce((s, p) => s + p.z, 0) / n,
  ];

  const centroidB = [
    target.reduce((s, p) => s + p.x, 0) / n,
    target.reduce((s, p) => s + p.y, 0) / n,
    target.reduce((s, p) => s + p.z, 0) / n,
  ];

  /* ---------------------------------------------------
     2️⃣ Build centered matrices (n x 3)
  --------------------------------------------------- */
  const A = source.map((p) => [
    p.x - centroidA[0],
    p.y - centroidA[1],
    p.z - centroidA[2],
  ]);

  const B = target.map((p) => [
    p.x - centroidB[0],
    p.y - centroidB[1],
    p.z - centroidB[2],
  ]);

  /* ---------------------------------------------------
     3️⃣ Covariance matrix H = Aᵀ B (3x3)
  --------------------------------------------------- */
  const H = numeric.dot(numeric.transpose(A), B);

  /* ---------------------------------------------------
     4️⃣ SVD of H
  --------------------------------------------------- */
  const { U, S, V } = numeric.svd(H);

  /* ---------------------------------------------------
     5️⃣ Compute rotation R = V Uᵀ
  --------------------------------------------------- */
  let R = numeric.dot(V, numeric.transpose(U));

  // Fix reflection case
  if (numeric.det(R) < 0) {
    V[0][2] *= -1;
    V[1][2] *= -1;
    V[2][2] *= -1;
    R = numeric.dot(V, numeric.transpose(U));
  }

  /* ---------------------------------------------------
     6️⃣ Compute uniform scale
  --------------------------------------------------- */
  const sumS = numeric.sum(S);

  const denom = numeric.sum(A.map((row) => numeric.dot(row, row)));

  const scale = sumS / denom;

  /* ---------------------------------------------------
     7️⃣ Compute translation
     t = C_target - s R C_source
  --------------------------------------------------- */
  const RC = numeric.dot(R, centroidA);

  const t = [
    centroidB[0] - scale * RC[0],
    centroidB[1] - scale * RC[1],
    centroidB[2] - scale * RC[2],
  ];

  return { R, t, scale };
}

/* Optional alias */
export const kabsch = kabschAlgorithm;

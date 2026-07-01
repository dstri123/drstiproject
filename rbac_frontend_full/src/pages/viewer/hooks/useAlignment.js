import * as THREE from "three";
import { kabschAlgorithm } from "../utils/kabsch";

export default function useAlignment(bimPoints, pcPoints, pcModel, setMatrix) {
  const alignGeometry = () => {
    if (bimPoints.length < 3 || pcPoints.length < 3) {
      alert("Pick at least 3 matching point pairs!");
      return;
    }

    const src = pcPoints.map((p) => ({ x: p.x, y: p.y, z: p.z }));
    const dst = bimPoints.map((p) => ({ x: p.x, y: p.y, z: p.z }));

    const { R, t, scale } = kabschAlgorithm(src, dst);

    const autoMatrix = [
      [scale * R[0][0], scale * R[0][1], scale * R[0][2], t[0]],
      [scale * R[1][0], scale * R[1][1], scale * R[1][2], t[1]],
      [scale * R[2][0], scale * R[2][1], scale * R[2][2], t[2]],
      [0, 0, 0, 1],
    ];

    setMatrix(autoMatrix);

    const m = new THREE.Matrix4();
    m.set(
      autoMatrix[0][0],
      autoMatrix[0][1],
      autoMatrix[0][2],
      autoMatrix[0][3],
      autoMatrix[1][0],
      autoMatrix[1][1],
      autoMatrix[1][2],
      autoMatrix[1][3],
      autoMatrix[2][0],
      autoMatrix[2][1],
      autoMatrix[2][2],
      autoMatrix[2][3],
      autoMatrix[3][0],
      autoMatrix[3][1],
      autoMatrix[3][2],
      autoMatrix[3][3],
    );

    if (pcModel) pcModel.applyMatrix4(m);

    alert("Geometry aligned successfully!");
  };

  const generateMatrix = () => {
    if (bimPoints.length < 3 || pcPoints.length < 3) {
      alert("Pick at least 3 pairs!");
      return;
    }

    const src = pcPoints.map((p) => ({ x: p.x, y: p.y, z: p.z }));
    const dst = bimPoints.map((p) => ({ x: p.x, y: p.y, z: p.z }));

    const { R, t, scale } = kabschAlgorithm(src, dst);

    const result = [
      [scale * R[0][0], scale * R[0][1], scale * R[0][2], t[0]],
      [scale * R[1][0], scale * R[1][1], scale * R[1][2], t[1]],
      [scale * R[2][0], scale * R[2][1], scale * R[2][2], t[2]],
      [0, 0, 0, 1],
    ];

    setMatrix(result);

    alert("Matrix generated!");
  };

  return { alignGeometry, generateMatrix };
}

import { useState } from "react";

export default function useFileManager() {
  // Files
  const [bimFile, setBimFile] = useState(null);
  const [pointFile, setPointFile] = useState(null);

  // Visibility
  const [bimVisible, setBimVisible] = useState(true);
  const [pcVisible, setPcVisible] = useState(true);

  // Picked Points
  const [bimPoints, setBimPoints] = useState([]);
  const [pcPoints, setPcPoints] = useState([]);

  // Alignment Matrix
  const [matrix, setMatrix] = useState(null);

  return {
    // files
    bimFile,
    setBimFile,
    pointFile,
    setPointFile,

    // visibility
    bimVisible,
    setBimVisible,
    pcVisible,
    setPcVisible,

    // points
    bimPoints,
    setBimPoints,
    pcPoints,
    setPcPoints,

    // matrix
    matrix,
    setMatrix,
  };
}

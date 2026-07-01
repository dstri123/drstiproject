import { useState } from "react";

export default function useCameraManager() {
  const [cameraPositionsFile, setCameraPositionsFile] = useState(null);

  const [cameraImages, setCameraImages] = useState([]);

  const [showCameras, setShowCameras] = useState(true);

  const [selectedElement, setSelectedElement] = useState(null);

  const [highlightOverlap, setHighlightOverlap] = useState(false);

  const [bimElementCount, setBimElementCount] = useState(0);

  const [overlapElementCount, setOverlapElementCount] = useState(0);

  return {
    cameraPositionsFile,
    setCameraPositionsFile,

    cameraImages,
    setCameraImages,

    showCameras,
    setShowCameras,

    selectedElement,
    setSelectedElement,

    highlightOverlap,
    setHighlightOverlap,

    bimElementCount,
    setBimElementCount,

    overlapElementCount,
    setOverlapElementCount,
  };
}

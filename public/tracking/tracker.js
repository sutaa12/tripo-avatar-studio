importScripts("./vision_bundle.js");
let task, channel;
self.onmessage = async ({ data }) => {
  try {
    if (data.type === "init") {
      channel = data.channel;
      const fs = await Vision.FilesetResolver.forVisionTasks(new URL("./wasm", self.location.href).href);
      const common = {
        baseOptions: {
          modelAssetPath: new URL(`./${channel}.task`, self.location.href).href,
          delegate: "CPU",
        },
        runningMode: "VIDEO",
      };
      if (channel === "face")
        task = await Vision.FaceLandmarker.createFromOptions(fs, {
          ...common,
          numFaces: 1,
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: true,
        });
      else if (channel === "hand")
        task = await Vision.HandLandmarker.createFromOptions(fs, {
          ...common,
          numHands: 2,
        });
      else if (channel === "pose")
        task = await Vision.PoseLandmarker.createFromOptions(fs, {
          ...common,
          numPoses: 1,
        });
      else throw new Error("Unknown tracking channel");
      self.postMessage({ type: "ready", channel });
    } else if (data.type === "frame") {
      try {
        const start = performance.now();
        const result = task.detectForVideo(data.bitmap, data.time);
        self.postMessage({
          type: "result",
          channel,
          time: data.time,
          inferenceMs: performance.now() - start,
          result,
        });
      } finally {
        data.bitmap.close();
      }
    }
  } catch (error) {
    self.postMessage({ type: "error", channel, message: String(error) });
  }
};

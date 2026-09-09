import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

// Split the VRM container losslessly so no public asset exceeds the host's file limit.
const input = path.resolve(process.argv[2] ?? "model-source/avatar.vrm");
const output = path.resolve("public/models");
const data = fs.readFileSync(input);
const jsonLength = data.readUInt32LE(12);
const gltf = JSON.parse(data.subarray(20, 20 + jsonLength).toString());
const bin = data.subarray(28 + jsonLength);
if (gltf.buffers.length !== 1) throw Error("Expected one embedded VRM buffer");
fs.mkdirSync(output, { recursive: true });
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const imageViews = new Set();
const images = [];
for (const image of gltf.images) {
  const view = gltf.bufferViews[image.bufferView];
  imageViews.add(image.bufferView);
  const bytes = bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
  const sha256 = digest(bytes);
  const name = `texture-${sha256.slice(0, 16)}.${image.mimeType === "image/jpeg" ? "jpg" : "png"}`;
  fs.writeFileSync(path.join(output, name), bytes);
  images.push({ name, bytes: bytes.length, sha256 });
  image.uri = name;
  delete image.bufferView;
}
const mapping = new Map();
const views = [], chunks = [];
let offset = 0;
for (const [index, view] of gltf.bufferViews.entries()) {
  if (imageViews.has(index)) continue;
  const padding = (4 - offset % 4) % 4;
  if (padding) { chunks.push(Buffer.alloc(padding)); offset += padding; }
  mapping.set(index, views.length);
  const bytes = bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
  views.push({ ...view, byteOffset: offset });
  chunks.push(bytes);
  offset += bytes.length;
}
gltf.bufferViews = views;
function remap(value) {
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (key === "bufferView") {
      if (!mapping.has(item)) throw Error("Unexpected shared image buffer view");
      value[key] = mapping.get(item);
    } else remap(item);
  }
}
remap(gltf);
const geometry = Buffer.concat(chunks);
const geometryName = `geometry-${digest(geometry).slice(0,16)}.bin`;
gltf.buffers = [{ byteLength: geometry.length, uri: geometryName }];
fs.writeFileSync(path.join(output, geometryName), geometry);
fs.writeFileSync(path.join(output, "avatar.gltf"), JSON.stringify(gltf));
const manifest = { sourceSha256: digest(data), images,
  geometry: { name: geometryName, bytes: geometry.length, sha256: digest(geometry) },
  conversion: "Lossless separation; all image and vertex bytes retained" };
fs.writeFileSync(path.join(output, "version.json"), JSON.stringify(manifest, null, 2));
const retained = new Set(["avatar.gltf", "version.json", geometryName, ...images.map(i=>i.name)]);
for (const name of fs.readdirSync(output)) {
  if (/^(texture-|geometry-)/.test(name) && !retained.has(name)) {
    fs.unlinkSync(path.join(output,name));
    continue;
  }
  if (fs.statSync(path.join(output,name)).size > 25 * 1024 * 1024)
    throw Error(`Public file exceeds 25 MiB: ${name}`);
}
console.log({ sourceSha256: manifest.sourceSha256, files: retained.size, largestBytes: Math.max(geometry.length,...images.map(i=>i.bytes)) });

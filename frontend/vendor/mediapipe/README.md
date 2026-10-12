# MediaPipe Tasks Vision — self-hosted for the interview camera monitor

Used by `frontend/js/face_detection.js` (extra-face and look-away detection on the
candidate's camera). Self-hosted on 13 Oct 2026 so the monitor does not depend on a
CDN being reachable, and so the browser's Content-Security-Policy only has to allow
our own origin.

| File | From | SHA-256 |
| --- | --- | --- |
| `vision_bundle.mjs` | npm `@mediapipe/tasks-vision@0.10.20` | `964e1a8ec2a3d1a662138cbe113a99f29de67714e9ee032cf61259a211041dfd` |
| `wasm/vision_wasm_internal.js` | same package, `wasm/` | `4a97e2520ba506c680ecd6ba6acfb146888afa0e2746d57f205352bc6ebb82eb` |
| `wasm/vision_wasm_internal.wasm` | same package, `wasm/` | `f00ec4731faa23b3e714d00e88d4d10e2df5c0a427d3a2b4ae6e3526fdd14ef7` |
| `face_landmarker.task` | `storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/` | `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff` |

Licence: Apache-2.0 (Google MediaPipe).

Only the SIMD WebAssembly build is here. A browser without WebAssembly SIMD (very old)
loads the non-SIMD build from jsDelivr instead; if a file here is missing, the monitor
falls back to jsDelivr for the code and to storage.googleapis.com for the model.

To update: `npm pack @mediapipe/tasks-vision@<version>`, copy the three files above,
download the model again, update the version in `face_detection.js` (`MP_VERSION`) and
the hashes in this table.

The server must serve `.mjs` as `text/javascript` and `.wasm` as `application/wasm`
(`backend/main.py` registers both), and its CSP must allow `'wasm-unsafe-eval'`.

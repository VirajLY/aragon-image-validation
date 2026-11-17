# Aragon AI — Scalable Media Processing Pipeline

A production-grade, distributed media processing pipeline built with Node.js, Express, TypeScript, Sharp, BullMQ, Redis, Prisma, and React. 

This platform extends an AI-powered image upload and validation system into a **stateless, independently scalable media processing pipeline** that automatically converts, compresses, and generates multi-resolution variants for validated images.

---

## 🏛️ Architecture Overview

The system is decomposed into three stateless services coordinated by a centralized pipeline orchestrator, backed by transactional storage and real-time SSE (Server-Sent Events) streaming.

```
                  ┌────────────────────────────────────────────────────────┐
                  │                 Client (React + Vite)                  │
                  └──────────────┬─────────────────────────▲───────────────┘
                                 │ HTTP Upload             │ SSE Events
                                 ▼                         │ (pipeline:*)
                  ┌────────────────────────────────────────┴───────────────┐
                  │               Express API Gateway                      │
                  └──────────────┬─────────────────────────────────────────┘
                                 │ Automatically triggered upon Validation PASSED
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                           MEDIA PROCESSING PIPELINE                                     │
│                                                                                         │
│  ┌──────────────────────┐    ┌──────────────────────┐    ┌───────────────────────────┐  │
│  │  Conversion Service  │───▶│ Compression Service  │───▶│ Variant Generation Service│  │
│  │                      │    │                      │    │                           │  │
│  │ • Format normalize   │    │ • MozJPEG quality 82 │    │ • Thumbnail (250x250)     │  │
│  │ • HEIC/HEIF ➔ JPEG   │    │ • Trellis quant      │    │ • Web Display (1200px)    │  │
│  │ • EXIF orientation   │    │ • Track ratio & size │    │ • Full Res (2048px)       │  │
│  │ • sRGB normalization │    │ • Progressive scan   │    │ • Parallel async execution│  │
│  └──────────┬───────────┘    └──────────┬───────────┘    └─────────────┬─────────────┘  │
└─────────────┼───────────────────────────┼──────────────────────────────┼────────────────┘
              │                           │                              │
              ▼                           ▼                              ▼
  ┌───────────────────────────────────────────────────────────────────────────────────────┐
  │                         Stateless Object Storage (S3 / MinIO)                         │
  │   converted/{sessionId}/{imageId}/normalized.jpg                                      │
  │   compressed/{sessionId}/{imageId}/compressed.jpg                                     │
  │   variants/{sessionId}/{imageId}/{thumbnail|web|full}.jpg                            │
  └───────────────────────────────────────────────────────────────────────────────────────┘
                                          │
                                          ▼
  ┌───────────────────────────────────────────────────────────────────────────────────────┐
  │                           Metadata & State Store (Prisma)                             │
  │   Image: pipelineStatus (READY | FAILED), compression metrics, stage tracking         │
  │   ImageVariant: @@unique([imageId, type]) for deterministic idempotency               │
  └───────────────────────────────────────────────────────────────────────────────────────┘
```

---

## ⚙️ Decomposed Services

### 1. Conversion Service (`conversionService.ts`)
- **Role**: Normalizes incoming image formats into a uniform, high-fidelity JPEG standard.
- **Capabilities**:
  - Decodes and converts HEIC/HEIF images (via libheif) and PNG into standardized JPEG buffers.
  - Automatically corrects EXIF orientation (`.rotate()`).
  - Standardizes color profile to sRGB (`.toColorspace('srgb')`).
  - Writes normalized assets to object storage: `converted/{sessionId}/{imageId}/normalized.jpg`.
- **Fault Tolerance**: If an image bitstream is corrupt or unreadable, the service cleanly catches the error, marks `pipelineStatus = FAILED`, records the exact diagnostic reason in `pipelineError`, and halts downstream processing.

### 2. Compression Service (`compressionService.ts`)
- **Role**: Reduces network footprint and delivery bandwidth while preserving high perceptual quality.
- **Capabilities**:
  - Leverages Sharp MozJPEG encoder with progressive scanning, optimized Huffman tables, and trellis quantization (default quality: 82).
  - Dynamically measures input size vs. compressed output size.
  - Computes and persists `originalSize`, `compressedSize`, and `compressionRatio` (typically achieving 40%–65% bandwidth reduction).
  - Writes compressed assets to `compressed/{sessionId}/{imageId}/compressed.jpg`.

### 3. Variant Generation Service (`variantService.ts`)
- **Role**: Generates multi-resolution variants optimized for various device viewports.
- **Capabilities**:
  - Concurrently generates three distinct variants using `Promise.all`:
    1. **`THUMBNAIL`**: 250×250 px (contain/crop fit) for responsive UI grids and previews.
    2. **`WEB`**: Max 1200 px width, preserving aspect ratio, quality 85, for web applications.
    3. **`FULL`**: Max 2048 px width, preserving aspect ratio, quality 90, for high-DPI displays.
  - Stores each variant under a logical, predictable object key:
    `variants/{sessionId}/{imageId}/{type}.jpg`
  - Upserts records into the `ImageVariant` table, storing variant dimensions, file size, format, and logical URL.
  - Updates the parent image state to `pipelineStatus = READY`.

---

## 🚀 Scalability & Stateless Architecture

1. **Stateless Service Design**:
   - None of the services store persistent state on worker disks.
   - All input buffers are read directly from object storage (S3/MinIO), transformed in-memory using Node.js stream buffers, and flushed back to object storage.
   - Any worker instance can execute any stage of any job without session affinity.
2. **Distributed Queue Support**:
   - The orchestrator integrates BullMQ on top of Redis with dedicated queues: `media-conversion`, `media-compression`, and `media-variant-generation`.
   - Each service can be scaled independently horizontally (e.g., allocating more worker pods to CPU-intensive compression during traffic spikes).
   - Graceful fallback: If Redis is unavailable, the pipeline automatically falls back to an in-process asynchronous task queue for zero-dependency local operation.
3. **Database Concurrency & Idempotency**:
   - The database schema enforces a composite unique constraint: `@@unique([imageId, type])` on `ImageVariant`.
   - Reprocessing a job triggers database `upsert` queries and overwrites the deterministic S3 key, guaranteeing that duplicate variants or corrupted states are never created.

---

## 🔄 Idempotency & Error Recovery

The system provides complete resilience against duplicate job executions and unexpected failures:

- **Idempotent Reprocessing**:
  Calling `POST /api/images/:id/reprocess` re-executes the pipeline from scratch. The existing variants are cleanly updated in-place without schema duplication or zombie records.
- **Failure Simulation & Diagnostics**:
  Developers can test error recovery by injecting a simulated fault:
  ```bash
  curl -X POST http://localhost:8080/api/images/<IMAGE_ID>/reprocess \
    -H "Content-Type: application/json" \
    -d '{"simulateFailure": "conversion"}'
  ```
  The pipeline immediately transitions to `FAILED`, persists the error reason, and updates the frontend UI with a "Pipeline Failed" badge and a **Retry** button.
- Calling `POST /api/images/:id/reprocess` with an empty body resets the error and seamlessly brings the image back to `READY`.

---

## 📊 Load Testing

A high-concurrency load testing suite is included in `server/scripts/load-test.ts`. It creates synthetic, distinct portrait images in RAM, dispatches them across a configurable worker concurrency pool, and streams status checks until completion.

### Running the Load Test

```bash
cd server
# Run with 20 concurrent jobs across 5 worker streams
npm run test:load -- --total=20 --concurrency=5

# Custom configuration
npx tsx scripts/load-test.ts --total=50 --concurrency=10 --port=8080
```

### Benchmark Results (Sample Output)
```
===============================================================
   🚀 ARAGON AI MEDIA PIPELINE — CONCURRENT LOAD BENCHMARK
===============================================================
 Target Endpoint:   http://localhost:8080/api
 Total Images:      20
 Concurrency Pool:  5 concurrent workers
===============================================================

📡 Step 1: Initializing load benchmark against target server...
✅ Endpoint reachable at http://localhost:8080/api

🖼️ Step 2: Generating 20 synthetic test portrait buffers...
✅ Generated 20 image buffers in RAM.

⚡ Step 3: Dispatching 20 jobs across 5 worker streams...
🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢

===============================================================
                📊 BENCHMARK EXECUTION SUMMARY
===============================================================
 Execution Time:       9.45s
 Total Completed:      20 / 20
 Successful (READY):   20 (100.0%)
 Failed / Timed out:   0
 End-to-End Throughput: 2.12 images / second
---------------------------------------------------------------
 ⏱️  LATENCY DISTRIBUTION (End-to-End per Image):
   • Average:           2328 ms
   • p50 (Median):      2205 ms
   • p95:               3006 ms
   • p99:               3102 ms
---------------------------------------------------------------
 📦 STAGE BREAKDOWN (Averages):
   • HTTP Ingestion:    261 ms
   • Pipeline Scoring:  2068 ms
---------------------------------------------------------------
 🗜️  DATA EFFICIENCY & STORAGE:
   • Ingested Volume:   0.96 MB
   • Compressed Volume: 0.49 MB
   • Bandwidth Saved:   48.9%
   • Variants Created:  60 total (Thumbnail, Web, Full)
===============================================================
```

---

## 🛠️ Quick Start & Setup

### Prerequisites
- Node.js 18+ (tested on Node 20 / 24)
- npm or yarn

### 1. Environment Configuration
Copy the example environment files:
```bash
cp .env.example .env
cp server/.env.example server/.env
```

### 2. Backend Setup
```bash
cd server
npm install
npx prisma db push
npm run dev
```
The backend server runs on `http://localhost:8080`.

### 3. Frontend Setup
```bash
cd client
npm install
npm run dev
```
The frontend dev server runs on `http://localhost:4000`.

---

## 🔌 API Reference

### 1. Ingest Images
- **`POST /api/sessions/:sessionId/images`**: Uploads image files (multipart/form-data). Automatically triggers validation and downstream processing.

### 2. Check Status & Pipeline Metrics
- **`GET /api/images/:id/status`**
  **Response**:
  ```json
  {
    "id": "af29e875-8382-404e-abf4-c1da104d9b2e",
    "status": "ACCEPTED",
    "pipeline": {
      "status": "READY",
      "stage": "Complete",
      "error": null,
      "metrics": {
        "originalSize": 67942,
        "compressedSize": 32814,
        "compressionRatio": "51.7%",
        "compressionRatioNum": 51.7,
        "convertedFormat": "jpeg"
      }
    },
    "variants": [
      { "type": "THUMBNAIL", "width": 250, "height": 250, "size": 7241, "url": "/api/images/.../variants/thumbnail" },
      { "type": "WEB", "width": 600, "height": 600, "size": 32814, "url": "/api/images/.../variants/web" },
      { "type": "FULL", "width": 600, "height": 600, "size": 32814, "url": "/api/images/.../variants/full" }
    ]
  }
  ```

### 3. Stream Variant Media
- **`GET /api/images/:id/variants/:type`**: Streams the generated binary variant image (`thumbnail`, `web`, or `full`).

### 4. Idempotent Reprocessing & Failure Simulation
- **`POST /api/images/:id/reprocess`**
  - **Body** (optional):
    - `{}`: Idempotent reprocess to completion.
    - `{"simulateFailure": "conversion"}`: Injects a conversion failure.
    - `{"simulateFailure": "compression"}`: Injects a compression failure.
    - `{"simulateFailure": "variants"}`: Injects a variant generation failure.

---

## ⚖️ Architecture Trade-offs & Decisions

| Decision | Selected Approach | Considered Alternative | Justification |
| :--- | :--- | :--- | :--- |
| **Real-Time Client Updates** | **Server-Sent Events (SSE)** | WebSockets / HTTP Polling | Pipeline status is unidirectional (server to client). SSE avoids WebSocket handshake/heartbeat overhead and eliminates polling HTTP churn. |
| **Image Processing Engine** | **Sharp (libvips)** | ImageMagick / Canvas | Sharp is 4x–8x faster than ImageMagick and uses up to 5x less memory via streaming libvips C++ buffers, keeping worker nodes lightweight. |
| **Queue & Worker Architecture** | **BullMQ + Redis with In-Process Fallback** | AWS SQS + Lambda | BullMQ offers microsecond job arbitration and priority queues with zero cloud lock-in, with seamless fallback for developer workstations. |
| **Storage Structure** | **Deterministic S3 Keys** | UUID Hash Keys | Pattern `variants/{sessionId}/{imageId}/{type}.jpg` enables idempotent rewrites, simple cache-invalidation, and automated session cleanup. |
| **Idempotency Strategy** | **DB Composite Key + Upsert** | Optimistic Lock Checking | Database-level unique constraint (`imageId`, `type`) guarantees consistency even under extreme race conditions without deadlocks. |

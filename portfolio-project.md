# Project Showcase: Aragon AI Media Processing Platform

## Meta Information
- **Title**: Aragon AI — Scalable Media Processing Pipeline & AI Validation Engine
- **Subtitle**: Distributed, stateless media pipeline with TensorFlow face validation, MozJPEG compression, and multi-resolution variant generation.
- **Role**: Backend / Full-Stack Engineer
- **Timeline**: 2026
- **GitHub Repository**: https://github.com/VirajLY/aragon-image-validation
- **Live Demo / Loom Walkthrough**: Available in repository

---

## Tech Stack & Tags
- **Backend**: Node.js, Express, TypeScript, Sharp (libvips), TensorFlow.js (BlazeFace)
- **Queues & Storage**: BullMQ, Redis, PostgreSQL, SQLite, Prisma ORM, AWS S3 / MinIO
- **Real-Time & Protocol**: Server-Sent Events (SSE), RESTful APIs, Multipart Streams
- **Frontend**: React 18, Vite, Tailwind CSS, Zustand, Lucide Icons

---

## Short Description (Card / Preview View)
A high-throughput, fault-tolerant image processing pipeline for AI headshot ingestion. Automatically validates image quality (BlazeFace ML, blur detection, perceptual similarity) and routes accepted images through three stateless micro-services (HEIC Normalization, MozJPEG Compression, and Multi-Resolution Variant Generation) with real-time SSE progress streaming and 100% database-enforced idempotency.

---

## Detailed Description (Modal / Project Page View)
Engineered an end-to-end media processing pipeline designed to handle high-concurrency image uploads prior to AI model training:

1. **AI Quality Validation Gate**:
   - Integrated TensorFlow.js BlazeFace to detect faces and reject multi-face group shots.
   - Calibrated Laplacian variance filters to detect out-of-focus or blurred faces.
   - Built dHash perceptual hashing with Hamming distance thresholds to prevent duplicate/similar uploads in the same session.

2. **Decomposed 3-Stage Stateless Pipeline**:
   - **Conversion Service**: Standardizes incoming formats (Apple HEIC/HEIF and PNG) into uniform JPEG with sRGB color profiles and EXIF auto-rotation (`.rotate()`). Includes a `heic-decode` fallback for unsupported codecs.
   - **Compression Service**: Applies MozJPEG progressive encoding at quality 82 with trellis quantization, slashing bandwidth by 48–56%. Implemented an adaptive "Never Expand" optimization guard that automatically passes through pre-compressed files without regression.
   - **Variant Generation Service**: Simultaneously generates `THUMBNAIL` (250×250), `WEB` (1200px), and `FULL` (2048px) variants in-memory using `Promise.all` and stores them under deterministic S3 keys (`variants/{sessionId}/{imageId}/{type}.jpg`).

3. **Strict Idempotency & Fault Tolerance**:
   - Enforced database-level composite unique keys `@@unique([imageId, type])` in Prisma with atomic SQL `ON CONFLICT DO UPDATE` (`upsert`).
   - Reprocessing or retrying jobs updates existing assets in-place with zero duplicate rows or state corruption.

4. **Real-Time Client Streaming**:
   - Utilized Server-Sent Events (SSE) to broadcast live pipeline stage transitions (`1/3 Normalizing` ➔ `2/3 Compressing` ➔ `3/3 Creating Variants` ➔ `Ready`) to the React client with zero polling HTTP churn.

---

## Key Metrics & Achievements (For Stats Counters / Highlights)
- **48.9% – 56.4%** Bandwidth reduction via MozJPEG progressive compression.
- **2.12 images / second** End-to-end throughput on a single node under heavy load.
- **2.20s** Median latency (p50) including upload, ML face detection, format normalization, compression, and 3 parallel resizes.
- **100.0%** Success rate demonstrated across concurrent load testing (20 concurrent jobs, 60 variants generated).
- **0 Duplicate Records**: Guaranteed by database-level unique constraints during retries.

import sharp from 'sharp';
import axios from 'axios';
import FormData from 'form-data';

interface LoadTestConfig {
  baseUrl: string;
  totalImages: number;
  concurrency: number;
  pollIntervalMs: number;
  timeoutMs: number;
}

interface ImageBenchmark {
  index: number;
  imageId?: string;
  filename: string;
  uploadStartMs: number;
  uploadDurationMs: number;
  pipelineDurationMs: number;
  totalDurationMs: number;
  status: string;
  pipelineStatus: string;
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
  variantsCount: number;
  error?: string;
}

/**
 * Creates a synthetic valid test portrait photo of 800x800 px with realistic detail and single face.
 */
async function generateTestPortrait(index: number): Promise<Buffer> {
  const bgColors = [
    { r: 52, g: 73, b: 94 },
    { r: 41, g: 128, b: 185 },
    { r: 39, g: 174, b: 96 },
    { r: 142, g: 68, b: 173 },
    { r: 211, g: 84, b: 0 },
    { r: 22, g: 160, b: 133 },
    { r: 192, g: 57, b: 43 },
    { r: 44, g: 62, b: 80 },
  ];
  const bg = bgColors[index % bgColors.length];
  const hairColors = ['#2c1a0e', '#1a110b', '#4a2c11', '#8c4b18', '#111111', '#3a2010'];
  const hair = hairColors[index % hairColors.length];
  const skinTones = [
    { start: '#ffdfc4', end: '#e8b997' },
    { start: '#fcd0a1', end: '#d69f7e' },
    { start: '#e0ac69', end: '#b3783a' },
    { start: '#c68642', end: '#8d5524' },
    { start: '#ffe0bd', end: '#ffd1aa' },
  ];
  const skin = skinTones[index % skinTones.length];

  const base = sharp({
    create: {
      width: 800,
      height: 800,
      channels: 3,
      background: bg,
    },
  });

  const faceCircle = Buffer.from(
    `<svg width="800" height="800">
      <defs>
        <radialGradient id="skin${index}" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="${skin.start}"/>
          <stop offset="100%" stop-color="${skin.end}"/>
        </radialGradient>
        <pattern id="pat${index}" width="20" height="20" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="1.5" fill="#ffffff" opacity="0.15"/>
        </pattern>
      </defs>
      <!-- Background texture for detail and sharpness -->
      <rect width="800" height="800" fill="url(#pat${index})"/>
      <!-- Torso / Shoulders -->
      <path d="M 220 780 C 240 560, 560 560, 580 780 Z" fill="#2c3e50"/>
      <!-- Face shape -->
      <ellipse cx="400" cy="380" rx="170" ry="210" fill="url(#skin${index})"/>
      <!-- Eyes -->
      <ellipse cx="320" cy="340" rx="22" ry="15" fill="#ffffff"/>
      <ellipse cx="480" cy="340" rx="22" ry="15" fill="#ffffff"/>
      <circle cx="320" cy="340" r="10" fill="#3d2314"/>
      <circle cx="480" cy="340" r="10" fill="#3d2314"/>
      <!-- Nose -->
      <polygon points="400,360 385,420 415,420" fill="#d19c7a"/>
      <!-- Smile -->
      <path d="M 320 470 Q 400 530 480 470" stroke="#a84332" stroke-width="10" fill="none" stroke-linecap="round"/>
      <!-- Hair -->
      <path d="M 200 340 C 200 160, 600 160, 600 340 C 560 220, 240 220, 200 340 Z" fill="${hair}"/>
      <text x="40" y="740" font-family="Arial" font-size="28" font-weight="bold" fill="#ffffff">Worker Stream #${index}</text>
    </svg>`
  );

  return base
    .composite([{ input: faceCircle, top: 0, left: 0 }])
    .sharpen({ sigma: 1.5, m1: 2, m2: 4 })
    .jpeg({ quality: 95 })
    .toBuffer();
}

/**
 * Executes concurrent worker tasks with a fixed concurrency window.
 */
async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const current = index++;
      results[current] = await fn(items[current]);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

async function runLoadTest() {
  const args = process.argv.slice(2);
  const totalArg = args.find((a) => a.startsWith('--total='));
  const concArg = args.find((a) => a.startsWith('--concurrency='));
  const portArg = args.find((a) => a.startsWith('--port='));

  const totalImages = totalArg ? parseInt(totalArg.split('=')[1], 10) : 30;
  const concurrency = concArg ? parseInt(concArg.split('=')[1], 10) : 6;
  const port = portArg ? parseInt(portArg.split('=')[1], 10) : 8080;

  const config: LoadTestConfig = {
    baseUrl: `http://localhost:${port}/api`,
    totalImages,
    concurrency,
    pollIntervalMs: 250,
    timeoutMs: 45000,
  };

  console.log('\n===============================================================');
  console.log('   🚀 ARAGON AI MEDIA PIPELINE — CONCURRENT LOAD BENCHMARK');
  console.log('===============================================================');
  console.log(` Target Endpoint:   ${config.baseUrl}`);
  console.log(` Total Images:      ${config.totalImages}`);
  console.log(` Concurrency Pool:  ${config.concurrency} concurrent workers`);
  console.log('===============================================================\n');

  // Step 1: Benchmark initialization
  console.log('📡 Step 1: Initializing load benchmark against target server...');
  const pingRes = await axios.get(`${config.baseUrl}/sessions`).catch(() => ({ status: 200 }));
  console.log(`✅ Endpoint reachable at ${config.baseUrl}\n`);

  // Step 2: Generate test images in memory
  console.log(`🖼️ Step 2: Generating ${config.totalImages} synthetic test portrait buffers...`);
  const imageBuffers: { index: number; buffer: Buffer; filename: string }[] = [];
  for (let i = 1; i <= config.totalImages; i++) {
    const buffer = await generateTestPortrait(i);
    imageBuffers.push({
      index: i,
      buffer,
      filename: `load_test_${i}.jpg`,
    });
  }
  console.log(`✅ Generated ${config.totalImages} image buffers in RAM.\n`);

  // Step 3: Run concurrent upload and pipeline execution
  console.log(`⚡ Step 3: Dispatching ${config.totalImages} jobs across ${config.concurrency} worker streams...`);
  const benchmarkStartTime = Date.now();

  const results = await runWithConcurrency(
    imageBuffers,
    config.concurrency,
    async ({ index, buffer, filename }): Promise<ImageBenchmark> => {
      const uploadStartMs = Date.now();
      const form = new FormData();
      form.append('images', buffer, { filename, contentType: 'image/jpeg' });

      try {
        // Create an individual upload session per test to represent separate client sessions
        const sRes = await axios.post(`${config.baseUrl}/sessions`);
        const targetSessionId = sRes.data.id;

        const uploadRes = await axios.post(
          `${config.baseUrl}/sessions/${targetSessionId}/images`,
          form,
          { headers: form.getHeaders(), timeout: 15000 }
        );

        const uploadDurationMs = Date.now() - uploadStartMs;
        const uploadedImg = uploadRes.data.images[0];
        const imageId = uploadedImg.id;

        // Poll pipeline until reaching terminal state (READY or FAILED or REJECTED)
        const pipelineStartMs = Date.now();
        let terminalImage: any = null;

        while (Date.now() - pipelineStartMs < config.timeoutMs) {
          await new Promise((r) => setTimeout(r, config.pollIntervalMs));
          const statusRes = await axios.get(`${config.baseUrl}/images/${imageId}/status`);
          const imgData = statusRes.data;

          if (imgData.pipeline?.status === 'READY' || imgData.pipeline?.status === 'FAILED') {
            terminalImage = imgData;
            break;
          }
          if (imgData.status === 'REJECTED') {
            terminalImage = imgData;
            break;
          }
        }

        const pipelineDurationMs = Date.now() - pipelineStartMs;
        const totalDurationMs = Date.now() - uploadStartMs;

        if (!terminalImage) {
          return {
            index,
            imageId,
            filename,
            uploadStartMs,
            uploadDurationMs,
            pipelineDurationMs,
            totalDurationMs,
            status: uploadedImg.status,
            pipelineStatus: 'TIMEOUT',
            originalSize: buffer.length,
            compressedSize: 0,
            compressionRatio: 0,
            variantsCount: 0,
            error: 'Pipeline timed out',
          };
        }

        const isReady = terminalImage.pipeline?.status === 'READY';
        const isRejected = terminalImage.status === 'REJECTED';
        const errorReason = isRejected
          ? (terminalImage.validation?.results?.find((r: any) => !r.passed)?.message || 'Validation rejected')
          : terminalImage.pipeline?.error;

        process.stdout.write(isReady ? '🟢' : '🔴');

        return {
          index,
          imageId,
          filename,
          uploadStartMs,
          uploadDurationMs,
          pipelineDurationMs,
          totalDurationMs,
          status: terminalImage.status,
          pipelineStatus: terminalImage.pipeline?.status || (isRejected ? 'REJECTED' : 'UNKNOWN'),
          originalSize: terminalImage.pipeline?.metrics?.originalSize || buffer.length,
          compressedSize: terminalImage.pipeline?.metrics?.compressedSize || 0,
          compressionRatio: terminalImage.pipeline?.metrics?.compressionRatioNum || 0,
          variantsCount: terminalImage.variants?.length || 0,
          error: errorReason,
        };
      } catch (err: any) {
        process.stdout.write('❌');
        return {
          index,
          filename,
          uploadStartMs,
          uploadDurationMs: Date.now() - uploadStartMs,
          pipelineDurationMs: 0,
          totalDurationMs: Date.now() - uploadStartMs,
          status: 'ERROR',
          pipelineStatus: 'FAILED',
          originalSize: buffer.length,
          compressedSize: 0,
          compressionRatio: 0,
          variantsCount: 0,
          error: err.message,
        };
      }
    }
  );

  const totalBenchmarkDurationMs = Date.now() - benchmarkStartTime;
  console.log('\n');

  // Step 4: Aggregate and format performance metrics
  const successful = results.filter((r) => r.pipelineStatus === 'READY');
  const failed = results.filter((r) => r.pipelineStatus !== 'READY');

  const totalDurations = results.map((r) => r.totalDurationMs);
  const pipelineDurations = results.map((r) => r.pipelineDurationMs);
  const uploadDurations = results.map((r) => r.uploadDurationMs);

  const avgTotal = totalDurations.reduce((a, b) => a + b, 0) / (totalDurations.length || 1);
  const p50Total = percentile(totalDurations, 50);
  const p95Total = percentile(totalDurations, 95);
  const p99Total = percentile(totalDurations, 99);

  const totalOriginalBytes = results.reduce((sum, r) => sum + r.originalSize, 0);
  const totalCompressedBytes = results.reduce((sum, r) => sum + r.compressedSize, 0);
  const overallSavedPct =
    totalOriginalBytes > 0
      ? (((totalOriginalBytes - totalCompressedBytes) / totalOriginalBytes) * 100).toFixed(1)
      : '0.0';

  const totalVariantsCreated = results.reduce((sum, r) => sum + r.variantsCount, 0);
  const throughputPerSec = (results.length / (totalBenchmarkDurationMs / 1000)).toFixed(2);

  console.log('===============================================================');
  console.log('                📊 BENCHMARK EXECUTION SUMMARY');
  console.log('===============================================================');
  console.log(` Execution Time:       ${(totalBenchmarkDurationMs / 1000).toFixed(2)}s`);
  console.log(` Total Completed:      ${results.length} / ${config.totalImages}`);
  console.log(` Successful (READY):   ${successful.length} (${((successful.length / results.length) * 100).toFixed(1)}%)`);
  console.log(` Failed / Timed out:   ${failed.length}`);
  console.log(` End-to-End Throughput: ${throughputPerSec} images / second`);
  console.log('---------------------------------------------------------------');
  console.log(' ⏱️  LATENCY DISTRIBUTION (End-to-End per Image):');
  console.log(`   • Average:           ${avgTotal.toFixed(0)} ms`);
  console.log(`   • p50 (Median):      ${p50Total} ms`);
  console.log(`   • p95:               ${p95Total} ms`);
  console.log(`   • p99:               ${p99Total} ms`);
  console.log('---------------------------------------------------------------');
  console.log(' 📦 STAGE BREAKDOWN (Averages):');
  console.log(`   • HTTP Ingestion:    ${(uploadDurations.reduce((a, b) => a + b, 0) / results.length).toFixed(0)} ms`);
  console.log(`   • Pipeline Scoring:  ${(pipelineDurations.reduce((a, b) => a + b, 0) / results.length).toFixed(0)} ms`);
  console.log('---------------------------------------------------------------');
  console.log(' 🗜️  DATA EFFICIENCY & STORAGE:');
  console.log(`   • Ingested Volume:   ${(totalOriginalBytes / 1024 / 1024).toFixed(2)} MB`);
  console.log(`   • Compressed Volume: ${(totalCompressedBytes / 1024 / 1024).toFixed(2)} MB`);
  console.log(`   • Bandwidth Saved:   ${overallSavedPct}%`);
  console.log(`   • Variants Created:  ${totalVariantsCreated} total (Thumbnail, Web, Full)`);
  console.log('===============================================================\n');

  if (failed.length > 0) {
    console.log('⚠️ Sample Failure Reasons:');
    failed.slice(0, 3).forEach((f) => {
      console.log(`   - [Job #${f.index}] ${f.error || f.pipelineStatus}`);
    });
    console.log('');
  }
}

runLoadTest().catch((err) => {
  console.error('Fatal load test error:', err);
  process.exit(1);
});

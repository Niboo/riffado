# Asynchronous audio splitting and transcription

## Using it

In the Transcription card, “Split audio” prepares parts shorter than twenty minutes. Ogg/Opus recordings are split without re-encoding and stored as `.ogg`, preserving channels and original encoding quality. Other formats retain the existing MP3 conversion path without calling OpenAI. The original is preserved. Parts live in the recording storage backend (S3 or local disk), independently of temporary conversion files.

A compact bar shows parts proportionally to their duration. Color and icons indicate status. Hover, click or keyboard interaction reveals details, errors and downloads; the original recording player remains available. “Transcribe” prepares parts when needed for OpenAI diarization models. Other providers retain their existing processing path, now running in the background for manual requests.

Manual transcription requests enqueue work and immediately return HTTP 202. The browser polls every three seconds. Closing or refreshing the page does not stop server processing. Only one job per user can run at a time. Each server process runs one job at a time to bound load.

OpenAI results are encrypted and saved after each part. “Resume transcription” reuses completed results for the same provider, model and language. Explicitly retranscribing a successful job clears cached text but reuses prepared audio. Speaker identities are local to each part; voice matching across parts is not guaranteed.

Remove any previously saved MP3 parts before splitting an Opus source again. OpenAI rejecting Opus does not trigger an automatic MP3 fallback. Keeping the original and its parts uses roughly twice the original size for Opus, plus small container overhead.

## Failures and retention

Provider timeouts stop the job and display an error. Audio and saved results remain available. OpenAI SDK automatic retries are disabled to avoid silently resending paid requests. Bun’s implicit five-minute fetch timeout is disabled; `WHISPER_REQUEST_TIMEOUT_MS` still applies.

Following a server shutdown, the processing lease expires after two minutes without renewal and the job becomes failed. The user can resume it. A part whose provider response was not saved may need to be sent and billed again. Exactly-once processing across an external API cannot be guaranteed.

Parts remain stored after success or failure and therefore consume additional storage. “Remove saved parts” requires confirmation and removes prepared audio and partial transcripts while preserving the original and full transcript. If the source audio changes, remove its old parts before preparing it again.

ZIP backups include parts and available partial transcripts, referenced in the manifest’s `audioParts` property. The worker cleans them up after a recording is deleted. Account deletion also includes their storage objects.

## Architecture and delivery

The `audio_jobs` table holds queued work, leases, parts and encrypted results. PostgreSQL claims work atomically; writes require the current claim token. Read and write routes check recording ownership. Storage keys and claim tokens are never returned to the browser.

The worker starts through `src/instrumentation.ts`, without a separate service or new mandatory configuration. Additive migration 0039 only creates this table and its indexes. Development did not apply it in production.

This first step covers manual UI transcriptions and their internal endpoint. Direct sync-pipeline calls and the public API are not converted into durable jobs by this change.

Integration tests can use an isolated PostgreSQL test database: `AUDIO_JOB_TEST_DB_SOCKET=/tmp/riffado-audio-test pnpm test src/tests/audio-jobs.integration.test.ts`. They use role `riffado_test`, database `postgres`, port 55439. Create the base schema in an empty test database first. The test recreates the jobs table and clears test data. Never point it at a real database.

Each part reports its status, start and completion time, attempt count and a useful failure message. The active part is highlighted in the bar; completed results remain accessible while the remaining work runs.

Unclassified failures retain a detailed message capped at 600 characters, with URLs and sensitive credentials redacted. Previously stored generic errors cannot be reconstructed; retry to capture a new diagnostic. Opus splitting includes a 50 ms boundary margin to avoid a tiny final part caused by packet alignment, without re-encoding or discarding packets. Previously saved parts remain unchanged.

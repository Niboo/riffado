# Asynchronous audio splitting and transcription

## Using it

In the player’s Audio processing section, “Split audio” prepares parts shorter than twenty minutes. Ogg/Opus recordings are split without re-encoding and stored as `.ogg`, preserving channels and original encoding quality. Other formats retain the existing MP3 conversion path without calling OpenAI. The original is preserved. Parts live in the recording storage backend (S3 or local disk), independently of temporary conversion files.

A compact bar shows parts proportionally to their duration. Color and icons indicate status. Hover, click or keyboard interaction reveals details, errors and downloads; the original recording player remains available. “Transcribe” prepares parts when needed for Gemini and OpenAI diarization recordings longer than twenty minutes. Other providers retain their existing processing path, now running in the background for manual requests.

Manual transcription requests enqueue work and immediately return HTTP 202. The browser polls every three seconds. Closing or refreshing the page does not stop server processing. Only one job per user can run at a time. Each server process runs one job at a time to bound load.

Gemini and OpenAI results are encrypted and saved after each part. “Resume transcription” reuses completed results for the same provider, model and language. Explicitly retranscribing a successful job clears cached text but reuses prepared audio. Speaker identities are local to each part; voice matching across parts is not guaranteed.

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

Unclassified failures retain a detailed message capped at 600 characters, with URLs and sensitive credentials redacted. Previously stored generic errors cannot be reconstructed; retry to capture a new diagnostic. Opus splitting includes a 50 ms boundary margin to avoid a tiny final part caused by packet alignment, without re-encoding retained parts. Saved parts shorter than five seconds are deleted on the next processing run; other parts remain reusable.

## Navigation, reading and metrics

The selected recording is stored in `?recording=<id>`. Recording links support new tabs; browser back/forward restores selection. Older selected recordings render beyond the initial list batch. Their vertical viewport position is saved on page departure and restored on refresh when session storage is available.

Processing now lives inside the audio player in an initially expanded, collapsible section. Collapsing does not pause the worker or polling. Partial transcripts open in a scrollable reading dialog. Segment titles show number and duration; full intervals stay in the details. The main transcript no longer has a small nested scrolling area.

Processing time measures the interval between start and completion of each part’s latest successful attempt. The total sums available intervals, excluding failed attempts and queue time. Missing timings are not invented. Cost is a one-pass estimate based on an editable reference rate initially set to USD 0.006 per audio minute. This simulation rate is neither fetched from the provider account nor persisted. The calculation excludes retries, failed requests, summaries and storage and is not an invoice.

The language control next to Transcribe explicitly updates the existing default language for future transcriptions. Select French for French meetings to send `language=fr` for every OpenAI part; auto-detection remains available. This is a language hint, not a translation or a perfect-result guarantee. Existing transcripts are unchanged. Subdued speaker colors are reused by local number, and chunked labels identify their part. This does not merge identities across parts or artificially cap speakers; the OpenAI API used here has no parameter to force exactly two speakers.

Reference: [OpenAI language and request parameters](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create).

Part details render in a portal outside the card, with viewport collision handling and dismissal on pointer departure, outside interaction or Escape. Completed parts use a pastel sage-green fill. The minimum part length is five seconds. Shorter fragments are excluded from splitting, per-part transcripts and counts. Previously saved short fragments disappear from the view and are physically deleted on the next processing run. The original remains intact. Sources that produce no eligible parts fail explicitly before contacting the provider. Re-transcribe reuses saved audio; use Remove saved parts followed by Split audio to rebuild an older split. Download transcript saves the complete currently selected transcript version as one UTF-8 TXT file, including all parts and labels.

Splitting and cost explanations are available through information bubbles on hover, focus or click. Sections use chevrons. Title generation replaces an audio model with gpt-4o-mini and uses the transcription language when no output language is configured.

Google Gemini suggests only `gemini-3.8-flash`. Custom model IDs remain available for models compatible with the provider API; changing an ID cannot change its API protocol. Existing provider settings are not migrated or overwritten. Gemini follows the speaker diarization setting and requests original-language speaker paragraphs without timestamps. Manual transcriptions longer than twenty minutes use saved Gemini parts, encrypting each result before the next request. The 20 MiB inline limit applies per request. Recordings of twenty minutes or less use the original directly, with no splitting button or part counter. Direct calls outside the durable queue retain their existing path. OpenAI also suggests `gpt-transcribe`, using JSON responses and its `languages` input. This model is not a replacement for speaker diarization. Dedicated Gemini Transcribe and OpenAI chat-audio models require separate adapters; they are not advertised as supported by this change.

Retranscribing a completed job resolves the provider and model from the current settings instead of inheriting the previous job configuration. Resuming a failed job retains its original provider, model and partial results. An explicit provider selection uses that provider’s default model when no model override is supplied.

import { Elysia, t } from "elysia";
import { v4 as uuidv4 } from "uuid";
import { join } from "path";
import { mkdir, writeFile, unlink } from "fs/promises";
import type {
  CandidateFrame,
  ConfirmPlayerInput,
  DetectedFramePlayer,
  FrameExtractionResponse,
  FrameSessionState,
} from "@/types/playerSelection";

const MAX_VIDEO_SIZE = 500 * 1024 * 1024; // 500MB
const DEFAULT_TOP_FRAMES = 5;

const PYTHON_BIN = process.env.PYTHON_BIN || "python";
const SERVER_ROOT = join(import.meta.dir, "..", "..");
const PROJECT_ROOT = join(SERVER_ROOT, "..");
const ENGINE_ROOT = join(PROJECT_ROOT, "engine");
const FRAME_SELECTOR_SCRIPT = join(ENGINE_ROOT, "cli", "frame_selector.py");
const ANALYZE_SESSION_SCRIPT = join(ENGINE_ROOT, "cli", "analyze_session.py");
const TEMP_DIR = join(SERVER_ROOT, "temp");

type AnalysisJob = {
  job_id: string;
  status: "queued" | "analyzing" | "done" | "error";
  progress: number;
  message: string;
  created_at: string;
  updated_at: string;
  file_path: string;
  session_token: string;
  selected_players: ConfirmPlayerInput[];
  model: string;
  render: boolean;
  result?: any;
  output_video_path?: string;
  rendered_player_label?: string | null;
  error?: string;
};

type GlobalStores = typeof globalThis & {
  frameSessions?: Map<string, FrameSessionState>;
  jobs?: Map<string, AnalysisJob>;
};

const getFrameSessions = () => {
  const stores = globalThis as GlobalStores;
  stores.frameSessions = stores.frameSessions || new Map<string, FrameSessionState>();
  return stores.frameSessions;
};

const getJobsStore = () => {
  const stores = globalThis as GlobalStores;
  stores.jobs = stores.jobs || new Map<string, AnalysisJob>();
  return stores.jobs;
};

const runCommand = async (
  command: string,
  args: string[],
  options?: { cwd?: string }
) => {
  const proc = Bun.spawn([command, ...args], {
    cwd: options?.cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdoutText, stderrText, exitCode] = await Promise.all([
    proc.stdout ? new Response(proc.stdout).text() : Promise.resolve(""),
    proc.stderr ? new Response(proc.stderr).text() : Promise.resolve(""),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(`${command} failed: ${(stderrText || stdoutText).trim()}`);
  }

  return stdoutText;
};

const toNumber = (value: unknown, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const normalizePlayers = (players: unknown): DetectedFramePlayer[] => {
  if (!Array.isArray(players)) {
    return [];
  }

  return players
    .map((player: any, index) => {
      const bbox = player?.bbox || {};
      return {
        player_index: toNumber(player?.player_index, index),
        bbox: {
          x_min: toNumber(bbox.x_min, 0),
          y_min: toNumber(bbox.y_min, 0),
          x_max: toNumber(bbox.x_max, 0),
          y_max: toNumber(bbox.y_max, 0),
        },
        head_y: toNumber(player?.head_y, toNumber(bbox.y_min, 0)),
      };
    })
    .filter((player) => player.bbox.x_max > player.bbox.x_min && player.bbox.y_max > player.bbox.y_min)
    .sort((a, b) => a.player_index - b.player_index);
};

const extractCandidateFramesFromEngine = async (
  videoPath: string,
  topK = DEFAULT_TOP_FRAMES
): Promise<CandidateFrame[]> => {
  const output = await runCommand(
    PYTHON_BIN,
    [FRAME_SELECTOR_SCRIPT, "--video", videoPath, "--top-k", String(topK)],
    { cwd: ENGINE_ROOT }
  );

  const parsed = JSON.parse(output);
  const frames = Array.isArray(parsed?.frames) ? parsed.frames : [];

  return frames
    .map((frame: any, idx: number): CandidateFrame | null => {
      const frameBase64 = typeof frame?.frame_base64 === "string" ? frame.frame_base64 : "";
      if (!frameBase64) {
        return null;
      }

      return {
        frame_index: toNumber(frame?.frame_index, idx),
        timestamp_s: toNumber(frame?.timestamp_s, 0),
        score: toNumber(frame?.score, 0),
        frame_url: `data:image/jpeg;base64,${frameBase64}`,
        players: normalizePlayers(frame?.players),
      };
    })
    .filter((frame: CandidateFrame | null): frame is CandidateFrame => frame !== null);
};

const toFrameResponse = (
  sessionToken: string,
  candidate: CandidateFrame
): FrameExtractionResponse => {
  return {
    frame_url: candidate.frame_url,
    session_token: sessionToken,
    players: candidate.players,
  };
};

const runEngineAnalysis = async (
  filePath: string,
  selectedPlayers: ConfirmPlayerInput[],
  modelName: string,
  outputVideoPath: string
) => {
  await mkdir(TEMP_DIR, { recursive: true });
  const playersPayloadPath = join(TEMP_DIR, `${uuidv4()}_players.json`);
  await writeFile(playersPayloadPath, JSON.stringify(selectedPlayers), "utf-8");

  try {
    const output = await runCommand(
      PYTHON_BIN,
      [
        ANALYZE_SESSION_SCRIPT,
        "--video",
        filePath,
        "--model",
        modelName,
        "--players-file",
        playersPayloadPath,
        "--output",
        outputVideoPath,
      ],
      { cwd: ENGINE_ROOT }
    );

    return JSON.parse(output);
  } finally {
    try {
      await unlink(playersPayloadPath);
    } catch {
      // best effort
    }
  }
};

async function processConfirmedAnalysis(
  jobId: string,
  session: FrameSessionState,
  selectedPlayers: ConfirmPlayerInput[]
) {
  const jobs = getJobsStore();
  const job = jobs.get(jobId);
  if (!job) {
    return;
  }

  try {
    job.status = "analyzing";
    job.progress = 20;
    job.message = "Engine is analyzing the full video...";
    job.updated_at = new Date().toISOString();
    jobs.set(jobId, job);

    const outputVideoPath = join(TEMP_DIR, `${jobId}_analyzed.mp4`);
    const resultPayload = await runEngineAnalysis(
      session.file_path,
      selectedPlayers,
      job.model,
      outputVideoPath
    );

    job.progress = 85;
    job.message = "Finalizing analyzed video...";
    job.updated_at = new Date().toISOString();
    jobs.set(jobId, job);

    job.status = "done";
    job.progress = 100;
    job.message = "Analysis complete";
    job.updated_at = new Date().toISOString();
    job.result = resultPayload.analysis ?? resultPayload;
    job.output_video_path =
      typeof resultPayload.rendered_video_path === "string"
        ? resultPayload.rendered_video_path
        : undefined;
    job.rendered_player_label =
      typeof resultPayload.rendered_player_label === "string"
        ? resultPayload.rendered_player_label
        : null;
    jobs.set(jobId, job);
  } catch (error) {
    console.error("Processing error:", error);
    job.status = "error";
    job.progress = 0;
    job.message = "Analysis failed";
    job.updated_at = new Date().toISOString();
    job.error = error instanceof Error ? error.message : "Unknown error";
    jobs.set(jobId, job);
  }
}

export const playerSelectionRoute = new Elysia({ prefix: "/api" })
  .post(
    "/frame/best",
    async ({ body, set }) => {
      try {
        const { video } = body;

        if (!video || !video.name || !video.type.startsWith("video/")) {
          set.status = 400;
          return { error: "Invalid video file" };
        }

        if (video.size > MAX_VIDEO_SIZE) {
          set.status = 400;
          return { error: "File size exceeds 500MB limit" };
        }

        const sessionToken = uuidv4();
        await mkdir(TEMP_DIR, { recursive: true });
        const filePath = join(TEMP_DIR, `${sessionToken}_${video.name}`);
        await Bun.write(filePath, video);

        const candidateFrames = await extractCandidateFramesFromEngine(filePath);
        if (candidateFrames.length === 0) {
          set.status = 422;
          return { error: "No candidate frames with recognizable players were found" };
        }

        const initial = candidateFrames[0];
        const framePayload = toFrameResponse(sessionToken, initial);

        const sessions = getFrameSessions();
        sessions.set(sessionToken, {
          session_token: sessionToken,
          file_path: filePath,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          locked: false,
          retake_count: 0,
          candidate_frames: candidateFrames,
          last_frame: framePayload,
        });

        return framePayload;
      } catch (error) {
        console.error("Frame extraction error:", error);
        set.status = 500;
        return { error: "Failed to extract best frame" };
      }
    },
    {
      body: t.Object({
        video: t.File(),
      }),
    }
  )
  .post(
    "/frame/retake",
    async ({ body, set }) => {
      try {
        const sessions = getFrameSessions();
        const session = sessions.get(body.session_token);

        if (!session) {
          set.status = 404;
          return { error: "Session not found" };
        }

        if (session.locked) {
          set.status = 409;
          return { error: "Session already locked" };
        }

        let candidates = session.candidate_frames || [];
        if (candidates.length === 0) {
          candidates = await extractCandidateFramesFromEngine(session.file_path);
          session.candidate_frames = candidates;
        }

        if (candidates.length === 0) {
          set.status = 422;
          return { error: "No candidate frames available for retake" };
        }

        const nextRetake = session.retake_count + 1;
        const idx = nextRetake % candidates.length;
        const selected = candidates[idx];
        const framePayload = toFrameResponse(session.session_token, selected);

        session.retake_count = nextRetake;
        session.updated_at = new Date().toISOString();
        session.last_frame = framePayload;
        sessions.set(session.session_token, session);

        return framePayload;
      } catch (error) {
        console.error("Frame retake error:", error);
        set.status = 500;
        return { error: "Failed to retake frame" };
      }
    },
    {
      body: t.Object({
        session_token: t.String(),
      }),
    }
  )
  .post(
    "/confirm-players",
    async ({ body, set }) => {
      try {
        const sessions = getFrameSessions();
        const session = sessions.get(body.session_token);

        if (!session) {
          set.status = 404;
          return { error: "Session not found" };
        }

        if (session.locked) {
          set.status = 409;
          return { error: "Session already locked" };
        }

        if (!body.players.length) {
          set.status = 400;
          return { error: "At least one player must be selected" };
        }

        session.selected_players = body.players;
        session.locked = true;
        session.updated_at = new Date().toISOString();
        sessions.set(session.session_token, session);

        const jobId = uuidv4();
        const now = new Date().toISOString();
        const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";

        const job: AnalysisJob = {
          job_id: jobId,
          status: "queued",
          progress: 0,
          message: "Queued for engine analysis",
          created_at: now,
          updated_at: now,
          file_path: session.file_path,
          session_token: session.session_token,
          selected_players: body.players,
          model,
          render: true,
        };

        const jobs = getJobsStore();
        jobs.set(jobId, job);
        void processConfirmedAnalysis(jobId, session, body.players);

        return { job_id: jobId };
      } catch (error) {
        console.error("Confirm players error:", error);
        set.status = 500;
        return { error: "Failed to confirm players" };
      }
    },
    {
      body: t.Object({
        session_token: t.String(),
        players: t.Array(
          t.Object({
            player_index: t.Number(),
            label: t.String(),
            bbox: t.Record(t.String(), t.Any()),
            reference_crop_base64: t.String(),
          })
        ),
      }),
    }
  );

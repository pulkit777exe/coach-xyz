'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Navbar from '@/components/Navbar';
import Hero from '@/components/Hero';
import UploadSection from '@/components/UploadSection';
import FeaturesSection from '@/components/FeaturesSection';
import ProgressSection from '@/components/ProgressSection';
import ResultsSection from '@/components/ResultsSection';
import Footer from '@/components/Footer';
import PlayerSelectionScreen, { type SelectedPlayer } from '@/components/PlayerSelectionScreen';

type DetectedPlayer = {
  player_index: number;
  bbox: { x_min: number; y_min: number; x_max: number; y_max: number };
  head_y: number;
};

type BestFrameResponse = {
  frame_url: string;
  session_token: string;
  players: DetectedPlayer[];
};

type SecondsRange = {
  min: number;
  max: number;
};

type ProgressState = {
  percent: number;
  icon: string;
  title: string;
  message: string;
  eta?: string;
};

const DEFAULT_PROGRESS: ProgressState = {
  percent: 0,
  icon: '🚀',
  title: 'Uploading…',
  message: 'Sending your video to the server…'
};

const formatEtaSeconds = (seconds: number) => {
  const safe = Math.max(0, Math.ceil(seconds));
  if (safe < 60) {
    return `${safe}s`;
  }
  const minutes = Math.floor(safe / 60);
  const remaining = safe % 60;
  if (minutes < 60) {
    return `${minutes}m ${remaining.toString().padStart(2, '0')}s`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins.toString().padStart(2, '0')}m`;
};

const formatEtaRange = (range: SecondsRange) => {
  if (range.max <= 0) {
    return 'under 10s';
  }
  if (range.min <= 10) {
    return `up to ${formatEtaSeconds(range.max)}`;
  }
  return `${formatEtaSeconds(range.min)} to ${formatEtaSeconds(range.max)}`;
};

const shiftEtaRangeByElapsed = (range: SecondsRange, elapsedSeconds: number): SecondsRange => ({
  min: Math.max(0, range.min - elapsedSeconds),
  max: Math.max(0, range.max - elapsedSeconds)
});

const estimateFrameExtractionRange = (durationSeconds: number | null): SecondsRange => {
  if (!durationSeconds) {
    return { min: 30, max: 90 };
  }
  return {
    min: Math.max(25, Math.round(durationSeconds * 0.5 + 15)),
    max: Math.max(45, Math.round(durationSeconds * 1.1 + 45))
  };
};

const estimateProcessingRange = (durationSeconds: number | null): SecondsRange => {
  if (!durationSeconds) {
    return { min: 240, max: 540 };
  }
  return {
    min: Math.max(120, Math.round(durationSeconds * 3.2 + 60)),
    max: Math.max(240, Math.round(durationSeconds * 5.2 + 120))
  };
};

const getVideoDurationSeconds = (file: File) =>
  new Promise<number>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      URL.revokeObjectURL(url);
      resolve(duration > 0 ? duration : 0);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to read video metadata'));
    };
    video.src = url;
  });

export default function Home() {
  const [uploadStage, setUploadStage] = useState<'upload' | 'extracting_frame' | 'player_selection' | 'processing' | 'results' | 'error'>('upload');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [analysisData, setAnalysisData] = useState<any>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [frameImageUrl, setFrameImageUrl] = useState<string>('');
  const [detectedPlayers, setDetectedPlayers] = useState<DetectedPlayer[]>([]);
  const [videoDurationSeconds, setVideoDurationSeconds] = useState<number | null>(null);
  const [progress, setProgress] = useState<ProgressState>(DEFAULT_PROGRESS);

  const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000';
  const frameEtaRange = useMemo(
    () => estimateFrameExtractionRange(videoDurationSeconds),
    [videoDurationSeconds]
  );
  const processingEtaRange = useMemo(
    () => estimateProcessingRange(videoDurationSeconds),
    [videoDurationSeconds]
  );

  useEffect(() => {
    let cancelled = false;
    if (!selectedFile) {
      setVideoDurationSeconds(null);
      return;
    }

    void getVideoDurationSeconds(selectedFile)
      .then((duration) => {
        if (!cancelled) {
          setVideoDurationSeconds(duration || null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setVideoDurationSeconds(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedFile]);

  const resetToUpload = useCallback(() => {
    setUploadStage('upload');
    setCurrentJobId(null);
    setAnalysisData(null);
    setSessionToken(null);
    setFrameImageUrl('');
    setDetectedPlayers([]);
    setVideoDurationSeconds(null);
    setProgress(DEFAULT_PROGRESS);
  }, []);

  const pollJobUntilDone = useCallback(async (jobId: string) => {
    const startedAt = Date.now();
    try {
      while (true) {
        const response = await fetch(`${API_BASE}/api/jobs/${jobId}`);
        if (!response.ok) {
          throw new Error('Failed to fetch job status');
        }

        const job = await response.json();
        const elapsedSeconds = (Date.now() - startedAt) / 1000;
        const eta = formatEtaRange(shiftEtaRangeByElapsed(processingEtaRange, elapsedSeconds));
        setProgress({
          percent: typeof job.progress === 'number' ? job.progress : 0,
          icon: job.status === 'rendering' ? '🎬' : '🤖',
          title: job.status === 'rendering' ? 'Rendering…' : 'Processing…',
          message: job.message || 'Analyzing your video…',
          eta
        });

        if (job.status === 'done') {
          setAnalysisData(job.result);
          setUploadStage('results');
          return;
        }

        if (job.status === 'error') {
          throw new Error(job.error || job.message || 'Analysis failed');
        }

        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    } catch (error) {
      setProgress((previous) => ({
        ...previous,
        message: error instanceof Error ? error.message : 'Failed to process analysis'
      }));
      setUploadStage('error');
    }
  }, [API_BASE, processingEtaRange]);

  const handleStartAnalysis = useCallback(async () => {
    if (!selectedFile) {
      return;
    }

    setUploadStage('extracting_frame');
    setProgress({
      percent: 15,
      icon: '🖼️',
      title: 'Extracting best frame…',
      message: 'Detecting players in your video…',
      eta: formatEtaRange(frameEtaRange)
    });

    try {
      const formData = new FormData();
      formData.append('video', selectedFile);

      const response = await fetch(`${API_BASE}/api/frame/best`, {
        method: 'POST',
        body: formData
      });
      if (!response.ok) {
        throw new Error('Failed to extract player selection frame');
      }

      const payload: BestFrameResponse = await response.json();
      setSessionToken(payload.session_token);
      setFrameImageUrl(payload.frame_url);
      setDetectedPlayers(payload.players || []);
      setUploadStage('player_selection');
    } catch (error) {
      setProgress((previous) => ({
        ...previous,
        message: error instanceof Error ? error.message : 'Failed to extract best frame'
      }));
      setUploadStage('error');
    }
  }, [API_BASE, frameEtaRange, selectedFile]);

  const handleRetakeFrame = useCallback(async () => {
    if (!sessionToken) {
      return;
    }

    setUploadStage('extracting_frame');
    setProgress({
      percent: 20,
      icon: '🔄',
      title: 'Retaking frame…',
      message: 'Finding another candidate frame…',
      eta: 'up to 20s'
    });

    try {
      const response = await fetch(`${API_BASE}/api/frame/retake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_token: sessionToken })
      });
      if (!response.ok) {
        throw new Error('Failed to retake frame');
      }

      const payload: BestFrameResponse = await response.json();
      setFrameImageUrl(payload.frame_url);
      setDetectedPlayers(payload.players || []);
      setUploadStage('player_selection');
    } catch (error) {
      setProgress((previous) => ({
        ...previous,
        message: error instanceof Error ? error.message : 'Failed to retake frame'
      }));
      setUploadStage('error');
    }
  }, [API_BASE, sessionToken]);

  const handleConfirmPlayers = useCallback(async (selectedPlayers: SelectedPlayer[]) => {
    if (!sessionToken) {
      return;
    }

    setUploadStage('processing');
    setProgress({
      percent: 5,
      icon: '🤖',
      title: 'Starting analysis…',
      message: 'Submitting selected players…',
      eta: formatEtaRange(processingEtaRange)
    });

    try {
      const response = await fetch(`${API_BASE}/api/confirm-players`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_token: sessionToken,
          players: selectedPlayers.map((player) => ({
            ...player,
            reference_crop_base64: ''
          }))
        })
      });
      if (!response.ok) {
        throw new Error('Failed to confirm players');
      }

      const payload: { job_id: string } = await response.json();
      setCurrentJobId(payload.job_id);
      await pollJobUntilDone(payload.job_id);
    } catch (error) {
      setProgress((previous) => ({
        ...previous,
        message: error instanceof Error ? error.message : 'Failed to start analysis'
      }));
      setUploadStage('error');
    }
  }, [API_BASE, pollJobUntilDone, processingEtaRange, sessionToken]);

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <Navbar />
      
      <main>
        {uploadStage === 'upload' && (
          <>
            <Hero />
            <UploadSection
              onFileSelect={setSelectedFile}
              onStartAnalysis={() => void handleStartAnalysis()}
              selectedFile={selectedFile}
            />
            <FeaturesSection />
          </>
        )}

        {uploadStage === 'extracting_frame' && (
          <ProgressSection
            progress={progress}
            onBack={resetToUpload}
          />
        )}

        {uploadStage === 'player_selection' && sessionToken && frameImageUrl && (
          <PlayerSelectionScreen
            frameImageUrl={frameImageUrl}
            detectedPlayers={detectedPlayers}
            onConfirm={handleConfirmPlayers}
            onRetake={() => void handleRetakeFrame()}
          />
        )}

        {uploadStage === 'processing' && (
          <ProgressSection
            progress={progress}
            onBack={resetToUpload}
          />
        )}

        {uploadStage === 'results' && analysisData && (
          <ResultsSection
            data={analysisData}
            jobId={currentJobId}
            onAnalyzeAgain={() => {
              setUploadStage('upload');
              setSelectedFile(null);
              setCurrentJobId(null);
              setAnalysisData(null);
              setSessionToken(null);
              setFrameImageUrl('');
              setDetectedPlayers([]);
              setVideoDurationSeconds(null);
              setProgress(DEFAULT_PROGRESS);
            }}
          />
        )}

        {uploadStage === 'error' && (
          <div className="container mx-auto px-6 py-20 text-center">
            <h1 className="text-4xl font-bold text-red-500 mb-4">❌ Analysis Failed</h1>
            <p className="text-xl text-gray-400 mb-8">
              {progress.message}
            </p>
            <button
              onClick={resetToUpload}
              className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 rounded-lg font-semibold transition-colors"
            >
              Try Again
            </button>
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}

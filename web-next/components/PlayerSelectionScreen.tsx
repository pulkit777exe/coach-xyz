'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type BBox = {
  x_min: number;
  y_min: number;
  x_max: number;
  y_max: number;
};

type DetectedPlayer = {
  player_index: number;
  bbox: BBox;
  head_y: number;
};

export type SelectedPlayer = {
  player_index: number;
  label: string;
  bbox: BBox;
};

interface PlayerSelectionScreenProps {
  frameImageUrl: string;
  detectedPlayers: DetectedPlayer[];
  onConfirm: (selectedPlayers: SelectedPlayer[]) => void;
  onRetake: () => void;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const PlayerSelectionScreen = ({
  frameImageUrl,
  detectedPlayers,
  onConfirm,
  onRetake
}: PlayerSelectionScreenProps) => {
  const imageRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  const [playerLabels, setPlayerLabels] = useState<Record<number, string>>({});
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [displaySize, setDisplaySize] = useState({ width: 0, height: 0 });

  const defaultLabel = useCallback((playerIndex: number) => `Player ${playerIndex + 1}`, []);

  const syncImageSize = useCallback(() => {
    const image = imageRef.current;
    if (!image) {
      return;
    }

    const rect = image.getBoundingClientRect();
    setDisplaySize({
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    });

    if (image.naturalWidth > 0 && image.naturalHeight > 0) {
      setNaturalSize({
        width: image.naturalWidth,
        height: image.naturalHeight
      });
    }
  }, []);

  useEffect(() => {
    setSelectedIndices([]);
    setPlayerLabels({});
  }, [frameImageUrl, detectedPlayers]);

  useEffect(() => {
    syncImageSize();
    window.addEventListener('resize', syncImageSize);
    return () => window.removeEventListener('resize', syncImageSize);
  }, [syncImageSize]);

  useEffect(() => {
    const image = imageRef.current;
    if (!image || typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(() => syncImageSize());
    observer.observe(image);
    return () => observer.disconnect();
  }, [syncImageSize]);

  const scaleX = naturalSize.width > 0 ? displaySize.width / naturalSize.width : 1;
  const scaleY = naturalSize.height > 0 ? displaySize.height / naturalSize.height : 1;

  const overlayPlayers = useMemo(() => {
    return detectedPlayers.map((player) => {
      const xMin = player.bbox.x_min * scaleX;
      const yMin = player.bbox.y_min * scaleY;
      const xMax = player.bbox.x_max * scaleX;
      const yMax = player.bbox.y_max * scaleY;
      const width = Math.max(1, xMax - xMin);
      const height = Math.max(1, yMax - yMin);
      const centerX = xMin + width / 2;
      const headY = player.head_y * scaleY;

      return {
        ...player,
        scaledBox: { xMin, yMin, width, height },
        chipX: clamp(centerX, 44, Math.max(44, displaySize.width - 44)),
        chipY: clamp(headY - 8, 36, Math.max(36, displaySize.height - 8))
      };
    });
  }, [detectedPlayers, displaySize.height, displaySize.width, scaleX, scaleY]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    canvas.width = displaySize.width;
    canvas.height = displaySize.height;

    const ctx = canvas.getContext('2d');
    if (!ctx || displaySize.width === 0 || displaySize.height === 0) {
      return;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    overlayPlayers.forEach((player) => {
      const isSelected = selectedIndices.includes(player.player_index);
      ctx.lineWidth = isSelected ? 3 : 2;
      ctx.strokeStyle = isSelected ? '#22c55e' : '#06b6d4';
      ctx.fillStyle = isSelected ? 'rgba(34, 197, 94, 0.14)' : 'rgba(6, 182, 212, 0.14)';
      ctx.strokeRect(
        player.scaledBox.xMin,
        player.scaledBox.yMin,
        player.scaledBox.width,
        player.scaledBox.height
      );
      ctx.fillRect(
        player.scaledBox.xMin,
        player.scaledBox.yMin,
        player.scaledBox.width,
        player.scaledBox.height
      );
    });
  }, [displaySize.height, displaySize.width, overlayPlayers, selectedIndices]);

  const selectedPlayers = useMemo(() => {
    return selectedIndices
      .map((selectedIndex) => {
        const player = detectedPlayers.find((entry) => entry.player_index === selectedIndex);
        if (!player) {
          return null;
        }

        return {
          player_index: player.player_index,
          label: playerLabels[player.player_index] ?? defaultLabel(player.player_index),
          bbox: player.bbox
        };
      })
      .filter((player): player is SelectedPlayer => player !== null);
  }, [defaultLabel, detectedPlayers, playerLabels, selectedIndices]);

  const togglePlayerSelection = (player: DetectedPlayer) => {
    setSelectedIndices((previous) => {
      const alreadySelected = previous.includes(player.player_index);
      if (alreadySelected) {
        return previous.filter((index) => index !== player.player_index);
      }
      return [...previous, player.player_index];
    });

    setPlayerLabels((previous) => {
      if (previous[player.player_index]) {
        return previous;
      }
      return {
        ...previous,
        [player.player_index]: defaultLabel(player.player_index)
      };
    });
  };

  const updatePlayerLabel = (playerIndex: number, label: string) => {
    setPlayerLabels((previous) => ({
      ...previous,
      [playerIndex]: label
    }));
  };

  return (
    <section className="py-12 bg-gray-800 text-white">
      <div className="container mx-auto px-6">
        <div className="max-w-5xl mx-auto bg-gray-900/70 border border-gray-700 rounded-2xl p-6 md:p-8">
          <div className="mb-5">
            <h2 className="text-2xl md:text-3xl font-bold">Select Players</h2>
            <p className="text-gray-400 mt-2">
              Click player chips on the frame to choose who should be analyzed.
            </p>
          </div>

          <div className="relative w-full overflow-hidden rounded-xl border border-gray-700 bg-black/60">
            <img
              ref={imageRef}
              src={frameImageUrl}
              alt="Detected players frame"
              className="block w-full h-auto select-none"
              onLoad={syncImageSize}
            />
            <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />

            {overlayPlayers.map((player) => {
              const isSelected = selectedIndices.includes(player.player_index);
              const label = playerLabels[player.player_index] ?? defaultLabel(player.player_index);

              return (
                <button
                  key={player.player_index}
                  type="button"
                  onClick={() => togglePlayerSelection(player)}
                  className={`absolute -translate-x-1/2 -translate-y-full rounded-full px-3 py-1 text-xs md:text-sm font-semibold border transition-colors ${
                    isSelected
                      ? 'bg-green-500 border-green-300 text-white'
                      : 'bg-gray-900/95 border-cyan-400 text-cyan-300 hover:bg-gray-800'
                  }`}
                  style={{ left: `${player.chipX}px`, top: `${player.chipY}px` }}
                >
                  {label}
                </button>
              );
            })}
          </div>

          <div className="mt-6 space-y-3">
            {selectedPlayers.length === 0 && (
              <div className="rounded-lg border border-dashed border-gray-600 bg-gray-800/50 px-4 py-3 text-sm text-gray-400">
                No players selected yet.
              </div>
            )}

            {selectedPlayers.map((player) => (
              <div
                key={player.player_index}
                className="flex flex-col gap-2 rounded-lg border border-gray-700 bg-gray-800/50 p-3 md:flex-row md:items-center"
              >
                <div className="text-sm text-gray-400 md:w-28">
                  #{player.player_index + 1}
                </div>
                <input
                  type="text"
                  value={playerLabels[player.player_index] ?? defaultLabel(player.player_index)}
                  onChange={(event) => updatePlayerLabel(player.player_index, event.target.value)}
                  className="flex-1 rounded-md border border-gray-600 bg-gray-900 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setSelectedIndices((previous) => previous.filter((index) => index !== player.player_index))}
                  className="rounded-md border border-red-500/60 px-3 py-2 text-sm font-medium text-red-300 hover:bg-red-500/10"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>

          <p className="mt-5 text-sm text-amber-300">
            Selections cannot be changed once analysis begins
          </p>

          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onRetake}
              className="px-5 py-3 rounded-lg border border-gray-600 text-gray-200 hover:bg-gray-800 transition-colors"
            >
              Retake
            </button>
            <button
              type="button"
              disabled={selectedPlayers.length === 0}
              onClick={() => onConfirm(selectedPlayers)}
              className={`px-5 py-3 rounded-lg font-semibold transition-colors ${
                selectedPlayers.length > 0
                  ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
                  : 'bg-gray-700 text-gray-400 cursor-not-allowed'
              }`}
            >
              Confirm Selection
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};

export default PlayerSelectionScreen;

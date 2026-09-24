'use client'

import { useRef, useState } from 'react'
import Image from 'next/image'
import { Slide } from 'loading-dev'
import { Button } from '@/components/9ui/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/9ui/ui/select'
import type { Player } from '@/types'

interface PlayerSelectorProps {
  players: Player[]
  angles: string[]
  activeAngle: string
  onAngleChange: (angle: string) => void
  onAddAngle: (file: File, angle: string) => void
  onSelect: (playerIndex: number) => void
}

const ANGLE_SUGGESTIONS = ['side', 'front', 'behind', 'baseline', 'elevated']

function PlayerImage({ player }: { player: Player }) {
  const [imgError, setImgError] = useState(false)
  const [imgLoaded, setImgLoaded] = useState(false)

  const hasBase64 = !!player.crop_base64 && player.crop_base64.trim().length > 0

  if (!hasBase64 || imgError) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground">
        <svg
          className="w-12 h-12 mb-2 opacity-40"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.5"
            d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"
          />
        </svg>
        <span className="text-[13px]">No preview</span>
      </div>
    )
  }

  return (
    <>
      {!imgLoaded && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Slide size={24} className="text-foreground" />
        </div>
      )}
      <Image
        unoptimized
        fill
        src={`data:image/jpeg;base64,${player.crop_base64.trim()}`}
        alt={`Subject ${player.player_index}`}
        className={`w-full h-full object-cover transition-opacity duration-200 ${imgLoaded ? 'opacity-100' : 'opacity-0'}`}
        onLoad={() => setImgLoaded(true)}
        onError={() => {
          setImgError(true)
        }}
      />
    </>
  )
}

export default function PlayerSelector({
  players,
  angles,
  activeAngle,
  onAngleChange,
  onAddAngle,
  onSelect,
}: PlayerSelectorProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [newAngle, setNewAngle] = useState<string>(ANGLE_SUGGESTIONS[0])
  const fileRef = useRef<HTMLInputElement>(null)

  // Reset the picked player when the coach switches perspective — indices
  // are per-angle, so a selection must never leak across angles.
  const switchAngle = (angle: string) => {
    setSelectedIndex(null)
    onAngleChange(angle)
  }

  const existingAngles = new Set(angles)
  const nextSuggestion =
    ANGLE_SUGGESTIONS.find((a) => !existingAngles.has(a)) ?? ANGLE_SUGGESTIONS[0]

  return (
    <>
      <div className="min-h-screen bg-transparent p-6 flex flex-col items-center relative z-10 pt-24 pb-20">
        <div className="max-w-5xl w-full">
          <div className="text-center mb-10 animate-[fadeInDown_0.3s_cubic-bezier(0.23,1,0.32,1)]">
            <h1 className="text-[26px] sm:text-[30px] font-bold tracking-[-0.015em] text-foreground mb-3 leading-tight">
              Who do you want to analyze?
            </h1>
            <p className="text-[14px] text-muted-foreground max-w-2xl mx-auto leading-[1.55]">
              Our vision models detected{' '}
              <span className="text-foreground font-medium tabular-nums">{players.length}</span>{' '}
              potential subjects
              {angles.length > 1 ? (
                <>
                  {' '}
                  in the{' '}
                  <span className="text-foreground font-medium capitalize">{activeAngle}</span>{' '}
                  view
                </>
              ) : null}
              . Select the primary athlete to continue the pipeline.
            </p>
          </div>

          {angles.length > 0 && (
            <div
              className="flex flex-wrap items-center justify-center gap-1 mb-8"
              role="tablist"
              aria-label="Camera angles"
            >
              <div className="inline-flex rounded-[6px] bg-accent p-1">
                {angles.map((angle) => (
                  <button
                    key={angle}
                    role="tab"
                    aria-selected={angle === activeAngle}
                    onClick={() => switchAngle(angle)}
                    className={`rounded-[4px] px-3.5 py-1.5 text-[14px] font-medium capitalize transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 ${
                      angle === activeAngle
                        ? 'bg-card text-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {angle}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 mt-8 mb-16 px-4 justify-items-center mx-auto w-fit max-w-full">
            {players.map((player, i) => {
              const isSelected = selectedIndex === player.player_index
              return (
                <div
                  key={player.player_index}
                  role="button"
                  tabIndex={0}
                  aria-label={`Select Subject ${player.player_index}, confidence ${(player.confidence * 100).toFixed(0)}%`}
                  aria-pressed={isSelected}
                  className={`animate-[fadeInUp_0.3s_cubic-bezier(0.23,1,0.32,1)_both] cursor-pointer group relative rounded-[6px] p-[2px] overflow-hidden transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background ${isSelected ? 'bg-primary' : 'bg-border hover:bg-muted-foreground/40'}`}
                  style={{ animationDelay: `${Math.min(0.25, 0.05 * i)}s` }}
                  onClick={() => setSelectedIndex(player.player_index)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setSelectedIndex(player.player_index)
                    }
                  }}
                >
                  <div
                    className={`relative h-full w-full rounded-[6px] overflow-hidden transition-colors border-0 p-5 flex flex-col items-center text-center bg-card`}
                  >
                    <div className="relative w-full aspect-square rounded-[6px] overflow-hidden mb-5 bg-muted border border-border">
                      <PlayerImage player={player} />
                      {isSelected && (
                        <div className="absolute top-3 right-3 w-8 h-8 bg-primary rounded-full flex items-center justify-center text-primary-foreground">
                          <svg
                            className="w-5 h-5"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth="2"
                              d="M5 13l4 4L19 7"
                            />
                          </svg>
                        </div>
                      )}
                    </div>

                    <h3
                      className={`text-[15px] font-semibold mb-3 transition-colors ${isSelected ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground'}`}
                    >
                      Subject {player.player_index}
                    </h3>

                    <div className="w-full flex justify-center">
                      <span
                        className={`text-[11px] font-medium px-2 py-0.5 rounded-full transition-colors ${
                          player.confidence >= 0.8
                            ? 'bg-primary/15 text-primary'
                            : player.confidence >= 0.6
                              ? 'bg-warning/15 text-warning'
                              : 'bg-destructive/10 text-destructive'
                        }`}
                      >
                        Confidence: {' '}
                        <span className="tabular-nums">
                          {(player.confidence * 100).toFixed(0)}%
                        </span>
                      </span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="animate-[fadeInUp_0.3s_cubic-bezier(0.23,1,0.32,1)_0.25s_both] max-w-sm mx-auto">
            <Button
              className="w-full h-12 rounded-[6px] text-[14px] font-medium transition-[background-color,transform] duration-150 active:scale-[0.98]"
              size="lg"
              disabled={selectedIndex === null}
              onClick={() => selectedIndex !== null && onSelect(selectedIndex)}
            >
              {selectedIndex !== null ? (
                <span className="flex items-center gap-2">
                  Confirm Selection
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M14 5l7 7m0 0l-7 7m7-7H3"
                    />
                  </svg>
                </span>
              ) : (
                'Select a subject to continue'
              )}
            </Button>
          </div>

          <div className="max-w-sm mx-auto mt-8 rounded-[6px] border border-border bg-card p-5">
            <p className="text-[15px] font-semibold text-foreground mb-1">
              Add another camera angle
            </p>
            <p className="text-[13px] text-muted-foreground mb-4 leading-[1.5]">
              Film the same drill from a second perspective (e.g. side + front) for a more complete
              read.
            </p>
            <div className="flex gap-2">
              <Select
                items={Object.fromEntries(ANGLE_SUGGESTIONS.map((a) => [a, a]))}
                value={ANGLE_SUGGESTIONS.includes(newAngle) ? newAngle : nextSuggestion}
                onValueChange={(value) => {
                  if (typeof value === 'string') setNewAngle(value)
                }}
              >
                <SelectTrigger aria-label="Camera angle label" className="flex-1 capitalize">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ANGLE_SUGGESTIONS.map((a) => (
                    <SelectItem key={a} value={a} disabled={existingAngles.has(a)}>
                      <span className="capitalize">
                        {a}
                        {existingAngles.has(a) ? ' (added)' : ''}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                className="h-10 rounded-[6px] font-medium"
                onClick={() => fileRef.current?.click()}
              >
                Upload
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept="video/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) onAddAngle(file, newAngle)
                  e.target.value = ''
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

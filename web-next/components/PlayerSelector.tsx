'use client'

import { useRef, useState } from 'react'
import Image from 'next/image'
import { Badge } from '@/components/9ui/ui/badge'
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
        <svg className="w-12 h-12 mb-2 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
        </svg>
        <span className="text-xs">No preview</span>
      </div>
    )
  }

  return (
    <>
      {!imgLoaded && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-foreground" />
        </div>
      )}
      <Image
        unoptimized
        fill
        src={`data:image/jpeg;base64,${player.crop_base64.trim()}`}
        alt={`Subject ${player.player_index}`}
        className={`w-full h-full object-cover transition-all duration-700 ease-in-out ${imgLoaded ? 'opacity-100' : 'opacity-0'}`}
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
          <div className="text-center mb-12 animate-[fadeInDown_0.8s_ease-out]">
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground mb-4 leading-tight">
                Who do you want to <span className="text-foreground">analyze?</span>
              </h1>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Our vision models detected <span className="text-foreground font-bold">{players.length}</span> potential subjects
              {angles.length > 1 ? (
                <> in the <span className="text-foreground font-bold capitalize">{activeAngle}</span> view</>
              ) : null}
              . Select the primary athlete to continue the pipeline.
            </p>
          </div>

          {angles.length > 0 && (
            <div className="flex flex-wrap items-center justify-center gap-2 mb-8" role="tablist" aria-label="Camera angles">
              {angles.map((angle) => (
                <button
                  key={angle}
                  role="tab"
                  aria-selected={angle === activeAngle}
                  onClick={() => switchAngle(angle)}
                  className={`rounded-full px-4 py-2 text-sm font-semibold capitalize transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground ${
                    angle === activeAngle
                      ? 'bg-foreground text-background'
                      : 'bg-muted text-muted-foreground hover:text-foreground border border-border'
                  }`}
                >
                  {angle}
                </button>
              ))}
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
                  className={`animate-[fadeInUp_0.45s_ease-out_both] cursor-pointer group relative rounded-2xl p-[2px] overflow-hidden transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background ${isSelected ? 'bg-foreground' : 'bg-muted hover:bg-border'}`}
                  style={{ animationDelay: `${0.2 + i * 0.1}s` }}
                  onClick={() => setSelectedIndex(player.player_index)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setSelectedIndex(player.player_index)
                    }
                  }}
                >
                  <div className={`relative h-full w-full rounded-2xl overflow-hidden transition-all border-0 p-5 flex flex-col items-center text-center bg-card ${isSelected ? 'bg-card' : ''}`}>
                      <div className="relative w-full aspect-square rounded-xl overflow-hidden mb-5 bg-muted border border-border shadow-inner">
                        <PlayerImage player={player} />
                        {isSelected && (
                          <div className="absolute inset-0 bg-border mix-blend-overlay"></div>
                        )}
                        {isSelected && (
                          <div className="absolute top-3 right-3 w-8 h-8 bg-foreground rounded-full flex items-center justify-center text-background">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
                          </div>
                        )}
                      </div>

                      <h3 className={`text-xl font-bold mb-3 transition-colors tracking-tight ${isSelected ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground'}`}>
                        Subject {player.player_index}
                      </h3>

                      <div className="w-full flex justify-center">
                        <Badge variant="outline" className={`font-mono text-[0.65rem] uppercase tracking-widest px-3 py-1 rounded-xl transition-colors ${
                          player.confidence >= 0.8 ? 'text-primary bg-primary/10 border border-primary/30' :
                          player.confidence >= 0.6 ? 'text-warning bg-warning/10 border border-warning/30' :
                          'text-destructive bg-danger/10 border border-danger/30'
                        }`}>
                          Confidence: {(player.confidence * 100).toFixed(0)}%
                        </Badge>
                      </div>
                  </div>
                </div>
              )
            })}
          </div>

              <div className="animate-[fadeInUp_0.45s_ease-out_0.6s_both] max-w-sm mx-auto">
                <Button
                  className={`w-full h-16 rounded-2xl text-base font-bold transition-colors duration-200 ${
                    selectedIndex !== null
                      ? 'bg-primary text-primary-foreground'
                  : 'bg-muted border border-border text-muted-foreground cursor-not-allowed shadow-none'
              }`}
              size="lg"
              disabled={selectedIndex === null}
              onClick={() => selectedIndex !== null && onSelect(selectedIndex)}
            >
              {selectedIndex !== null ? (
                <span className="flex items-center gap-2 text-background">
                  Confirm Selection
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                </span>
              ) : 'Select a subject to continue'}
            </Button>
          </div>

          <div className="max-w-sm mx-auto mt-8 rounded-2xl border border-border bg-card p-5">
            <p className="text-sm font-semibold text-foreground mb-1">Add another camera angle</p>
            <p className="text-xs text-muted-foreground mb-4">
              Film the same drill from a second perspective (e.g. side + front) for a more complete read.
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
                        {a}{existingAngles.has(a) ? ' (added)' : ''}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                className="h-10 rounded-xl font-semibold"
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
